/**
 * analytics.js — Transfer Analytics Engine
 * 
 * Tracks real-time session metrics for the analytics dashboard:
 *   • Total uploads/downloads
 *   • Bytes transferred (in/out)
 *   • Transfer speed averages
 *   • Content filter statistics
 *   • Encryption usage stats
 *   • Per-second throughput for live graphs
 * 
 * All data is in-memory (resets on server restart).
 * 
 * @module utils/analytics
 * @author Black Packet Team
 */

const os     = require('os');
const logger = require('./logger');

/* ── Session State ─────────────────────────────────────────────── */

const sessionStart = Date.now();

const metrics = {
    uploads:    { count: 0, bytes: 0, avgSpeed: 0, speeds: [] },
    downloads:  { count: 0, bytes: 0 },
    chunks:     { received: 0, retried: 0, failed: 0 },
    encryption: { encrypted: 0, shredded: 0 },
    contentFilter: { scanned: 0, blocked: 0, safe: 0 },
    peers:      { discovered: 0, active: 0 },
    throughput: [],  // { timestamp, bytesPerSec }
};

const MAX_THROUGHPUT_POINTS = 60; // Keep last 60 data points

/* ═══════════════════════════════════════════════════════════════════
   TRACKING FUNCTIONS
   ═══════════════════════════════════════════════════════════════════ */

function trackUpload(fileSize, durationMs) {
    metrics.uploads.count++;
    metrics.uploads.bytes += fileSize;
    const speed = durationMs > 0 ? (fileSize / (durationMs / 1000)) : 0;
    metrics.uploads.speeds.push(speed);
    /* Running average */
    metrics.uploads.avgSpeed = metrics.uploads.speeds.reduce((a, b) => a + b, 0) / metrics.uploads.speeds.length;
    
    recordThroughput(speed);
    logger.info('Analytics', `Upload tracked: ${(fileSize / 1024).toFixed(1)} KB in ${durationMs}ms`);
}

function trackDownload(fileSize) {
    metrics.downloads.count++;
    metrics.downloads.bytes += fileSize;
}

function trackChunk(type) {
    if (type === 'received') metrics.chunks.received++;
    else if (type === 'retried') metrics.chunks.retried++;
    else if (type === 'failed') metrics.chunks.failed++;
}

function trackEncryption(type) {
    if (type === 'encrypted') metrics.encryption.encrypted++;
    else if (type === 'shredded') metrics.encryption.shredded++;
}

function trackContentScan(result) {
    metrics.contentFilter.scanned++;
    if (result.allowed) metrics.contentFilter.safe++;
    else metrics.contentFilter.blocked++;
}

function trackPeer(action) {
    if (action === 'discovered') metrics.peers.discovered++;
    else if (action === 'active') metrics.peers.active++;
    else if (action === 'lost') metrics.peers.active = Math.max(0, metrics.peers.active - 1);
}

function recordThroughput(bytesPerSec) {
    metrics.throughput.push({
        timestamp: Date.now(),
        bytesPerSec: Math.round(bytesPerSec),
    });
    if (metrics.throughput.length > MAX_THROUGHPUT_POINTS) {
        metrics.throughput.shift();
    }
}

/* ═══════════════════════════════════════════════════════════════════
   REPORTING
   ═══════════════════════════════════════════════════════════════════ */

function getAnalytics() {
    const uptime = Math.round((Date.now() - sessionStart) / 1000);
    const mem = process.memoryUsage();
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    return {
        session: {
            startedAt:   sessionStart,
            uptimeSeconds: uptime,
            uptimeFormatted: formatUptime(uptime),
        },
        transfers: {
            uploads: {
                count:       metrics.uploads.count,
                totalBytes:  metrics.uploads.bytes,
                totalFormatted: formatBytes(metrics.uploads.bytes),
                avgSpeedBps: Math.round(metrics.uploads.avgSpeed),
                avgSpeedFormatted: formatBytes(metrics.uploads.avgSpeed) + '/s',
            },
            downloads: {
                count:       metrics.downloads.count,
                totalBytes:  metrics.downloads.bytes,
                totalFormatted: formatBytes(metrics.downloads.bytes),
            },
            chunks: { ...metrics.chunks },
        },
        security: {
            encryption: { ...metrics.encryption },
            contentFilter: { ...metrics.contentFilter },
        },
        network: {
            peers: { ...metrics.peers },
            throughput: metrics.throughput.slice(-30), // Last 30 points
        },
        system: {
            memoryUsed:  formatBytes(mem.heapUsed),
            memoryTotal: formatBytes(mem.heapTotal),
            memoryRSS:   formatBytes(mem.rss),
            memoryPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
            cpuCount:    cpus.length,
            cpuModel:    cpus[0]?.model || 'Unknown',
            loadAvg:     loadAvg.map(l => l.toFixed(2)),
            platform:    `${os.type()} ${os.release()}`,
            nodeVersion: process.version,
        },
    };
}

