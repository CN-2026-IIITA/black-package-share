/**
 * testCases.js — Black Packet Test Suite
 * 
 * Lightweight test runner with unit + integration tests.
 * No external test framework required — runs with plain Node.js.
 * 
 * Usage: node test/testCases.js
 * 
 * @module test/testCases
 * @author Black Packet Team (Member 4)
 */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

/* ── Module imports ─────────────────────────────────────────────── */
const helpers       = require('../utils/helpers');
const logger        = require('../utils/logger');
const chunkTransfer = require('../networking/chunkTransfer');

/* ── Test Runner ────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const results = [];

/**
 * Run a single test case.
 * @param {string} name        - Test description
 * @param {Function} testFn    - Test function (may throw on failure)
 */
function test(name, testFn) {
    try {
        testFn();
        passed++;
        results.push({ name, status: '✅ PASS' });
        console.log(`  ✅ ${name}`);
    } catch (err) {
        failed++;
        results.push({ name, status: '❌ FAIL', error: err.message });
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${err.message}`);
    }
}

/**
 * Simple assertion helper.
 */
function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label || 'Value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

/* ═══════════════════════════════════════════════════════════════════
   TEST SUITES
   ═══════════════════════════════════════════════════════════════════ */

console.log('\n══════════════════════════════════════════');
console.log('  Black Packet — Test Suite');
console.log('══════════════════════════════════════════\n');

/* ── 1. Helpers: File Size Formatting ───────────────────────────── */
console.log('📦 helpers.formatFileSize()');

test('formats 0 bytes', () => {
    assertEqual(helpers.formatFileSize(0), '0 Bytes', 'formatFileSize(0)');
});

test('formats bytes', () => {
    assertEqual(helpers.formatFileSize(500), '500 Bytes', 'formatFileSize(500)');
});

test('formats KB', () => {
    assertEqual(helpers.formatFileSize(1024), '1 KB', 'formatFileSize(1024)');
});

test('formats MB', () => {
    assertEqual(helpers.formatFileSize(1048576), '1 MB', 'formatFileSize(1 MB)');
});

test('formats GB', () => {
    assertEqual(helpers.formatFileSize(1073741824), '1 GB', 'formatFileSize(1 GB)');
});

/* ── 2. Helpers: Duration Formatting ────────────────────────────── */
console.log('\n⏱️  helpers.formatDuration()');

test('formats milliseconds', () => {
    assertEqual(helpers.formatDuration(500), '500ms', 'formatDuration(500)');
});

test('formats seconds', () => {
    assertEqual(helpers.formatDuration(5000), '5s', 'formatDuration(5000)');
});

test('formats minutes and seconds', () => {
    assertEqual(helpers.formatDuration(125000), '2m 5s', 'formatDuration(125000)');
});

/* ── 3. Helpers: Hash Generation ────────────────────────────────── */
console.log('\n🔐 helpers.generateHash()');

test('generates consistent SHA-256 hash', () => {
    const buf = Buffer.from('hello world');
    const hash1 = helpers.generateHash(buf);
    const hash2 = helpers.generateHash(buf);
    assertEqual(hash1, hash2, 'Hash consistency');
    assertEqual(hash1.length, 64, 'SHA-256 hex length');
});

test('different data produces different hash', () => {
    const hash1 = helpers.generateHash(Buffer.from('data1'));
    const hash2 = helpers.generateHash(Buffer.from('data2'));
    assert(hash1 !== hash2, 'Hashes should differ');
});

/* ── 4. Helpers: Access Code Generation ─────────────────────────── */
console.log('\n🔑 helpers.generateAccessCode()');

test('generates 6-digit code', () => {
    const code = helpers.generateAccessCode();
    assertEqual(code.length, 6, 'Code length');
    assert(/^\d{6}$/.test(code), 'Must be 6 digits');
});

test('generates unique codes', () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
        codes.add(helpers.generateAccessCode());
    }
    assert(codes.size > 90, 'Most codes should be unique (>90/100)');
});

/* ── 5. Helpers: Filename Validation ────────────────────────────── */
console.log('\n📁 helpers.isValidFilename()');

test('accepts valid filename', () => {
    assert(helpers.isValidFilename('report.pdf'), 'report.pdf should be valid');
});

test('rejects empty filename', () => {
    assert(!helpers.isValidFilename(''), 'Empty should be invalid');
});

test('rejects null', () => {
    assert(!helpers.isValidFilename(null), 'Null should be invalid');
});

test('rejects path traversal', () => {
    assert(!helpers.isValidFilename('..'), '.. should be invalid');
});

/* ── 6. Helpers: Optimal Chunk Size ─────────────────────────────── */
console.log('\n📐 helpers.getOptimalChunkSize()');

test('small file gets 64KB chunks', () => {
    assertEqual(helpers.getOptimalChunkSize(500 * 1024), 64 * 1024, '<1MB chunk size');
});

test('medium file gets 256KB chunks', () => {
    assertEqual(helpers.getOptimalChunkSize(5 * 1024 * 1024), 256 * 1024, '<10MB chunk size');
});

test('large file gets 512KB chunks', () => {
    assertEqual(helpers.getOptimalChunkSize(50 * 1024 * 1024), 512 * 1024, '<100MB chunk size');
});

test('very large file gets 1MB chunks', () => {
    assertEqual(helpers.getOptimalChunkSize(200 * 1024 * 1024), 1024 * 1024, '>100MB chunk size');
});

/* ── 7. Helpers: Expiry Check ───────────────────────────────────── */
console.log('\n⏰ helpers.isExpired()');

test('recent timestamp not expired', () => {
    assert(!helpers.isExpired(Date.now(), 30), 'Should not be expired');
});

test('old timestamp is expired', () => {
    const oldTime = Date.now() - 60 * 60 * 1000; // 1 hour ago
    assert(helpers.isExpired(oldTime, 30), 'Should be expired');
});

/* ── 8. Chunk Transfer: Init ────────────────────────────────────── */
console.log('\n📤 chunkTransfer.initTransfer()');

const testUploadDir = path.join(__dirname, '..', 'uploads', 'test-transfer');
if (!fs.existsSync(testUploadDir)) fs.mkdirSync(testUploadDir, { recursive: true });

test('initializes transfer correctly', () => {
    const state = chunkTransfer.initTransfer(
        'test-id-001', 'test.txt', 1024 * 1024, testUploadDir
    );
    assertEqual(state.fileName, 'test.txt', 'fileName');
    assertEqual(state.fileSize, 1024 * 1024, 'fileSize');
    assert(state.totalChunks > 0, 'totalChunks should be > 0');
    assertEqual(state.status, 'pending', 'status');
});

/* ── 9. Chunk Transfer: Process Chunk ───────────────────────────── */
console.log('\n📥 chunkTransfer.processChunk()');

test('processes a valid chunk', () => {
    const data = crypto.randomBytes(256);
    const result = chunkTransfer.processChunk('test-id-001', 0, data);
    assert(result.success, 'Should succeed');
    assert(result.hash, 'Should return hash');
});

test('rejects invalid chunk index', () => {
    const data = crypto.randomBytes(256);
    const result = chunkTransfer.processChunk('test-id-001', 999, data);
    assert(!result.success, 'Should fail for out-of-range index');
});

test('rejects unknown transfer', () => {
    const data = crypto.randomBytes(256);
    const result = chunkTransfer.processChunk('nonexistent', 0, data);
    assert(!result.success, 'Should fail for unknown transfer');
});

/* ── 10. Chunk Transfer: Progress ───────────────────────────────── */
console.log('\n📊 chunkTransfer.getTransferProgress()');

test('returns progress for active transfer', () => {
    const progress = chunkTransfer.getTransferProgress('test-id-001');
    assert(progress !== null, 'Should return progress');
    assertEqual(progress.received, 1, 'Should have 1 received chunk');
    assert(progress.percentage > 0, 'Percentage should be > 0');
});

test('returns null for unknown transfer', () => {
    const progress = chunkTransfer.getTransferProgress('nonexistent');
    assertEqual(progress, null, 'Should be null');
});

/* ── 11. Chunk Transfer: Missing Chunks ─────────────────────────── */
console.log('\n🔍 chunkTransfer.getMissingChunks()');

test('returns missing chunk indices', () => {
    const missing = chunkTransfer.getMissingChunks('test-id-001');
    assert(Array.isArray(missing), 'Should return array');
    assert(missing.length > 0, 'Should have missing chunks');
    assert(!missing.includes(0), 'Chunk 0 should NOT be missing');
});

/* ── 12. Chunk Transfer: Retry Delay ────────────────────────────── */
console.log('\n🔄 chunkTransfer.getRetryDelay()');

test('first retry is ~1 second', () => {
    const delay = chunkTransfer.getRetryDelay(0);
    assert(delay >= 750 && delay <= 1250, `Delay should be ~1000ms, got ${delay}`);
});

test('delays increase with attempts', () => {
    const d1 = chunkTransfer.getRetryDelay(0);
    const d2 = chunkTransfer.getRetryDelay(1);
    const d3 = chunkTransfer.getRetryDelay(2);
    /* Due to jitter, we check the general trend */
    assert(d2 > d1 * 0.8, 'Second delay should be larger');
    assert(d3 > d2 * 0.8, 'Third delay should be larger');
});

/* ── 13. Chunk Transfer: Cleanup ────────────────────────────────── */
console.log('\n🧹 chunkTransfer.removeTransfer()');

test('removes a transfer', () => {
    chunkTransfer.removeTransfer('test-id-001');
    const progress = chunkTransfer.getTransferProgress('test-id-001');
    assertEqual(progress, null, 'Should be null after removal');
});

/* ── Cleanup test artifacts ─────────────────────────────────────── */
try {
    if (fs.existsSync(testUploadDir)) {
        fs.rmSync(testUploadDir, { recursive: true, force: true });
    }
} catch { /* ignore */ }

/* ═══════════════════════════════════════════════════════════════════
   RESULTS SUMMARY
   ═══════════════════════════════════════════════════════════════════ */

console.log('\n══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('══════════════════════════════════════════\n');

if (failed > 0) {
    console.log('Failed tests:');
    results.filter((r) => r.status.includes('FAIL')).forEach((r) => {
        console.log(`  ❌ ${r.name}: ${r.error}`);
    });
    console.log('');
    process.exit(1);
} else {
    console.log('  🎉 All tests passed!\n');
    process.exit(0);
}
