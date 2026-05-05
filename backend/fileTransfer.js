/**
 * fileHandler.js — File Metadata & Access Management
 * 
 * Manages the lifecycle of uploaded files:
 *  • In-memory file metadata store
 *  • Access code generation & validation
 *  • JWT token-based file access
 *  • Auto-expiry enforcement
 *  • Periodic cleanup of expired files
 * 
 * @module backend/fileHandler
 * @author Black Packet Team (Member 2)
 */

const fs             = require('fs');
const path           = require('path');
const jwt            = require('jsonwebtoken');
const logger         = require('../utils/logger');
const helpers        = require('../utils/helpers');
const cryptoShredder = require('../utils/cryptoShredder');

/* ── Constants ──────────────────────────────────────────────────── */

/** Default link lifetime in minutes */
const DEFAULT_EXPIRY_MINUTES = 30;

/** JWT secret (overridden by process.env.JWT_SECRET in production) */
const JWT_SECRET = process.env.JWT_SECRET || 'black-packet-secret-key-2024';

/* ── In-Memory Store ────────────────────────────────────────────── */

/**
 * @typedef {Object} FileMeta
 * @property {string} id          - Transfer / file ID
 * @property {string} fileName    - Original filename
 * @property {number} fileSize    - Size in bytes
 * @property {string} filePath    - Absolute path to assembled file
 * @property {string} accessCode  - 6-digit download code
 * @property {string} token       - JWT download token
 * @property {number} createdAt   - Unix-ms
 * @property {number} expiresAt   - Unix-ms
 * @property {number} expiryMinutes
 * @property {number} downloadCount
 * @property {string} fileHash    - SHA-256 of assembled file
 */

/** @type {Map<string, FileMeta>} keyed by accessCode */
const fileStore = new Map();

/** @type {Map<string, FileMeta>} keyed by transferId for quick lookup */
const transferIndex = new Map();

/* ── Public API ─────────────────────────────────────────────────── */

/**
 * Register a completed file upload.
 * Generates an access code and JWT token for secure download.
 * 
 * @param {Object} params
 * @param {string} params.transferId
 * @param {string} params.fileName
 * @param {number} params.fileSize
 * @param {string} params.filePath
 * @param {string} params.fileHash
 * @param {number} [params.expiryMinutes=30]
 * @returns {{ accessCode: string, token: string, expiresAt: number }}
 */
function registerFile({ transferId, fileName, fileSize, filePath, fileHash, expiryMinutes }) {
    const expiry     = expiryMinutes || DEFAULT_EXPIRY_MINUTES;
    const accessCode = helpers.generateAccessCode();
    const createdAt  = Date.now();
    const expiresAt  = createdAt + expiry * 60 * 1000;

    /* Create JWT token embedding the access code and expiry */
    const token = jwt.sign(
        { accessCode, transferId, fileName },
        JWT_SECRET,
        { expiresIn: `${expiry}m` }
    );

    const meta = {
        id: transferId,
        fileName,
        fileSize,
        filePath,
        accessCode,
        token,
        createdAt,
        expiresAt,
        expiryMinutes: expiry,
        downloadCount: 0,
        fileHash,
    };

    fileStore.set(accessCode, meta);
    transferIndex.set(transferId, meta);

    logger.fileOp('REGISTER', fileName, `code=${accessCode}, expires in ${expiry}m`);
    return { accessCode, token, expiresAt };
}

/**
 * Validate an access code and return the file metadata if valid.
 * 
 * @param {string} accessCode - 6-digit code
 * @returns {{ valid: boolean, meta?: FileMeta, error?: string }}
 */
function validateAccess(accessCode) {
    const meta = fileStore.get(accessCode);

    if (!meta) {
        return { valid: false, error: 'Invalid access code' };
    }

    if (Date.now() > meta.expiresAt) {
        /* Clean up expired file */
        deleteFile(accessCode);
        return { valid: false, error: 'Link has expired' };
    }

    /* Check if keys have been shredded (cryptographic shredding) */
    if (cryptoShredder.isShredded(meta.id)) {
        return { valid: false, error: 'File has been cryptographically shredded — data unrecoverable' };
    }

    if (!fs.existsSync(meta.filePath)) {
        fileStore.delete(accessCode);
        transferIndex.delete(meta.id);
        return { valid: false, error: 'File no longer available' };
    }

    return { valid: true, meta };
}

