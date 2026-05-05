/**
 * app.js — Black Packet Frontend Application Logic
 * 
 * Handles:
 *  • Socket.IO real-time communication
 *  • Drag-and-drop file upload with chunking
 *  • Progress tracking (percentage, speed, ETA)
 *  • Download via 6-digit access code
 *  • Transfer history management
 *  • LAN peer discovery UI
 *  • Toast notifications
 * 
 * @module frontend/app
 * @author Black Packet Team (Member 1)
 */

/* ═══════════════════════════════════════════════════════════════════
   INITIALIZATION
   ═══════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initSocket();
    initTabs();
    initUpload();
    initDownload();
    initLAN();
    initUploadModes();
    initAnalytics();
    fetchBaseUrl();
});

/* ── State ──────────────────────────────────────────────────────── */

let socket          = null;
let selectedFile    = null;
let transferHistory = [];
let baseUrl         = '';  /* Populated from /api/config */
let uploadMode      = 'code';  /* 'code' | 'qr' | 'stego' */

/* ═══════════════════════════════════════════════════════════════════
   BACKGROUND PARTICLES
   ═══════════════════════════════════════════════════════════════════ */

function initParticles() {
    const container = document.getElementById('bgParticles');
    const colors = ['#00ff88', '#00d4ff', '#00ffd5', '#005533', '#003344'];

    for (let i = 0; i < 30; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        const size = Math.random() * 200 + 50;
        const color = colors[Math.floor(Math.random() * colors.length)];
        particle.style.cssText = `
            width: ${size}px; height: ${size}px;
            left: ${Math.random() * 100}%;
            background: ${color};
            animation-duration: ${Math.random() * 20 + 15}s;
            animation-delay: ${Math.random() * 10}s;
        `;
        container.appendChild(particle);
    }
}

/* ═══════════════════════════════════════════════════════════════════
   SOCKET.IO CONNECTION
   ═══════════════════════════════════════════════════════════════════ */

function initSocket() {
    const statusDot  = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    try {
        socket = io();

        socket.on('connect', () => {
            statusDot.className  = 'status-dot connected';
            statusText.textContent = 'Connected';
            showToast('Connected to server', 'success');
        });

        socket.on('disconnect', () => {
            statusDot.className  = 'status-dot error';
            statusText.textContent = 'Disconnected';
            showToast('Disconnected from server', 'error');
        });

        socket.on('transfer-progress', (data) => {
            if (data && data.percentage !== undefined) {
                updateProgress(data);
            }
        });

        socket.on('transfer-complete', (data) => {
            showUploadResult(data);
        });

        socket.on('transfer-error', (data) => {
            showToast(data.error || 'Transfer error', 'error');
        });

    } catch (err) {
        statusDot.className  = 'status-dot error';
        statusText.textContent = 'Connection failed';
    }
}

/* ═══════════════════════════════════════════════════════════════════
   TAB NAVIGATION
   ═══════════════════════════════════════════════════════════════════ */

function initTabs() {
    const tabs   = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.panel');

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            tabs.forEach((t) => t.classList.remove('active'));
            panels.forEach((p) => p.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`panel${capitalize(target)}`).classList.add('active');
        });
    });
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ═══════════════════════════════════════════════════════════════════
   FILE UPLOAD
   ═══════════════════════════════════════════════════════════════════ */

