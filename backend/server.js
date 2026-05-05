/**
 * server.js — Black Packet Application Entry Point
 * 
 * Sets up Express + Socket.IO, mounts API routes,
 * serves the frontend, and starts periodic cleanup.
 * 
 * @module backend/server
 * @author Black Packet Team (Member 2)
 */

require('dotenv').config();

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');

const routes        = require('./routes');
const socketHandler = require('../networking/socketHandler');
const lanDiscovery  = require('../networking/lanDiscovery');
const fileHandler   = require('../backend/fileHandler');
const logger        = require('../utils/logger');

/* ── Configuration ──────────────────────────────────────────────── */

const PORT     = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

/* ── Express Setup ──────────────────────────────────────────────── */

const app    = express();
const server = http.createServer(app);

/* ── Socket.IO Setup ────────────────────────────────────────────── */

const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 10 * 1024 * 1024, // 10 MB for chunk uploads via socket
});

/* Make io accessible in routes via req.app.get('io') */
app.set('io', io);

/* ── Middleware ──────────────────────────────────────────────────── */

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── Static Frontend ────────────────────────────────────────────── */

const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

/* ── API Routes ─────────────────────────────────────────────────── */

app.use('/api', routes);

/* ── Expose base URL to frontend ────────────────────────────────── */

app.get('/api/config', (req, res) => {
    res.json({ baseUrl: BASE_URL });
});

/* ── Direct download route (non-API, for QR codes) ──────────────── */

app.get('/download/:accessCode', (req, res) => {
    const { accessCode } = req.params;
    const validation = fileHandler.validateAccess(accessCode);

    if (!validation.valid) {
        return res.status(validation.error === 'Link has expired' ? 410 : 404)
                  .json({ error: validation.error });
    }

    const { meta } = validation;
    fileHandler.recordDownload(accessCode);

    /* Decrypt the file before sending */
    const decrypted = fileHandler.getDecryptedFile(accessCode);
    if (!decrypted.success) {
        return res.status(500).json({ error: decrypted.error });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${meta.fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', decrypted.data.length);
    res.setHeader('X-File-Hash', meta.fileHash);

    res.end(decrypted.data);

    logger.fileOp('DOWNLOAD-DIRECT', meta.fileName, `code=${accessCode} [decrypted]`);
});

/* ── Catch-All: serve index.html for SPA-style navigation ─────── */

app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

/* ── Ensure uploads directory exists ────────────────────────────── */

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

/* ── Initialize Socket.IO Handlers ──────────────────────────────── */

socketHandler.initSocketHandlers(io);

/* ── Periodic Expired File Cleanup (every 5 minutes) ────────────── */

const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
    fileHandler.cleanupExpired();
}, CLEANUP_INTERVAL);

/* ── Start Server ───────────────────────────────────────────────── */

server.listen(PORT, '0.0.0.0', () => {
    logger.info('Server', `═══════════════════════════════════════════════`);
    logger.info('Server', `  Black Packet server running on port ${PORT}`);
    logger.info('Server', `  Base URL: ${BASE_URL}`);
    logger.info('Server', `  API:      ${BASE_URL}/api`);
    logger.info('Server', `═══════════════════════════════════════════════`);

    /* Start LAN discovery (may fail on cloud platforms — that's OK) */
    try {
        lanDiscovery.startDiscovery(PORT);
    } catch (err) {
        logger.warn('Server', `LAN discovery could not start: ${err.message}`);
    }
});

/* ── Graceful Shutdown ──────────────────────────────────────────── */

process.on('SIGINT', () => {
    logger.info('Server', 'Shutting down…');
    lanDiscovery.stopDiscovery();
    server.close(() => {
        logger.info('Server', 'Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    lanDiscovery.stopDiscovery();
    server.close(() => process.exit(0));
});

module.exports = { app, server, io };
