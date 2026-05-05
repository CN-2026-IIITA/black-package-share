/**
 * steganography.js — Steganographic Access Code Embedding
 * 
 * Hides a 6-digit access code inside an innocent-looking image
 * using LSB (Least Significant Bit) steganography.
 * 
 * Technique:
 *   1. Generate a branded gradient image (Black Packet colors)
 *   2. Embed payload in the LSB of the blue channel
 *   3. Encode as PNG (using Node's built-in zlib — zero deps)
 *   4. Receiver extracts code by reading LSBs (client-side Canvas API)
 * 
 * Payload format:  MAGIC (8 bits) + LENGTH (8 bits) + DATA (N × 8 bits)
 * 
 * @module utils/steganography
 * @author Black Packet Team
 */

const zlib   = require('zlib');
const logger = require('./logger');

/* ── Constants ──────────────────────────────────────────────────── */

const STEGO_MAGIC = 0xA5;           // 10100101 — magic marker byte
const IMAGE_WIDTH  = 128;
const IMAGE_HEIGHT = 128;

/* ═══════════════════════════════════════════════════════════════════
   PURE-JS MINIMAL PNG ENCODER  (no external dependencies)
   Uses Node built-in zlib for DEFLATE compression.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * CRC32 lookup table (pre-computed for speed).
 * @type {Uint32Array}
 */
const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        t[n] = c;
    }
    return t;
})();

/**
 * Compute CRC32 of a buffer.
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Build a single PNG chunk (length + type + data + crc).
 * @param {string} type - 4-char chunk type e.g. 'IHDR'
 * @param {Buffer} data - Chunk payload
 * @returns {Buffer}
 */
function pngChunk(type, data) {
    const len  = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);

    const tBuf = Buffer.from(type, 'ascii');
    const crc  = crc32(Buffer.concat([tBuf, data]));
    const cBuf = Buffer.alloc(4);
    cBuf.writeUInt32BE(crc, 0);

    return Buffer.concat([len, tBuf, data, cBuf]);
}

/**
 * Encode raw RGBA pixels into a PNG buffer.
 * 
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixels - RGBA pixel data (width × height × 4)
 * @returns {Buffer} PNG file buffer
 */
function encodePNG(width, height, pixels) {
    /* Add filter byte (0 = None) before every row */
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const rowOff = y * (1 + width * 4);
        raw[rowOff] = 0; // filter: None
        for (let i = 0; i < width * 4; i++) {
            raw[rowOff + 1 + i] = pixels[y * width * 4 + i];
        }
    }

    const compressed = zlib.deflateSync(raw, { level: 9 });

    /* IHDR data: width(4) + height(4) + bitDepth(1) + colorType(1) + comp(1) + filter(1) + interlace(1) */
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8]  = 8;  // 8-bit depth
    ihdr[9]  = 6;  // RGBA
    ihdr[10] = 0;  // compression
    ihdr[11] = 0;  // filter
    ihdr[12] = 0;  // interlace

    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    return Buffer.concat([
        signature,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', compressed),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

/* ═══════════════════════════════════════════════════════════════════
   IMAGE GENERATION — Branded gradient card
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Generate a visually interesting gradient image in Black Packet colors.
 * The gradient uses deterministic noise so the image looks natural
 * but the embedded data remains intact.
 * 
 * @param {number} width
 * @param {number} height
 * @param {number} seed - Deterministic seed for noise
 * @returns {Uint8Array} RGBA pixel buffer
 */
function generateCoverImage(width, height, seed) {
    const pixels = new Uint8Array(width * height * 4);

    /* Simple seeded PRNG for deterministic "noise" */
    let rng = seed;
    function nextRng() {
        rng = (rng * 1103515245 + 12345) & 0x7FFFFFFF;
        return (rng / 0x7FFFFFFF);
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const nx  = x / width;
            const ny  = y / height;

            /* Indigo-to-violet radial gradient (Black Packet brand) */
            const cx = nx - 0.5, cy = ny - 0.5;
            const dist = Math.sqrt(cx * cx + cy * cy) * 1.4;

            const r = Math.floor(30 + 69  * (1 - dist) + 40 * nx);
            const g = Math.floor(20 + 46  * (1 - dist) + 30 * ny);
            const b = Math.floor(80 + 161 * (1 - dist) + 20 * nx);

            /* Subtle deterministic noise (±6) */
            const noise = Math.floor(nextRng() * 12) - 6;

            pixels[idx]     = Math.max(0, Math.min(255, r + noise));        // R
            pixels[idx + 1] = Math.max(0, Math.min(255, g + noise));        // G
            pixels[idx + 2] = Math.max(0, Math.min(255, (b + noise) & 0xFE)); // B — clear LSB for embedding
            pixels[idx + 3] = 255;                                           // A
        }
    }

    return pixels;
}

/* ═══════════════════════════════════════════════════════════════════
   LSB STEGANOGRAPHY — Embed / Extract
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Embed a text payload into the Blue-channel LSBs of a pixel buffer.
 * 
 * Format:  MAGIC(8 bits) + LENGTH(8 bits) + DATA(N × 8 bits)
 * 
 * @param {Uint8Array} pixels - RGBA pixel data (modified in-place)
 * @param {string} text - The text to embed (e.g. "482917")
 */
function embedPayload(pixels, text) {
    const textBuf  = Buffer.from(text, 'utf8');
    const payload  = Buffer.from([STEGO_MAGIC, textBuf.length, ...textBuf]);

    let bitIdx = 0;
    for (let i = 0; i < payload.length; i++) {
        for (let bit = 7; bit >= 0; bit--) {
            const pixelBase = bitIdx * 4;           // RGBA stride
            const val = (payload[i] >> bit) & 1;
            pixels[pixelBase + 2] = (pixels[pixelBase + 2] & 0xFE) | val;  // Set Blue LSB
            bitIdx++;
        }
    }
}

/**
 * Extract a text payload from Blue-channel LSBs.
 * (This is the reference implementation; the real extraction
 *  happens client-side via Canvas API.)
 * 
 * @param {Uint8Array} pixels - RGBA pixel data
 * @returns {string|null} Extracted text, or null if not a stego image
 */
function extractPayload(pixels) {
    /* Read magic byte (8 bits) */
    let magic = 0;
    for (let i = 0; i < 8; i++) {
        magic = (magic << 1) | (pixels[i * 4 + 2] & 1);
    }
    if (magic !== STEGO_MAGIC) return null;

    /* Read length byte (8 bits) */
    let length = 0;
    for (let i = 8; i < 16; i++) {
        length = (length << 1) | (pixels[i * 4 + 2] & 1);
    }
    if (length === 0 || length > 64) return null;

    /* Read data bytes */
    let text = '';
    for (let c = 0; c < length; c++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
            const pxIdx = (16 + c * 8 + bit) * 4 + 2;
            byte = (byte << 1) | (pixels[pxIdx] & 1);
        }
        text += String.fromCharCode(byte);
    }

    return text;
}