/**
 * Validate a JWT download token.
 * 
 * @param {string} token
 * @returns {{ valid: boolean, meta?: FileMeta, error?: string }}
 */
function validateToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return validateAccess(decoded.accessCode);
    } catch (err) {
        return { valid: false, error: 'Invalid or expired token' };
    }
}

/**
 * Increment the download counter for a file.
 * @param {string} accessCode
 */
function recordDownload(accessCode) {
    const meta = fileStore.get(accessCode);
    if (meta) {
        meta.downloadCount += 1;
        logger.fileOp('DOWNLOAD', meta.fileName, `count=${meta.downloadCount}`);
    }
}

/**
 * Delete a file and its metadata.
 * @param {string} accessCode
 */
function deleteFile(accessCode) {
    const meta = fileStore.get(accessCode);
    if (!meta) return;

    /* Shred crypto keys first (makes data unrecoverable) */
    cryptoShredder.shredKeys(meta.id);

    /* Remove physical file */
    try {
        if (fs.existsSync(meta.filePath)) {
            fs.unlinkSync(meta.filePath);
        }
        /* Also try to remove the transfer directory */
        const dir = path.dirname(meta.filePath);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
        }
    } catch (err) {
        logger.warn('FileHandler', `Cleanup error: ${err.message}`);
    }

    /* Clean up vault entirely */
    cryptoShredder.cleanupVault(meta.id);

    fileStore.delete(accessCode);
    transferIndex.delete(meta.id);
    logger.fileOp('DELETE', meta.fileName, 'expired / removed');
}

/**
 * Get file info by transfer ID (used for status endpoints).
 * @param {string} transferId
 * @returns {FileMeta | undefined}
 */
function getByTransferId(transferId) {
    return transferIndex.get(transferId);
}

/**
 * Run a cleanup pass: delete all expired files.
 * Called periodically by the server.
 * 
 * @returns {number} Number of files cleaned up
 */
function cleanupExpired() {
    let cleaned = 0;
    const now = Date.now();

    for (const [code, meta] of fileStore) {
        if (now > meta.expiresAt) {
            deleteFile(code);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        logger.info('FileHandler', `Cleaned up ${cleaned} expired file(s)`);
    }
    return cleaned;
}

/**
 * Get summary statistics for the dashboard / health endpoint.
 * @returns {{ totalFiles: number, totalSize: number, totalDownloads: number }}
 */
function getStats() {
    let totalSize = 0;
    let totalDownloads = 0;

    for (const meta of fileStore.values()) {
        totalSize += meta.fileSize;
        totalDownloads += meta.downloadCount;
    }

    return {
        totalFiles:     fileStore.size,
        totalSize,
        totalSizeFormatted: helpers.formatFileSize(totalSize),
        totalDownloads,
    };
}

/**
 * Read and decrypt the assembled file for download.
 * The file on disk is encrypted; this returns plaintext.
 * 
 * @param {string} accessCode
 * @returns {{ success: boolean, data?: Buffer, meta?: FileMeta, error?: string }}
 */
function getDecryptedFile(accessCode) {
    const meta = fileStore.get(accessCode);
    if (!meta) return { success: false, error: 'File not found' };

    if (cryptoShredder.isShredded(meta.id)) {
        return { success: false, error: 'Keys shredded — data unrecoverable' };
    }

    try {
        const encryptedFile = fs.readFileSync(meta.filePath);
        const plaintext     = cryptoShredder.decryptFile(meta.id, encryptedFile);
        return { success: true, data: plaintext, meta };
    } catch (err) {
        logger.error('FileHandler', `Decrypt failed for ${meta.fileName}: ${err.message}`);
        return { success: false, error: 'Decryption failed' };
    }
}

/**
 * Cryptographically shred a file — destroy keys without deleting bytes.
 * The ciphertext remains on disk but is permanently unrecoverable.
 * 
 * @param {string} accessCode
 * @returns {boolean}
 */
function shredFile(accessCode) {
    const meta = fileStore.get(accessCode);
    if (!meta) return false;
    const result = cryptoShredder.shredKeys(meta.id);
    if (result) {
        logger.fileOp('SHRED', meta.fileName, 'keys destroyed — data unrecoverable');
    }
    return result;
}

module.exports = {
    registerFile,
    validateAccess,
    validateToken,
    recordDownload,
    deleteFile,
    getByTransferId,
    cleanupExpired,
    getStats,
    getDecryptedFile,
    shredFile,
};
