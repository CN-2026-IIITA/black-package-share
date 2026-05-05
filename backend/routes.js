/**
 * routes.js — Express API Route Definitions
 * 
 * Implements all REST endpoints for Black Packet:
 *  • Upload initialization, chunk upload, upload completion
 *  • Download with access code validation
 *  • Transfer status & resume
 *  • LAN peer discovery
 *  • Health / stats
 * 
 * @module backend/routes
 * @author Black Packet Team (Member 2)
 */

const express       = require('express');
const multer        = require('multer');
const path          = require('path');
const fs            = require('fs');
const { v4: uuidv4 } = require('uuid');

const chunkTransfer = require('../networking/chunkTransfer');
const socketHandler = require('../networking/socketHandler');
const fileHandler   = require('../backend/fileHandler');
const lanDiscovery  = require('../networking/lanDiscovery');
const logger        = require('../utils/logger');
const helpers       = require('../utils/helpers');
const QRCode        = require('qrcode');
const steganography = require('../utils/steganography');
const contentFilter = require('../utils/contentFilter');
const analytics     = require('../utils/analytics');

const router = express.Router();
const sessionStart = Date.now();

/* ── Upload directory setup ─────────────────────────────────────── */

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* Multer configured for raw chunk buffers (memory storage) */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per chunk max
});

/* ── Helper: get Socket.IO instance from the request ────────────── */
function getIO(req) {
    return req.app.get('io');
}

/* ═══════════════════════════════════════════════════════════════════
   UPLOAD ENDPOINTS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * POST /api/upload/init
 * 
 * Initialize a new chunked upload session.
 * 
 * Body: { fileName: string, fileSize: number, expiryMinutes?: number }
 * Response: { transferId, chunkSize, totalChunks }
 */
