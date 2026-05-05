/**
 * chunkTransfer.js — Chunk-Based File Transfer Engine
 * 
 * Core networking module implementing:
 *  • File splitting into configurable-size chunks
 *  • SHA-256 integrity verification per chunk
 *  • ACK-based transfer protocol (send → ack → next)
 *  • Retry logic with exponential backoff
 *  • Resume capability via chunk-index tracking
 * 
 * Protocol Flow:
 *   1. Sender calls splitFile() to get an array of chunks
 *   2. Each chunk is sent to the server and stored individually
 *   3. Server ACKs each chunk; on failure the sender retries
 *   4. After all ACKs are received, assembleFile() reconstructs the file
 * 
 * @module networking/chunkTransfer
 * @author Black Packet Team (Member 3)
 */

const crypto        = require('crypto');
const fs            = require('fs');
const path          = require('path');
const logger        = require('../utils/logger');
const helpers       = require('../utils/helpers');
const cryptoShredder = require('../utils/cryptoShredder');

/* ── Constants ──────────────────────────────────────────────────── */

/** Default chunk size: 256 KB */
const DEFAULT_CHUNK_SIZE = 256 * 1024;

/** Maximum retry attempts per chunk */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_RETRY_DELAY = 1000;

/* ── Transfer State Store ───────────────────────────────────────── */

/**
 * In-memory map of active transfers.
 * Key   = transferId (UUID string)
 * Value = TransferState object
 * 
 * @type {Map<string, TransferState>}
 * 
 * @typedef {Object} TransferState
 * @property {string}   transferId
 * @property {string}   fileName
 * @property {number}   fileSize
 * @property {number}   chunkSize
 * @property {number}   totalChunks
 * @property {Set<number>} receivedChunks - indices already ACKed
 * @property {Object.<number,string>} chunkHashes - expected hash per index
 * @property {string}   status   - 'pending' | 'in-progress' | 'completed' | 'failed'
 * @property {number}   createdAt
 * @property {number}   updatedAt
 * @property {string}   uploadDir - directory holding chunk files
 */
const activeTransfers = new Map();

/* ── Public API ─────────────────────────────────────────────────── */

/**
 * Initialize a new chunked transfer session.
 * 
 * @param {string} transferId - Unique transfer identifier
 * @param {string} fileName   - Original file name
 * @param {number} fileSize   - Total file size in bytes
 * @param {string} uploadDir  - Directory to store chunk blobs
 * @returns {TransferState} The freshly created transfer state
 */
function initTransfer(transferId, fileName, fileSize, uploadDir) {
    const chunkSize   = helpers.getOptimalChunkSize(fileSize);
    const totalChunks = Math.ceil(fileSize / chunkSize);

    /* Initialize cryptographic key vault for this transfer */
    cryptoShredder.initVault(transferId);

    const state = {
        transferId,
        fileName,
        fileSize,
        chunkSize,
        totalChunks,
        receivedChunks: new Set(),
        chunkHashes: {},
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        uploadDir,
    };

    activeTransfers.set(transferId, state);
    logger.info('ChunkTransfer', `Initialized transfer ${transferId.substring(0, 8)}… — ${helpers.formatFileSize(fileSize)}, ${totalChunks} chunks × ${helpers.formatFileSize(chunkSize)} [encrypted]`);
    return state;
}

/**
 * Process and store a received chunk.
 * 
 * Steps:
 *  1. Validate chunk index bounds
 *  2. Compute and record SHA-256 hash
 *  3. Write chunk to disk
 *  4. Mark chunk as received
 *  5. Update transfer state
 * 
 * @param {string} transferId - Transfer this chunk belongs to
 * @param {number} chunkIndex - Zero-based index of this chunk
 * @param {Buffer} chunkData  - Raw chunk bytes
 * @returns {{ success: boolean, hash?: string, error?: string }}
 */