function initUpload() {
    const dropZone  = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const removeBtn = document.getElementById('removeFile');
    const newUpBtn  = document.getElementById('newUploadBtn');
    const copyBtn   = document.getElementById('copyCodeBtn');

    /* ── Drag & Drop ────────────────────────────────────────────── */
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            selectFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            selectFile(fileInput.files[0]);
        }
    });

    /* ── Buttons ────────────────────────────────────────────────── */
    uploadBtn.addEventListener('click', startUpload);

    removeBtn.addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        toggleEl('fileInfo', false);
        toggleEl('expiryRow', false);
        toggleEl('uploadBtn', false);
        toggleEl('dropZone', true);  // uses custom show logic
        document.getElementById('dropZone').style.display = '';
    });

    newUpBtn.addEventListener('click', resetUploadUI);

    copyBtn.addEventListener('click', () => {
        const code = document.getElementById('accessCode').textContent;
        navigator.clipboard.writeText(code).then(() => {
            showToast('Access code copied!', 'success');
        });
    });

    /* ── Save Stego Card ─────────────────────────────────────────── */
    document.getElementById('downloadStegoBtn').addEventListener('click', () => {
        const img = document.getElementById('stegoImage');
        if (!img.src) return;
        const a = document.createElement('a');
        a.href = img.src;
        a.download = 'share-card.png';
        a.click();
        showToast('Share card saved!', 'success');
    });

    /* ── Crypto Shred ────────────────────────────────────────────── */
    document.getElementById('shredBtn').addEventListener('click', async () => {
        const code = document.getElementById('accessCode').textContent;
        if (!code || code === '------') return;
        if (!confirm('This will permanently destroy encryption keys. The file will become unrecoverable. Continue?')) return;

        try {
            const res = await fetch(`/api/shred/${code}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                showToast('\ud83d\udd25 Keys shredded \u2014 data unrecoverable', 'success');
                document.getElementById('shredBtn').disabled = true;
                document.getElementById('shredBtn').textContent = 'Shredded \u2713';
            } else {
                showToast(data.error || 'Shred failed', 'error');
            }
        } catch {
            showToast('Shred request failed', 'error');
        }
    });
}

/**
 * Handle file selection.
 * @param {File} file
 */
function selectFile(file) {
    /* Validate size */
    if (file.size > 500 * 1024 * 1024) {
        showToast('File too large — max 500 MB', 'error');
        return;
    }

    if (file.size === 0) {
        showToast('Cannot upload empty file', 'error');
        return;
    }

    selectedFile = file;

    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent  = formatFileSize(file.size);

    document.getElementById('dropZone').style.display = 'none';
    toggleEl('fileInfo', true);
    toggleEl('expiryRow', true);
    toggleEl('uploadBtn', true);
}

/**
 * Start the chunked upload process.
 */
async function startUpload() {
    if (!selectedFile) return;

    const uploadBtn = document.getElementById('uploadBtn');
    uploadBtn.disabled = true;
    toggleEl('progressSection', true);
    toggleEl('resultSection', false);

    const expiryMinutes = parseInt(document.getElementById('expirySelect').value, 10);

    try {
        /* Step 1: Initialize transfer */
        const initRes = await fetch('/api/upload/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileName: selectedFile.name,
                fileSize: selectedFile.size,
                expiryMinutes,
            }),
        });

        const initData = await initRes.json();
        if (!initData.success) throw new Error(initData.error);

        const { transferId, chunkSize, totalChunks } = initData;

        /* Join socket room for real-time progress */
        if (socket) socket.emit('join-transfer', transferId);

        /* Step 2: Upload chunks with retry */
        const startTime = Date.now();
        let uploaded = 0;

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end   = Math.min(start + chunkSize, selectedFile.size);
            const chunk = selectedFile.slice(start, end);

            let success = false;
            let retries = 0;

            while (!success && retries < 3) {
                try {
                    const formData = new FormData();
                    formData.append('chunk', chunk);

                    const res = await fetch(`/api/upload/chunk/${transferId}?chunkIndex=${i}`, {
                        method: 'POST',
                        body: formData,
                    });

                    const result = await res.json();
                    if (!result.success) throw new Error(result.error);
                    success = true;

                } catch (err) {
                    retries++;
                    if (retries >= 3) {
                        showToast(`Chunk ${i} failed after 3 retries`, 'error');
                        throw err;
                    }
                    /* Exponential backoff */
                    const delay = Math.min(1000 * Math.pow(2, retries), 10000);
                    showToast(`Retrying chunk ${i + 1}… (attempt ${retries + 1})`, 'info');
                    await sleep(delay);
                }
            }

            uploaded++;

            /* Update progress UI */
            const elapsed    = Date.now() - startTime;
            const bytesNow   = end;
            const speed      = (bytesNow / elapsed) * 1000;
            const remaining  = ((selectedFile.size - bytesNow) / speed);
            const percentage = Math.round((uploaded / totalChunks) * 100);

            document.getElementById('progressPercent').textContent = `${percentage}%`;
            document.getElementById('progressFill').style.width    = `${percentage}%`;
            document.getElementById('chunkInfo').textContent        = `Chunk ${uploaded} / ${totalChunks}`;
            document.getElementById('speedInfo').textContent        = `${formatFileSize(speed)}/s`;
            document.getElementById('etaInfo').textContent           = `ETA: ${formatDuration(remaining * 1000)}`;
        }

        /* Step 3: Complete upload */
        const completeRes = await fetch(`/api/upload/complete/${transferId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expiryMinutes }),
        });

        const completeData = await completeRes.json();
        if (!completeData.success) throw new Error(completeData.error);

        showUploadResult(completeData);

    } catch (err) {
        showToast(`Upload failed: ${err.message}`, 'error');
        uploadBtn.disabled = false;
    }
}