router.post('/upload/init', (req, res) => {
    try {
        const { fileName, fileSize, expiryMinutes } = req.body;

        /* ── Validation ─────────────────────────────────────────── */
        if (!fileName || !fileSize) {
            return res.status(400).json({ error: 'fileName and fileSize are required' });
        }

        if (!helpers.isValidFilename(fileName)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        if (fileSize <= 0 || fileSize > 500 * 1024 * 1024) {
            return res.status(400).json({ error: 'File size must be between 1 byte and 500 MB' });
        }

        /* ── Create transfer ────────────────────────────────────── */
        const transferId = uuidv4();
        const transferDir = path.join(UPLOADS_DIR, transferId);
        fs.mkdirSync(transferDir, { recursive: true });

        const state = chunkTransfer.initTransfer(transferId, fileName, fileSize, transferDir);

        logger.fileOp('UPLOAD-INIT', fileName, `id=${transferId.substring(0, 8)}…`);

        res.json({
            success:     true,
            transferId,
            chunkSize:   state.chunkSize,
            totalChunks: state.totalChunks,
            fileName:    state.fileName,
            fileSize:    state.fileSize,
        });
    } catch (err) {
        logger.error('Routes', 'Upload init failed', err.message);
        res.status(500).json({ error: 'Failed to initialize upload' });
    }
});

/**
 * POST /api/upload/chunk/:transferId
 * 
 * Upload a single chunk.
 * 
 * Params: transferId
 * Query:  chunkIndex (number)
 * Body:   multipart/form-data with field "chunk"
 * 
 * Response: { success, chunkIndex, hash, progress }
 */
router.post('/upload/chunk/:transferId', upload.single('chunk'), (req, res) => {
    try {
        const { transferId } = req.params;
        const chunkIndex = parseInt(req.query.chunkIndex, 10);

        if (isNaN(chunkIndex)) {
            return res.status(400).json({ error: 'chunkIndex query parameter is required' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No chunk data received' });
        }

        /* ── Process the chunk ──────────────────────────────────── */
        const result = chunkTransfer.processChunk(transferId, chunkIndex, req.file.buffer);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        /* Track chunk in analytics */
        analytics.trackChunk('received');

        /* ── Get progress and broadcast via Socket.IO ───────────── */
        const progress = chunkTransfer.getTransferProgress(transferId);
        const io = getIO(req);
        if (io) {
            socketHandler.broadcastProgress(io, transferId, progress);
        }

        res.json({
            success:    true,
            chunkIndex,
            hash:       result.hash,
            progress,
        });
    } catch (err) {
        logger.error('Routes', 'Chunk upload failed', err.message);
        res.status(500).json({ error: 'Failed to process chunk' });
    }
});

/**
 * POST /api/upload/complete/:transferId
 * 
 * Finalize the upload: assemble chunks into one file,
 * generate access code and download token.
 * 
 * Body: { expiryMinutes?: number }
 * Response: { accessCode, token, expiresAt, fileName, fileSize }
 */
router.post('/upload/complete/:transferId', async (req, res) => {
    try {
        const { transferId } = req.params;
        const { expiryMinutes } = req.body || {};

        const progress = chunkTransfer.getTransferProgress(transferId);
        if (!progress) {
            return res.status(404).json({ error: 'Transfer not found' });
        }

        if (progress.received !== progress.total) {
            return res.status(400).json({
                error: `Upload incomplete: ${progress.received}/${progress.total} chunks received`,
                missingChunks: chunkTransfer.getMissingChunks(transferId),
            });
        }

        /* ── Assemble the file ──────────────────────────────────── */
        const transferDir = path.join(UPLOADS_DIR, transferId);
        const outputPath  = path.join(transferDir, progress.fileName);
        const assembly    = chunkTransfer.assembleFile(transferId, outputPath);

        if (!assembly.success) {
            return res.status(500).json({ error: assembly.error });
        }

        /* ── Register for download ──────────────────────────────── */
        const registration = fileHandler.registerFile({
            transferId,
            fileName:      progress.fileName,
            fileSize:      progress.fileSize,
            filePath:      outputPath,
            fileHash:      assembly.hash,
            expiryMinutes: expiryMinutes || 30,
        });

        /* ── Generate QR code using real LAN IP (phone-accessible) ── */
        const PORT = process.env.PORT || 3000;
        // Prefer LAN IP so phones on the same network can scan and download
        const lanIPs = lanDiscovery.getLocalIPs();
        const lanIP  = lanIPs[0] || 'localhost';
        const LAN_URL  = `http://${lanIP}:${PORT}`;
        const BASE_URL = process.env.BASE_URL || LAN_URL;
        const downloadUrl = `${BASE_URL}/download/${registration.accessCode}`;
        const lanDownloadUrl = `${LAN_URL}/download/${registration.accessCode}`;

        let qrCodeBase64 = null;
        try {
            // Use LAN URL for the QR — this is what phones scan
            qrCodeBase64 = await QRCode.toDataURL(lanDownloadUrl, {
                width: 300,
                margin: 2,
                color: { dark: '#00ff88', light: '#000000' },
                errorCorrectionLevel: 'M',
            });
        } catch (qrErr) {
            logger.warn('Routes', `QR generation failed: ${qrErr.message}`);
        }

        /* ── Generate steganographic share-card ─────────────────── */
        let stegoImage = null;
        try {
            stegoImage = steganography.createStegoImage(registration.accessCode);
        } catch (stegoErr) {
            logger.warn('Routes', `Stego generation failed: ${stegoErr.message}`);
        }

        /* ── Broadcast completion ───────────────────────────────── */
        const io = getIO(req);
        if (io) {
            socketHandler.broadcastCompletion(io, transferId, {
                accessCode: registration.accessCode,
                expiresAt:  registration.expiresAt,
                fileName:   progress.fileName,
                fileSize:   progress.fileSize,
                downloadUrl,
                qrCode:     qrCodeBase64,
                stegoImage,
            });
        }

        logger.fileOp('UPLOAD-COMPLETE', progress.fileName, `code=${registration.accessCode}`);

        /* Track upload + encryption in analytics */
        analytics.trackUpload(progress.fileSize, 1000);
        analytics.trackEncryption('encrypted');

        res.json({
            success:    true,
            accessCode: registration.accessCode,
            token:      registration.token,
            expiresAt:  registration.expiresAt,
            fileName:   progress.fileName,
            fileSize:   progress.fileSize,
            fileSizeFormatted: helpers.formatFileSize(progress.fileSize),
            downloadUrl,
            lanDownloadUrl,
            lanIP,
            qrCode:     qrCodeBase64,
            stegoImage,
            encrypted:  true,
        });
    } catch (err) {
        logger.error('Routes', 'Upload complete failed', err.message);
        res.status(500).json({ error: 'Failed to complete upload' });
    }
});

/* ═══════════════════════════════════════════════════════════════════
   DOWNLOAD ENDPOINT
   ═══════════════════════════════════════════════════════════════════ */

/**
 * GET /api/download/:accessCode
 * 
 * Download a file using its 6-digit access code.
 * Validates code, checks expiry, streams the file.
 */
router.get('/download/:accessCode', (req, res) => {
    try {
        const { accessCode } = req.params;

        const validation = fileHandler.validateAccess(accessCode);
        if (!validation.valid) {
            return res.status(validation.error === 'Link has expired' ? 410 : 404)
                      .json({ error: validation.error });
        }

        const { meta } = validation;

        /* Record the download */
        fileHandler.recordDownload(accessCode);

        /* Track download in analytics */
        analytics.trackDownload(meta.fileSize || 0);

        /* Decrypt the file before sending (cryptographic shredding support) */
        const decrypted = fileHandler.getDecryptedFile(accessCode);
        if (!decrypted.success) {
            return res.status(500).json({ error: decrypted.error });
        }

        /* Set headers for file download */
        res.setHeader('Content-Disposition', `attachment; filename="${meta.fileName}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', decrypted.data.length);
        res.setHeader('X-File-Hash', meta.fileHash);

        /* Send decrypted data */
        res.end(decrypted.data);

        logger.fileOp('DOWNLOAD', meta.fileName, `code=${accessCode} [decrypted on-the-fly]`);
    } catch (err) {
        logger.error('Routes', 'Download failed', err.message);
        res.status(500).json({ error: 'Download failed' });
    }
});

/* ═══════════════════════════════════════════════════════════════════
   CRYPTOGRAPHIC SHREDDING
   ═══════════════════════════════════════════════════════════════════ */

/**
 * POST /api/shred/:accessCode
 * 
 * Cryptographically shred a file — destroy encryption keys.
 * The ciphertext stays on disk but is permanently unrecoverable.
 */
router.post('/shred/:accessCode', (req, res) => {
    try {
        const { accessCode } = req.params;
        const result = fileHandler.shredFile(accessCode);

        if (!result) {
            return res.status(404).json({ error: 'File not found or already shredded' });
        }

        res.json({
            success: true,
            message: 'Encryption keys destroyed — file data is now cryptographically unrecoverable',
        });
    } catch (err) {
        logger.error('Routes', 'Shred failed', err.message);
        res.status(500).json({ error: 'Shred operation failed' });
    }
});

/* ═══════════════════════════════════════════════════════════════════
   STEGANOGRAPHY
   ═══════════════════════════════════════════════════════════════════ */

/**
 * POST /api/stego/extract
 * 
 * Extract an access code from a steganographic image.
 * Body: multipart/form-data with field "image"
 */
router.post('/stego/extract', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        const code = steganography.extractFromPNG(req.file.buffer);
        if (!code) {
            return res.status(400).json({ error: 'No hidden code found in this image' });
        }

        res.json({ success: true, accessCode: code });
    } catch (err) {
        logger.error('Routes', 'Stego extraction failed', err.message);
        res.status(500).json({ error: 'Failed to extract code from image' });
    }
});

/* ═══════════════════════════════════════════════════════════════════
   TRANSFER STATUS & RESUME
   ═══════════════════════════════════════════════════════════════════ */

/**
 * GET /api/transfer/status/:transferId
 * 
 * Get current progress of an active transfer.
 */
router.get('/transfer/status/:transferId', (req, res) => {
    const progress = chunkTransfer.getTransferProgress(req.params.transferId);
    if (!progress) {
        return res.status(404).json({ error: 'Transfer not found' });
    }
    res.json({ success: true, progress });
});

/**
 * GET /api/transfer/resume/:transferId
 * 
 * Get the list of missing chunks so the client can resume.
 */
router.get('/transfer/resume/:transferId', (req, res) => {
    const { transferId } = req.params;
    const missing  = chunkTransfer.getMissingChunks(transferId);
    const progress = chunkTransfer.getTransferProgress(transferId);

    if (!progress) {
        return res.status(404).json({ error: 'Transfer not found' });
    }

    res.json({
        success:       true,
        transferId,
        missingChunks: missing,
        progress,
    });
});

/* ═══════════════════════════════════════════════════════════════════
   LAN DISCOVERY
   ═══════════════════════════════════════════════════════════════════ */

/**
 * GET /api/lan/discover
 * 
 * Return the list of discovered LAN peers.
 */
router.get('/lan/discover', (req, res) => {
    const peers     = lanDiscovery.getPeers();
    const localInfo = lanDiscovery.getLocalInfo();
    res.json({ success: true, peers, count: peers.length, localDevice: localInfo });
});

/**
 * GET /api/lan/scan
 * 
 * Scan the network for ALL nearby devices (ARP + TCP probes).
 * Similar to Bluetooth device discovery.
 */
router.get('/lan/scan', async (req, res) => {
    try {
        const devices   = await lanDiscovery.scanNetwork();
        const localInfo = lanDiscovery.getLocalInfo();
        const peers     = lanDiscovery.getPeers();
        res.json({
            success:    true,
            devices,
            deviceCount: devices.length,
            blackPacketPeers: peers,
            peerCount:  peers.length,
            localDevice: localInfo,
        });
    } catch (err) {
        logger.error('Routes', 'Network scan failed', err.message);
        res.status(500).json({ error: 'Network scan failed' });
    }
});

/* ═══════════════════════════════════════════════════════════════════
   HEALTH & STATS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * GET /api/health
 * 
 * Server health and statistics.
 */
router.get('/health', (req, res) => {
    const stats = fileHandler.getStats();
    res.json({
        success: true,
        status:  'healthy',
        uptime:  process.uptime(),
        stats,
    });
});

/* ═══════════════════════════════════════════════════════════════════
   ANALYTICS & BENCHMARKING
   ═══════════════════════════════════════════════════════════════════ */

/**
 * GET /api/analytics
 * 
 * Returns real-time session analytics for the dashboard.
 */
router.get('/analytics', (req, res) => {
    res.json({ success: true, ...analytics.getAnalytics() });
});

/**
 * GET /api/benchmark
 * 
 * Run performance benchmarks (hash, encryption, memory, RNG).
 */
router.get('/benchmark', (req, res) => {
    try {
        const results = analytics.runBenchmark();
        res.json({ success: true, benchmark: results });
    } catch (err) {
        logger.error('Routes', 'Benchmark failed', err.message);
        res.status(500).json({ error: 'Benchmark failed' });
    }
});

/**
 * POST /api/content-scan
 * 
 * Scan a filename for content safety (pre-upload check).
 * Body: { fileName, fileSize, mimeType? }
 */
router.post('/content-scan', (req, res) => {
    const { fileName, fileSize, mimeType } = req.body;
    if (!fileName) {
        return res.status(400).json({ error: 'fileName is required' });
    }
    const result = contentFilter.scanFile(fileName, fileSize || 0, mimeType);
    analytics.trackContentScan(result);
    res.json({ success: true, scan: result });
});

/**
 * GET /api/content-filter/rules
 * 
 * Returns the list of blocked file extensions.
 */
router.get('/content-filter/rules', (req, res) => {
    res.json({
        success: true,
        blockedExtensions: contentFilter.getBlockedExtensions(),
        totalBlocked: contentFilter.getBlockedExtensions().length,
    });
});

module.exports = router;