/* ═══════════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Create a steganographic share-card image containing the access code.
 * Returns a base64-encoded PNG data URL.
 * 
 * @param {string} accessCode - The 6-digit access code to embed
 * @returns {string} data:image/png;base64,… string
 */
function createStegoImage(accessCode) {
    const seed   = parseInt(accessCode, 10) || 42;
    const pixels = generateCoverImage(IMAGE_WIDTH, IMAGE_HEIGHT, seed);

    embedPayload(pixels, accessCode);

    const png    = encodePNG(IMAGE_WIDTH, IMAGE_HEIGHT, pixels);
    const base64 = png.toString('base64');

    logger.info('Stego', `Share-card generated for code ${accessCode} (${IMAGE_WIDTH}×${IMAGE_HEIGHT})`);
    return `data:image/png;base64,${base64}`;
}

/**
 * Server-side extraction (for testing / verification).
 * 
 * @param {Buffer} pngBuffer - Raw PNG file buffer
 * @returns {string|null} Extracted access code, or null
 */
function extractFromPNG(pngBuffer) {
    /* This is a simplified approach: we decode RGBA pixels from the PNG.
       Since we only need LSBs, a full decoder isn't strictly needed,
       but for correctness we parse the PNG properly. */
    try {
        /* Skip PNG signature (8 bytes), then read chunks */
        let pos = 8;
        let width = 0, height = 0;
        const idatChunks = [];

        while (pos < pngBuffer.length) {
            const len  = pngBuffer.readUInt32BE(pos); pos += 4;
            const type = pngBuffer.subarray(pos, pos + 4).toString('ascii'); pos += 4;
            const data = pngBuffer.subarray(pos, pos + len); pos += len;
            pos += 4; // skip CRC

            if (type === 'IHDR') {
                width  = data.readUInt32BE(0);
                height = data.readUInt32BE(4);
            } else if (type === 'IDAT') {
                idatChunks.push(data);
            } else if (type === 'IEND') {
                break;
            }
        }

        const compressed = Buffer.concat(idatChunks);
        const raw        = zlib.inflateSync(compressed);

        /* Remove filter bytes (one per row) to get pure RGBA */
        const pixels = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            const rowOff = y * (1 + width * 4);
            for (let i = 0; i < width * 4; i++) {
                pixels[y * width * 4 + i] = raw[rowOff + 1 + i];
            }
        }

        return extractPayload(pixels);
    } catch (err) {
        logger.warn('Stego', `Extraction failed: ${err.message}`);
        return null;
    }
}

module.exports = {
    createStegoImage,
    extractPayload,
    extractFromPNG,
    STEGO_MAGIC,
};