/**
 * Display the upload result (access code).
 * @param {Object} data
 */
function showUploadResult(data) {
    document.getElementById('progressLabel').textContent   = 'Complete!';
    document.getElementById('progressPercent').textContent  = '100%';
    document.getElementById('progressFill').style.width     = '100%';

    toggleEl('resultSection', true);
    document.getElementById('accessCode').textContent  = data.accessCode || '------';
    document.getElementById('resultExpiry').textContent = `Expires in ${document.getElementById('expirySelect').value} minutes`;

    /* ── Selectively show result based on chosen delivery mode ── */

    /* Hide all result sub-sections first */
    const codeWrap = document.querySelector('.access-code-wrap');
    const qrContainer = document.getElementById('qrSection');
    const stegoContainer = document.getElementById('stegoSection');
    const shredContainer = document.getElementById('shredSection');
    const encBadge = document.getElementById('encryptedBadge');

    if (codeWrap) codeWrap.style.display = 'none';
    if (qrContainer) qrContainer.classList.add('hidden');
    if (stegoContainer) stegoContainer.classList.add('hidden');
    if (shredContainer) shredContainer.classList.add('hidden');
    if (encBadge) encBadge.classList.add('hidden');

    if (uploadMode === 'code') {
        /* Access Code mode — show code + copy + encrypted badges */
        if (codeWrap) codeWrap.style.display = '';
        if (data.encrypted) {
            toggleEl('encryptedBadge', true);
            toggleEl('shredSection', true);
        }
        showToast('Upload complete! Share the 6-digit access code.', 'success');

    } else if (uploadMode === 'qr') {
        /* QR Code mode — show QR image prominently */
        if (qrContainer && data.qrCode) {
            const qrImg   = document.getElementById('qrImage');
            const qrLabel = document.getElementById('qrLabel');
            const dlUrlEl = document.getElementById('downloadUrlText');
            const copyBtn = document.getElementById('copyQrUrlBtn');

            qrImg.src = data.qrCode;
            qrImg.alt = 'Scan to download';

            // Use LAN URL (real IP) so phones can open it
            const displayUrl = data.lanDownloadUrl || data.downloadUrl;
            if (qrLabel) qrLabel.textContent = `Scan with your phone camera`;
            if (dlUrlEl && displayUrl) {
                dlUrlEl.textContent = displayUrl;
                dlUrlEl.href = displayUrl;
            }
            if (copyBtn && displayUrl) {
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(displayUrl).then(() => {
                        showToast('URL copied!', 'success');
                    });
                };
            }
            qrContainer.classList.remove('hidden');
        }
        showToast(`Upload complete! Scan the QR code to download on your phone.`, 'success');

    } else if (uploadMode === 'stego') {
        /* Share Card mode — show steganographic image */
        if (data.stegoImage) {
            const stegoImg = document.getElementById('stegoImage');
            stegoImg.src = data.stegoImage;
            toggleEl('stegoSection', true);
        }
        if (data.encrypted) {
            toggleEl('encryptedBadge', true);
        }
        showToast('Upload complete! Save and share the secret card image.', 'success');
    }

    /* Add to history */
    addToHistory({
        fileName:   data.fileName || selectedFile?.name || 'Unknown',
        fileSize:   data.fileSize || selectedFile?.size || 0,
        accessCode: data.accessCode,
        time:       new Date().toLocaleTimeString(),
        mode:       uploadMode,
    });
}

