/**
 * contentFilter.js — Content Safety Scanner
 * 
 * Implements file-level content filtering to prevent
 * transfer of potentially dangerous or explicit content.
 * Uses rule-based analysis (RAG-inspired pattern matching):
 *   1. File extension blacklist (executables, scripts)
 *   2. Filename pattern detection (suspicious naming)
 *   3. MIME type validation
 *   4. File size anomaly detection
 * 
 * @module utils/contentFilter
 * @author Black Packet Team
 */

const path   = require('path');
const logger = require('./logger');

/* ── Blocked Extensions ────────────────────────────────────────── */

const BLOCKED_EXTENSIONS = new Set([
    '.exe', '.bat', '.cmd', '.scr', '.pif', '.com',
    '.msi', '.msp', '.mst',
    '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
    '.ps1', '.ps1xml', '.ps2', '.ps2xml', '.psc1', '.psc2',
    '.reg', '.inf', '.hta',
    '.cpl', '.sys', '.dll', '.drv',
    '.sh', '.bash', '.csh', '.ksh',
]);

/* ── Suspicious Filename Patterns ──────────────────────────────── */

const SUSPICIOUS_PATTERNS = [
    /crack/i, /keygen/i, /hack/i, /exploit/i,
    /malware/i, /virus/i, /trojan/i, /worm/i,
    /ransomware/i, /rootkit/i, /backdoor/i,
    /phishing/i, /spyware/i, /adware/i,
    /nsfw/i, /xxx/i, /porn/i, /explicit/i,
    /password[\s_-]?list/i, /credential/i,
    /\.\.[\\/]/,  // Path traversal
];

/* ── Allowed MIME Categories ───────────────────────────────────── */

const ALLOWED_MIME_PREFIXES = [
    'image/', 'video/', 'audio/', 'text/',
    'application/pdf', 'application/json',
    'application/xml', 'application/zip',
    'application/gzip', 'application/x-tar',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/vnd.openxmlformats',
    'application/vnd.ms-',
    'application/octet-stream',
];

/* ── Scan Result Levels ────────────────────────────────────────── */

const RISK_LEVELS = {
    SAFE:       { level: 'safe',       score: 100, color: '#00ff88' },
    LOW:        { level: 'low',        score: 75,  color: '#f59e0b' },
    MEDIUM:     { level: 'medium',     score: 50,  color: '#f97316' },
    HIGH:       { level: 'high',       score: 25,  color: '#ef4444' },
    BLOCKED:    { level: 'blocked',    score: 0,   color: '#dc2626' },
};

/* ═══════════════════════════════════════════════════════════════════
   SCAN ENGINE
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Scan a file for content safety.
 * @param {string} fileName - Original filename
 * @param {number} fileSize - File size in bytes
 * @param {string} [mimeType] - MIME type if known
 * @returns {{ allowed: boolean, risk: object, reasons: string[], scannedAt: number }}
 */
function scanFile(fileName, fileSize, mimeType = 'application/octet-stream') {
    const reasons = [];
    let riskLevel = RISK_LEVELS.SAFE;

    const ext = path.extname(fileName).toLowerCase();

    /* 1. Extension check */
    if (BLOCKED_EXTENSIONS.has(ext)) {
        reasons.push(`Blocked extension: ${ext}`);
        riskLevel = RISK_LEVELS.BLOCKED;
    }

    /* 2. Filename pattern check */
    for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(fileName)) {
            reasons.push(`Suspicious filename pattern: ${pattern.source}`);
            if (riskLevel.score > RISK_LEVELS.MEDIUM.score) {
                riskLevel = RISK_LEVELS.MEDIUM;
            }
        }
    }

    /* 3. Double extension detection (e.g., file.pdf.exe) */
    const parts = fileName.split('.');
    if (parts.length > 2) {
        const innerExt = '.' + parts[parts.length - 2].toLowerCase();
        if (BLOCKED_EXTENSIONS.has(innerExt) || BLOCKED_EXTENSIONS.has(ext)) {
            reasons.push('Double extension detected — possible disguised executable');
            riskLevel = RISK_LEVELS.HIGH;
        }
    }

    /* 4. File size anomaly */
    const MAX_SIZE = 500 * 1024 * 1024; // 500 MB
    if (fileSize > MAX_SIZE) {
        reasons.push(`File exceeds maximum allowed size (${Math.round(fileSize / 1024 / 1024)}MB > 500MB)`);
        riskLevel = RISK_LEVELS.BLOCKED;
    }
    if (fileSize === 0) {
        reasons.push('Empty file (0 bytes)');
        if (riskLevel.score > RISK_LEVELS.LOW.score) {
            riskLevel = RISK_LEVELS.LOW;
        }
    }

    /* 5. MIME type validation */
    const mimeAllowed = ALLOWED_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix));
    if (!mimeAllowed) {
        reasons.push(`Unrecognized MIME type: ${mimeType}`);
        if (riskLevel.score > RISK_LEVELS.LOW.score) {
            riskLevel = RISK_LEVELS.LOW;
        }
    }

    const result = {
        allowed:   riskLevel.score > 0,
        risk:      riskLevel,
        reasons:   reasons.length > 0 ? reasons : ['No issues detected'],
        scannedAt: Date.now(),
        fileName,
        fileSize,
        mimeType,
    };

    logger.info('ContentFilter', `Scanned "${fileName}" — ${riskLevel.level} (score: ${riskLevel.score})`);

    return result;
}

/**
 * Quick check if a file extension is blocked.
 * @param {string} fileName
 * @returns {boolean}
 */
function isBlocked(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return BLOCKED_EXTENSIONS.has(ext);
}

/**
 * Get the list of blocked extensions.
 * @returns {string[]}
 */
function getBlockedExtensions() {
    return [...BLOCKED_EXTENSIONS];
}

module.exports = { scanFile, isBlocked, getBlockedExtensions };
