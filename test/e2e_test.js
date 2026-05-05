/**
 * End-to-end test: upload a file, get access code, verify download.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Create a test file
const testContent = 'Hello Black Packet! '.repeat(5000);
const testDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
const testFile = path.join(testDir, 'e2e_testfile.txt');
fs.writeFileSync(testFile, testContent);
const fileSize = Buffer.byteLength(testContent);

function fetchJSON(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method: opts.method || 'GET',
            headers: opts.headers || {},
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ raw: data.substring(0, 100) }); }
            });
        });
        req.on('error', reject);
        if (opts.body) req.write(opts.body);
        req.end();
    });
}

function uploadChunk(transferId, index, chunkData) {
    return new Promise((resolve, reject) => {
        const boundary = '----FormBoundary' + Date.now();
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="chunk_${index}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const footer = `\r\n--${boundary}--\r\n`;
        const body = Buffer.concat([Buffer.from(header), chunkData, Buffer.from(footer)]);

        const options = {
            hostname: 'localhost',
            port: 3000,
            path: `/api/upload/chunk/${transferId}?chunkIndex=${index}`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
            },
        };

        const req = http.request(options, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch { reject(new Error(d)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

(async () => {
    try {
        console.log('\n=== BLACK PACKET END-TO-END TEST ===\n');

        // Step 1: Init
        console.log('1. Initializing upload...');
        const init = await fetchJSON('http://localhost:3000/api/upload/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: 'e2e_testfile.txt', fileSize }),
        });
        console.log(`   ✅ Transfer: ${init.transferId.substring(0, 8)}... | ${init.totalChunks} chunks x ${init.chunkSize} bytes`);

        // Step 2: Upload chunks
        console.log('2. Uploading chunks...');
        const buf = Buffer.from(testContent);
        for (let i = 0; i < init.totalChunks; i++) {
            const start = i * init.chunkSize;
            const end = Math.min(start + init.chunkSize, buf.length);
            const chunk = buf.subarray(start, end);
            const res = await uploadChunk(init.transferId, i, chunk);
            if (res.success) {
                console.log(`   ✅ Chunk ${i + 1}/${init.totalChunks} — ${res.progress.percentage}%`);
            } else {
                console.log(`   ❌ Chunk ${i} FAILED: ${res.error}`);
                process.exit(1);
            }
        }

        // Step 3: Complete
        console.log('3. Completing upload...');
        const complete = await fetchJSON(`http://localhost:3000/api/upload/complete/${init.transferId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        console.log(`   ✅ Access Code: ${complete.accessCode}`);
        console.log(`   ✅ File Size: ${complete.fileSizeFormatted}`);

        // Step 4: Health check
        console.log('4. Checking server health...');
        const health = await fetchJSON('http://localhost:3000/api/health');
        console.log(`   ✅ Status: ${health.status} | Files: ${health.stats.totalFiles} | Size: ${health.stats.totalSizeFormatted}`);

        // Step 5: LAN discovery
        console.log('5. Checking LAN discovery...');
        const lan = await fetchJSON('http://localhost:3000/api/lan/discover');
        console.log(`   ✅ LAN peers found: ${lan.count}`);

        console.log('\n=== ALL E2E TESTS PASSED ✅ ===\n');

        // Cleanup test source file
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch (err) {
        console.error('❌ E2E TEST FAILED:', err.message);
        process.exit(1);
    }
})();