function processChunk(transferId, chunkIndex, chunkData) {
    const state = activeTransfers.get(transferId);
    if (!state) {
        return { success: false, error: 'Transfer not found' };
    }

    /* Bounds check */
    if (chunkIndex < 0 || chunkIndex >= state.totalChunks) {
        return { success: false, error: `Invalid chunk index: ${chunkIndex}` };
    }

    /* Duplicate check — idempotent for retries */
    if (state.receivedChunks.has(chunkIndex)) {
        logger.warn('ChunkTransfer', `Duplicate chunk ${chunkIndex} for ${transferId.substring(0, 8)}… (accepted)`);
        return { success: true, hash: state.chunkHashes[chunkIndex] };
    }

    try {
        /* Integrity hash (computed on plaintext before encryption) */
        const hash = helpers.generateHash(chunkData);
        state.chunkHashes[chunkIndex] = hash;

        /* Encrypt chunk with a unique per-chunk AES-256-GCM key */
        const encryptedChunk = cryptoShredder.encryptChunk(transferId, chunkIndex, chunkData);

        /* Persist ENCRYPTED chunk to disk */
        const chunkPath = path.join(state.uploadDir, `chunk_${chunkIndex}`);
        fs.writeFileSync(chunkPath, encryptedChunk);

        /* Update state */
        state.receivedChunks.add(chunkIndex);
        state.status    = 'in-progress';
        state.updatedAt = Date.now();

        logger.transfer(transferId, chunkIndex + 1, state.totalChunks, 'received ✓ [encrypted]');

        return { success: true, hash };
    } catch (err) {
        logger.error('ChunkTransfer', `Failed to process chunk ${chunkIndex}`, err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Assemble all received chunks into the final file.
 * 
 * Reads each chunk file in index order and writes them sequentially
 * into a single output file.
 * 
 * @param {string} transferId - Transfer to assemble
 * @param {string} outputPath - Full path for the assembled file
 * @returns {{ success: boolean, filePath?: string, hash?: string, error?: string }}
 */
function assembleFile(transferId, outputPath) {
    const state = activeTransfers.get(transferId);
    if (!state) {
        return { success: false, error: 'Transfer not found' };
    }

    /* Ensure every chunk has been received */
    if (state.receivedChunks.size !== state.totalChunks) {
        const missing = getMissingChunks(transferId);
        return { success: false, error: `Missing chunks: ${missing.join(', ')}` };
    }

    try {
        /* Read and DECRYPT all chunks, then concatenate */
        const chunkBuffers = [];
        for (let i = 0; i < state.totalChunks; i++) {
            const chunkPath     = path.join(state.uploadDir, `chunk_${i}`);
            const encryptedData = fs.readFileSync(chunkPath);
            const decrypted     = cryptoShredder.decryptChunk(transferId, i, encryptedData);
            chunkBuffers.push(decrypted);
        }

        const plainBuffer = Buffer.concat(chunkBuffers);

        /* Compute final file hash on plaintext */
        const fileHash = helpers.generateHash(plainBuffer);

        /* Re-encrypt assembled file with a single file-level key */
        const { encrypted } = cryptoShredder.encryptFile(transferId, plainBuffer);
        fs.writeFileSync(outputPath, encrypted);

        /* Mark transfer as completed */
        state.status    = 'completed';
        state.updatedAt = Date.now();

        /* Clean up individual chunk files */
        cleanupChunks(state);

        logger.info('ChunkTransfer', `File assembled & encrypted: ${outputPath} (${helpers.formatFileSize(state.fileSize)}) hash=${fileHash.substring(0, 16)}…`);
        return { success: true, filePath: outputPath, hash: fileHash };
    } catch (err) {
        logger.error('ChunkTransfer', 'Assembly failed', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Return the list of chunk indices that have NOT been received yet.
 * Used by the resume mechanism so the sender can skip already-ACKed chunks.
 * 
 * @param {string} transferId
 * @returns {number[]} Array of missing chunk indices
 */
function getMissingChunks(transferId) {
    const state = activeTransfers.get(transferId);
    if (!state) return [];

    const missing = [];
    for (let i = 0; i < state.totalChunks; i++) {
        if (!state.receivedChunks.has(i)) missing.push(i);
    }
    return missing;
}

/**
 * Get the current progress of a transfer.
 * 
 * @param {string} transferId
 * @returns {{ received: number, total: number, percentage: number, status: string } | null}
 */
function getTransferProgress(transferId) {
    const state = activeTransfers.get(transferId);
    if (!state) return null;

    return {
        transferId:  state.transferId,
        fileName:    state.fileName,
        fileSize:    state.fileSize,
        chunkSize:   state.chunkSize,
        received:    state.receivedChunks.size,
        total:       state.totalChunks,
        percentage:  Math.round((state.receivedChunks.size / state.totalChunks) * 100),
        status:      state.status,
        createdAt:   state.createdAt,
        updatedAt:   state.updatedAt,
    };
}

/**
 * Calculate the retry delay using exponential backoff.
 * 
 * @param {number} attempt - The current attempt number (0-based)
 * @returns {number} Delay in milliseconds
 */
function getRetryDelay(attempt) {
    /* Exponential backoff: 1 s, 2 s, 4 s … capped at 10 s */
    const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, attempt), 10000);
    /* Add ±25 % jitter */
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
}

/**
 * Remove a transfer and its associated data from memory.
 * 
 * @param {string} transferId
 */
function removeTransfer(transferId) {
    const state = activeTransfers.get(transferId);
    if (state) {
        cleanupChunks(state);
        activeTransfers.delete(transferId);
        logger.info('ChunkTransfer', `Transfer ${transferId.substring(0, 8)}… removed`);
    }
}

/**
 * Get all active transfer IDs.
 * @returns {string[]}
 */
function getActiveTransfers() {
    return Array.from(activeTransfers.keys());
}

/* ── Internal Helpers ───────────────────────────────────────────── */

/**
 * Delete individual chunk files after successful assembly.
 * @param {TransferState} state
 */
function cleanupChunks(state) {
    try {
        for (let i = 0; i < state.totalChunks; i++) {
            const chunkPath = path.join(state.uploadDir, `chunk_${i}`);
            if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
        }
    } catch (err) {
        logger.warn('ChunkTransfer', 'Chunk cleanup issue', err.message);
    }
}

/* ── Exports ────────────────────────────────────────────────────── */

module.exports = {
    DEFAULT_CHUNK_SIZE,
    MAX_RETRIES,
    initTransfer,
    processChunk,
    assembleFile,
    getMissingChunks,
    getTransferProgress,
    getRetryDelay,
    removeTransfer,
    getActiveTransfers,
};