/**
 * Reset the upload UI for a new upload.
 */
function resetUploadUI() {
    selectedFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('dropZone').style.display = '';

    toggleEl('fileInfo', false);
    toggleEl('expiryRow', false);
    toggleEl('uploadBtn', false);
    toggleEl('progressSection', false);
    toggleEl('resultSection', false);
    toggleEl('qrSection', false);
    toggleEl('stegoSection', false);
    toggleEl('shredSection', false);
    toggleEl('encryptedBadge', false);

    document.getElementById('uploadBtn').disabled = false;
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('progressLabel').textContent = 'Uploading…';
    document.getElementById('shredBtn').disabled = false;
    document.getElementById('shredBtn').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Shred Keys (Destroy Access)';
}

/* ═══════════════════════════════════════════════════════════════════
   FILE DOWNLOAD
   ═══════════════════════════════════════════════════════════════════ */

function initDownload() {
    const downloadBtn = document.getElementById('downloadBtn');
    const codeInput   = document.getElementById('codeInput');
    const stegoZone   = document.getElementById('stegoDropZone');
    const stegoInput  = document.getElementById('stegoFileInput');

    downloadBtn.addEventListener('click', startDownload);

    /* Auto-submit on 6 digits */
    codeInput.addEventListener('input', () => {
        codeInput.value = codeInput.value.replace(/\D/g, '');
        if (codeInput.value.length === 6) {
            startDownload();
        }
    });

    /* ── Access Method Card Switching ──────────────────────── */
    const methodCards = document.querySelectorAll('.access-method-card');
    const methodPanels = {
        code:  document.getElementById('methodPanelCode'),
        qr:    document.getElementById('methodPanelQR'),
        stego: document.getElementById('methodPanelStego'),
    };

    /* Set initial active state */
    document.getElementById('methodCode').classList.add('active');

    methodCards.forEach(card => {
        card.addEventListener('click', () => {
            const method = card.dataset.method;

            /* Update card active states */
            methodCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            /* Update panel visibility */
            Object.values(methodPanels).forEach(p => p.classList.remove('active'));
            if (methodPanels[method]) methodPanels[method].classList.add('active');
        });
    });

    /* ── QR URL Input (paste a download URL) ───────────────── */
    const qrUrlInput = document.getElementById('qrUrlInput');
    if (qrUrlInput) {
        qrUrlInput.addEventListener('input', () => {
            const url = qrUrlInput.value.trim();
            /* Extract access code from URL like /api/download/123456 */
            const match = url.match(/\/download\/(\d{6})/);
            if (match) {
                codeInput.value = match[1];
                showToast(`Code extracted from URL: ${match[1]}`, 'success');
                startDownload();
            }
        });
    }

    /* ── Steganographic Image Drop ─────────────────────────── */
    stegoZone.addEventListener('click', () => stegoInput.click());

    stegoZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        stegoZone.classList.add('drag-over');
    });

    stegoZone.addEventListener('dragleave', () => {
        stegoZone.classList.remove('drag-over');
    });

    stegoZone.addEventListener('drop', (e) => {
        e.preventDefault();
        stegoZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            extractStegoCode(e.dataTransfer.files[0]);
        }
    });

    stegoInput.addEventListener('change', () => {
        if (stegoInput.files.length > 0) {
            extractStegoCode(stegoInput.files[0]);
        }
    });
}


/**
 * Extract access code from a steganographic image using Canvas API.
 * @param {File} file
 */