/**
 * Run a quick benchmark to measure system performance.
 * @returns {object} Benchmark results
 */
function runBenchmark() {
    const crypto = require('crypto');
    const results = {};

    /* 1. Hash benchmark: SHA-256 on 1MB data */
    const testData = crypto.randomBytes(1024 * 1024); // 1 MB
    const hashStart = process.hrtime.bigint();
    for (let i = 0; i < 100; i++) {
        crypto.createHash('sha256').update(testData).digest('hex');
    }
    const hashEnd = process.hrtime.bigint();
    const hashMs = Number(hashEnd - hashStart) / 1e6;
    results.hashBenchmark = {
        operation:  'SHA-256 × 100 (1MB blocks)',
        totalMs:    Math.round(hashMs),
        perOpMs:    (hashMs / 100).toFixed(2),
        throughput: formatBytes((1024 * 1024 * 100) / (hashMs / 1000)) + '/s',
    };

    /* 2. AES-256-GCM encrypt benchmark */
    const key = crypto.randomBytes(32);
    const iv  = crypto.randomBytes(16);
    const encStart = process.hrtime.bigint();
    for (let i = 0; i < 50; i++) {
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        cipher.update(testData);
        cipher.final();
        cipher.getAuthTag();
    }
    const encEnd = process.hrtime.bigint();
    const encMs = Number(encEnd - encStart) / 1e6;
    results.encryptBenchmark = {
        operation:  'AES-256-GCM × 50 (1MB blocks)',
        totalMs:    Math.round(encMs),
        perOpMs:    (encMs / 50).toFixed(2),
        throughput: formatBytes((1024 * 1024 * 50) / (encMs / 1000)) + '/s',
    };

    /* 3. Memory allocation benchmark */
    const memStart = process.hrtime.bigint();
    const buffers = [];
    for (let i = 0; i < 100; i++) {
        buffers.push(Buffer.alloc(256 * 1024)); // 256 KB
    }
    const memEnd = process.hrtime.bigint();
    const memMs = Number(memEnd - memStart) / 1e6;
    results.memoryBenchmark = {
        operation:  'Buffer.alloc × 100 (256KB)',
        totalMs:    Math.round(memMs),
        perOpMs:    (memMs / 100).toFixed(2),
        allocated:  formatBytes(256 * 1024 * 100),
    };

    /* 4. Random bytes generation */
    const rngStart = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) {
        crypto.randomBytes(32);
    }
    const rngEnd = process.hrtime.bigint();
    const rngMs = Number(rngEnd - rngStart) / 1e6;
    results.rngBenchmark = {
        operation:  'crypto.randomBytes(32) × 1000',
        totalMs:    Math.round(rngMs),
        perOpMs:    (rngMs / 1000).toFixed(4),
    };

    results.systemInfo = {
        platform:    `${os.type()} ${os.release()}`,
        cpuModel:    os.cpus()[0]?.model || 'Unknown',
        cpuCount:    os.cpus().length,
        totalMemory: formatBytes(os.totalmem()),
        freeMemory:  formatBytes(os.freemem()),
        nodeVersion: process.version,
    };

    results.timestamp = Date.now();
    return results;
}

/* ── Helpers ────────────────────────────────────────────────────── */

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

module.exports = {
    trackUpload,
    trackDownload,
    trackChunk,
    trackEncryption,
    trackContentScan,
    trackPeer,
    getAnalytics,
    runBenchmark,
};
