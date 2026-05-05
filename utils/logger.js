/**
 * logger.js — Black Packet Logging Utility
 * 
 * Provides colored, timestamped console logging with multiple log levels.
 * Used across all modules for consistent, traceable output.
 * 
 * @module utils/logger
 * @author Black Packet Team (Member 4)
 */

/* ── ANSI Color Codes ───────────────────────────────────────────── */
const COLORS = {
    reset:   '\x1b[0m',
    red:     '\x1b[31m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    blue:    '\x1b[34m',
    magenta: '\x1b[35m',
    cyan:    '\x1b[36m',
    gray:    '\x1b[90m',
};

/* ── Log Level Definitions ──────────────────────────────────────── */
const LOG_LEVELS = {
    DEBUG: { priority: 0, color: COLORS.gray,    label: 'DEBUG' },
    INFO:  { priority: 1, color: COLORS.green,   label: 'INFO ' },
    WARN:  { priority: 2, color: COLORS.yellow,  label: 'WARN ' },
    ERROR: { priority: 3, color: COLORS.red,     label: 'ERROR' },
};

/** Current minimum log level (can be set via environment variable) */
let currentLevel = LOG_LEVELS.DEBUG.priority;

/**
 * Formats the current timestamp as ISO-like string for log entries.
 * @returns {string} Formatted timestamp e.g. "2024-03-15 14:30:22"
 */
function getTimestamp() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Core logging function — formats and prints a log message.
 * @param {string} level  - One of 'DEBUG', 'INFO', 'WARN', 'ERROR'
 * @param {string} module - The module name originating the log
 * @param {string} message - The log message
 * @param {*} [data]       - Optional data to attach
 */
function log(level, module, message, data = null) {
    const levelConfig = LOG_LEVELS[level];

    /* Skip if below current threshold */
    if (!levelConfig || levelConfig.priority < currentLevel) return;

    const timestamp = getTimestamp();
    const prefix = `${COLORS.gray}[${timestamp}]${COLORS.reset} `
                 + `${levelConfig.color}[${levelConfig.label}]${COLORS.reset} `
                 + `${COLORS.cyan}[${module}]${COLORS.reset}`;

    console.log(`${prefix} ${message}`);

    if (data !== null) {
        console.log(`${COLORS.gray}  └─ data:`, data, COLORS.reset);
    }
}

/* ── Public API ─────────────────────────────────────────────────── */
const logger = {
    /**
     * Log a debug-level message.
     * @param {string} module  - Originating module
     * @param {string} message - Log content
     * @param {*} [data]       - Optional payload
     */
    debug: (module, message, data) => log('DEBUG', module, message, data),

    /**
     * Log an info-level message.
     */
    info: (module, message, data) => log('INFO', module, message, data),

    /**
     * Log a warning-level message.
     */
    warn: (module, message, data) => log('WARN', module, message, data),

    /**
     * Log an error-level message.
     */
    error: (module, message, data) => log('ERROR', module, message, data),

    /**
     * Set the minimum log level at runtime.
     * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
     */
    setLevel: (level) => {
        if (LOG_LEVELS[level]) {
            currentLevel = LOG_LEVELS[level].priority;
        }
    },

    /**
     * Log a file-related operation (convenience wrapper).
     * @param {string} operation - e.g. 'UPLOAD', 'DOWNLOAD', 'DELETE'
     * @param {string} filename  - The filename involved
     * @param {string} status    - e.g. 'started', 'completed', 'failed'
     */
    fileOp: (operation, filename, status) => {
        log('INFO', 'FILE-OP', `${operation} — ${filename} — ${status}`);
    },

    /**
     * Log a transfer event with chunk details.
     * @param {string} transferId - Unique transfer identifier
     * @param {number} chunkIndex - Current chunk index
     * @param {number} totalChunks - Total number of chunks
     * @param {string} status     - 'sent', 'acked', 'failed'
     */
    transfer: (transferId, chunkIndex, totalChunks, status) => {
        const shortId = transferId.substring(0, 8);
        const progress = ((chunkIndex / totalChunks) * 100).toFixed(1);
        log('INFO', 'TRANSFER', `[${shortId}] Chunk ${chunkIndex}/${totalChunks} (${progress}%) — ${status}`);
    },
};

module.exports = logger;