function extractStegoCode(file) {
    const STEGO_MAGIC = 0xA5;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const pixels = ctx.getImageData(0, 0, img.width, img.height).data;

            /* Read magic byte (8 bits from Blue channel LSBs) */
            let magic = 0;
            for (let i = 0; i < 8; i++) {
                magic = (magic << 1) | (pixels[i * 4 + 2] & 1);
            }
            if (magic !== STEGO_MAGIC) {
                showToast('No hidden code found in this image', 'error');
                return;
            }

            /* Read length byte */
            let length = 0;
            for (let i = 8; i < 16; i++) {
                length = (length << 1) | (pixels[i * 4 + 2] & 1);
            }

            /* Read data bytes */
            let code = '';
            for (let c = 0; c < length; c++) {
                let byte = 0;
                for (let bit = 0; bit < 8; bit++) {
                    const idx = (16 + c * 8 + bit) * 4 + 2;
                    byte = (byte << 1) | (pixels[idx] & 1);
                }
                code += String.fromCharCode(byte);
            }

            /* Fill in the code input and auto-download */
            document.getElementById('codeInput').value = code;
            showToast(`Code extracted: ${code}`, 'success');
            startDownload();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * Download a file using the access code.
 */
async function startDownload() {
    const code = document.getElementById('codeInput').value.trim();
    const errorEl = document.getElementById('downloadError');

    if (code.length !== 6) {
        errorEl.textContent = 'Please enter a valid 6-digit access code';
        errorEl.classList.remove('hidden');
        return;
    }

    errorEl.classList.add('hidden');
    toggleEl('downloadStatus', true);
    document.getElementById('dlStatusText').textContent = 'Downloading…';
    document.getElementById('dlProgressFill').style.width = '0%';

    try {
        const response = await fetch(`/api/download/${code}`);

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Download failed');
        }

        /* Get filename from Content-Disposition header */
        const disposition = response.headers.get('Content-Disposition');
        let filename = 'download';
        if (disposition) {
            const match = disposition.match(/filename="?([^"]+)"?/);
            if (match) filename = match[1];
        }

        const contentLength = parseInt(response.headers.get('Content-Length'), 10);

        /* Stream the download with progress */
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;

            if (contentLength) {
                const pct = Math.round((received / contentLength) * 100);
                document.getElementById('dlProgressFill').style.width = `${pct}%`;
                document.getElementById('dlStatusText').textContent = `Downloading… ${pct}%`;
            }
        }

        /* Assemble and trigger download */
        const blob = new Blob(chunks);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        document.getElementById('dlStatusText').textContent = `Downloaded: ${filename}`;
        document.getElementById('dlProgressFill').style.width = '100%';
        showToast(`Downloaded: ${filename}`, 'success');

    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        toggleEl('downloadStatus', false);
        showToast(err.message, 'error');
    }
}

/* ═══════════════════════════════════════════════════════════════════
   TRANSFER HISTORY
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Add an entry to the transfer history.
 * @param {{ fileName: string, fileSize: number, accessCode: string, time: string }} entry
 */
function addToHistory(entry) {
    transferHistory.unshift(entry);
    renderHistory();
}

function renderHistory() {
    const list = document.getElementById('historyList');

    if (transferHistory.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <p>No transfers yet</p>
            </div>`;
        return;
    }

    list.innerHTML = transferHistory.map((h) => `
        <div class="history-item">
            <div class="history-item-left">
                <span class="history-item-name">${escapeHtml(h.fileName)}</span>
                <span class="history-item-meta">${formatFileSize(h.fileSize)} • ${h.time}</span>
            </div>
            <span class="history-item-code">${h.accessCode}</span>
        </div>
    `).join('');
}

/* ═══════════════════════════════════════════════════════════════════
   LAN DISCOVERY
   ═══════════════════════════════════════════════════════════════════ */

function initLAN() {
    document.getElementById('refreshLAN').addEventListener('click', fetchLANPeers);
    document.getElementById('scanNetworkBtn').addEventListener('click', scanNetworkDevices);
    fetchLANPeers();
    /* Auto-scan on LAN tab load */
    scanNetworkDevices();
}

async function fetchLANPeers() {
    try {
        const res  = await fetch('/api/lan/discover');
        const data = await res.json();

        /* Show local device info with real LAN IP prominently */
        if (data.localDevice) {
            const hn  = document.getElementById('localHostname');
            const ips = document.getElementById('localIPs');
            if (hn) hn.textContent = data.localDevice.hostname;
            if (ips && data.localDevice.ips.length > 0) {
                /* Show real IP — examiner can type this on another device */
                const ipList = data.localDevice.ips.map(ip => `${ip}:${data.localDevice.port}`).join('  ·  ');
                ips.textContent = ipList || 'No network detected';
            } else if (ips) {
                ips.textContent = 'No network detected';
            }
        }

        const list = document.getElementById('peerList');

        if (!data.peers || data.peers.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="padding:16px 0">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                    <p style="margin-top:8px;font-size:0.78rem">No Black Packet peers yet.<br><span style="opacity:0.5;font-size:0.72rem">Run <code>npm start</code> on another device on the same Wi-Fi</span></p>
                </div>`;
            return;
        }

        list.innerHTML = data.peers.map((p) => `
            <div class="peer-item bp-ready" style="cursor:pointer" onclick="window.open('http://${p.ip}:${p.port}','_blank')">
                <div class="peer-dot"></div>
                <div class="peer-info">
                    <div class="peer-hostname">${escapeHtml(p.hostname)}</div>
                    <div class="peer-ip">${p.ip}:${p.port}</div>
                </div>
                <span class="net-device-badge">Connect →</span>
            </div>
        `).join('');

    } catch {
        /* Silently fail */
    }
}

async function scanNetworkDevices() {
    const btn     = document.getElementById('scanNetworkBtn');
    const list    = document.getElementById('networkDeviceList');
    const countEl = document.getElementById('deviceCount');
    const spanEl  = btn.querySelector('span');

    btn.disabled = true;
    if (spanEl) spanEl.textContent = 'Scanning…';

    try {
        const res  = await fetch('/api/lan/scan');
        const data = await res.json();

        if (!data.success) throw new Error('Scan failed');

        /* devices already filtered server-side (no multicast/link-local) */
        const devices = (data.devices || []);
        countEl.textContent = devices.length;

        if (devices.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="padding:16px 0">
                    <p style="font-size:0.78rem">No devices found.<br><span style="opacity:0.5;font-size:0.72rem">Make sure other devices are on the same Wi-Fi and have sent traffic recently.</span></p>
                </div>`;
        } else {
            list.innerHTML = devices.map(d => {
                const isReady = d.blackPacketReady;
                const connectBtn = isReady
                    ? `<a href="http://${d.ip}:3000" target="_blank" class="net-device-badge" style="text-decoration:none;cursor:pointer">Open →</a>`
                    : `<span class="net-device-type">${escapeHtml(d.type)}</span>`;

                return `
                <div class="net-device-item ${isReady ? 'bp-ready' : ''}">
                    <div class="net-device-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                             stroke="${isReady ? 'var(--accent-1)' : 'var(--accent-2)'}" stroke-width="2">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                    </div>
                    <div class="net-device-info">
                        <div class="net-device-name">${escapeHtml(d.hostname)}</div>
                        <div class="net-device-meta">${d.ip} · ${d.mac}</div>
                    </div>
                    ${connectBtn}
                </div>`;
            }).join('');
        }

        const bpCount = devices.filter(d => d.blackPacketReady).length;
        showToast(`Found ${devices.length} device(s)${bpCount ? ` · ${bpCount} running Black Packet` : ''}`, 'info');

        /* Also refresh peers list after scan */
        fetchLANPeers();

    } catch (err) {
        list.innerHTML = `<div class="empty-state"><p>Scan failed — try again</p></div>`;
        showToast('Network scan failed', 'error');
    }

    btn.disabled = false;
    if (spanEl) spanEl.textContent = 'Scan Network';
}

/* ═══════════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('exit');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

/* ═══════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Toggle element visibility.
 * @param {string} id - Element ID
 * @param {boolean} show
 */
function toggleEl(id, show) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
}

/**
 * Format bytes to human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const units = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + units[i];
}

/**
 * Format milliseconds to friendly duration.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
    if (ms < 1000) return '<1s';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

/**
 * Escape HTML to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Promise-based sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the server's base URL from /api/config.
 * Used to construct download URLs that work across devices.
 */
async function fetchBaseUrl() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.baseUrl) baseUrl = data.baseUrl;
    } catch {
        /* Fallback: use current origin */
        baseUrl = window.location.origin;
    }
}

/* ═══════════════════════════════════════════════════════════════════
   UPLOAD MODE SWITCHING
   ═══════════════════════════════════════════════════════════════════ */

function initUploadModes() {
    const cards = document.querySelectorAll('.upload-mode-card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            uploadMode = card.dataset.mode;
            const scanStatus = document.getElementById('scanStatus');
            if (uploadMode === 'code') {
                scanStatus.textContent = 'Delivery: Access Code | Filter: Active';
            } else if (uploadMode === 'qr') {
                scanStatus.textContent = 'Delivery: QR Code | Filter: Active';
            } else if (uploadMode === 'stego') {
                scanStatus.textContent = 'Delivery: Share Card (Steganography) | Filter: Active';
            }
        });
    });
}

/* ═══════════════════════════════════════════════════════════════════
   ANALYTICS DASHBOARD
   ═══════════════════════════════════════════════════════════════════ */

function initAnalytics() {
    /* Auto-refresh analytics every 3 seconds when tab is active */
    setInterval(refreshAnalytics, 3000);
    refreshAnalytics();

    /* Benchmark button */
    const benchBtn = document.getElementById('runBenchmarkBtn');
    if (benchBtn) {
        benchBtn.addEventListener('click', runBenchmark);
    }
}

async function refreshAnalytics() {
    try {
        const res = await fetch('/api/analytics');
        const data = await res.json();
        if (!data.success) return;

        /* Update stat cards */
        setText('statUploads', data.transfers.uploads.count);
        setText('statDownloads', data.transfers.downloads.count);
        setText('statBytes', data.transfers.uploads.totalFormatted);
        setText('statSpeed', data.transfers.uploads.avgSpeedFormatted);
        setText('statChunks', data.transfers.chunks.received);
        setText('statEncrypted', data.security.encryption.encrypted);
        setText('statScanned', data.security.contentFilter.scanned);
        setText('statBlocked', data.security.contentFilter.blocked);

        /* Update health */
        setText('healthUptime', data.session.uptimeFormatted);
        setText('healthMemory', `${data.system.memoryUsed} / ${data.system.memoryTotal} (${data.system.memoryPercent}%)`);
        setText('healthPlatform', data.system.platform);
        setText('healthNode', data.system.nodeVersion);
    } catch {
        /* Silent fail — analytics is non-critical */
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

async function runBenchmark() {
    const btn = document.getElementById('runBenchmarkBtn');
    const resultsDiv = document.getElementById('benchmarkResults');
    const grid = document.getElementById('benchmarkGrid');

    btn.disabled = true;
    btn.querySelector('span').textContent = 'Running…';

    try {
        const res = await fetch('/api/benchmark');
        const data = await res.json();
        if (!data.success) throw new Error('Benchmark failed');

        const bm = data.benchmark;
        grid.innerHTML = '';

        /* Hash */
        grid.innerHTML += benchCard('SHA-256 Throughput', bm.hashBenchmark.throughput, bm.hashBenchmark.operation);
        /* Encrypt */
        grid.innerHTML += benchCard('AES-256-GCM Throughput', bm.encryptBenchmark.throughput, bm.encryptBenchmark.operation);
        /* Memory */
        grid.innerHTML += benchCard('Memory Allocation', `${bm.memoryBenchmark.totalMs}ms`, bm.memoryBenchmark.operation);
        /* RNG */
        grid.innerHTML += benchCard('Crypto RNG', `${bm.rngBenchmark.totalMs}ms`, bm.rngBenchmark.operation);

        resultsDiv.classList.remove('hidden');
        showToast('Benchmark complete!', 'success');
    } catch (err) {
        showToast('Benchmark failed', 'error');
    }

    btn.disabled = false;
    btn.querySelector('span').textContent = 'Run Benchmark';
}

function benchCard(title, value, detail) {
    return `<div class="benchmark-card">
        <div class="bm-title">${title}</div>
        <div class="bm-value">${value}</div>
        <div class="bm-detail">${detail}</div>
    </div>`;
}