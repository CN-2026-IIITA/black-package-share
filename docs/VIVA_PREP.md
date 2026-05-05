# Black Packet — Viva Preparation Guide

## Q1: How does the system work internally?

**Answer:** Black Packet uses a 3-tier architecture:
1. **Frontend** — User selects a file; JavaScript slices it into chunks using `File.slice()` API
2. **Backend** — Express server receives chunks via REST API, stores each to disk, tracks state in memory
3. **Networking** — ChunkTransfer module manages the ACK protocol: each chunk gets a SHA-256 hash and acknowledgement. Socket.IO provides real-time progress.

Flow: User drops file → `POST /upload/init` creates session → chunks uploaded one by one with ACK → `POST /upload/complete` assembles chunks → 6-digit access code generated → recipient enters code to download.

---

## Q2: Why is chunking used instead of uploading the whole file?

**Answer:** Chunking provides 4 critical advantages:
1. **Resume** — If upload fails at chunk 15/20, we only re-send chunks 15-19
2. **Error isolation** — A corrupted chunk is detected by SHA-256 hash mismatch and re-sent, without affecting others
3. **Progress tracking** — We can show exact percentage (chunk N/total)
4. **Memory efficiency** — Server processes 256KB at a time instead of loading 500MB into memory

---

## Q3: How does the retry mechanism work?

**Answer:** Each chunk gets up to 3 retry attempts using **exponential backoff with jitter**:
- Attempt 1: ~1 second delay
- Attempt 2: ~2 second delay
- Attempt 3: ~4 second delay

Jitter (±25%) prevents "thundering herd" — multiple clients retrying at the exact same moment. If all 3 attempts fail, the chunk is marked failed and the user is notified.

---

## Q4: How does resume work after network failure?

**Answer:** The server tracks which chunks have been received using a `Set<number>` of chunk indices. When the client reconnects:
1. Client calls `GET /api/transfer/resume/:transferId`
2. Server compares received chunks vs total chunks
3. Returns array of missing chunk indices (e.g., `[3, 7, 12]`)
4. Client uploads only those chunks, skipping already-ACKed ones

This is similar to how BitTorrent tracks piece availability.

---

## Q5: What makes this project unique compared to Google Drive or WeTransfer?

**Answer:**
| Feature | Google Drive | WeTransfer | Black Packet |
|---------|-------------|-----------|------------|
| Works without internet | ❌ | ❌ | ✅ (LAN) |
| Resume interrupted uploads | Partial | ❌ | ✅ (chunk-level) |
| Auto-expiry | ❌ | ✅ (7 days) | ✅ (configurable, 10min-24hr) |
| Open source / self-hosted | ❌ | ❌ | ✅ |
| Per-chunk integrity hash | ❌ | ❌ | ✅ (SHA-256) |

---

## Q6: How is security handled?

**Answer:** Multiple layers:
1. **6-digit access codes** — Random numeric codes for human-friendly sharing
2. **JWT tokens** — Cryptographically signed, contain accessCode + expiry
3. **Auto-expiry** — Files deleted after configurable time (30 min default)
4. **Input validation** — Filename sanitization prevents path traversal attacks
5. **File size limits** — Max 500MB per file, 10MB per chunk

---

## Q7: How does LAN discovery work?

**Answer:** Uses **UDP broadcast** on port 41234:
1. Each Black Packet instance broadcasts a `HELLO` message every 5 seconds
2. Message contains: hostname, HTTP port, unique device ID
3. Other instances on the same subnet receive the broadcast
4. Peers are stored in a map with last-seen timestamps
5. Peers not seen for 15 seconds are removed (heartbeat timeout)

This works without any configuration — no IP address entry needed.

---

## Q8: What is the ACK protocol?

**Answer:** Our ACK (Acknowledgement) protocol is inspired by TCP but operates at the application layer:

```
Send chunk → Server verifies → Server responds with ACK + hash → Client sends next chunk
```

Key differences from TCP:
- We operate on file chunks, not network packets
- We include SHA-256 hash in each ACK for integrity verification
- We have application-level retry logic (TCP handles packet-level retries)

---

## Q9: How does the chunk size optimization work?

**Answer:** The system dynamically selects chunk size based on file size:

| File Size | Chunk Size | Rationale |
|-----------|-----------|-----------|
| < 1 MB | 64 KB | Small files need fewer, smaller chunks |
| 1-10 MB | 256 KB | Balanced overhead vs. throughput |
| 10-100 MB | 512 KB | Fewer HTTP requests for medium files |
| > 100 MB | 1 MB | Minimize round-trips for large files |

This is a form of **network-aware optimization** — adapting behavior to the workload.

---

## Q10: What technologies are used and why?

| Technology | Why |
|-----------|-----|
| **Node.js** | Non-blocking I/O ideal for file streaming and concurrent connections |
| **Express** | Lightweight, widely-used REST framework |
| **Socket.IO** | Reliable WebSocket with auto-reconnect for real-time progress |
| **Multer** | Battle-tested multipart file handling for Express |
| **JWT** | Stateless token verification — no database needed |
| **UDP (dgram)** | Low-overhead broadcast for LAN discovery |

---

## Q11: How is the frontend designed?

**Answer:** The frontend uses a premium dark theme with:
- **Glassmorphism** — Frosted glass card effect using `backdrop-filter: blur()`
- **Gradient accents** — Indigo-to-violet gradient for branding consistency
- **Micro-animations** — Progress bar shimmer, floating particles, bob animation on upload icon
- **Responsive design** — Works on mobile via CSS media queries
- **Drag-and-drop** — Native HTML5 drag events for file selection

---

## Q12: Explain the file lifecycle from upload to download.

**Answer:**
1. **Init** — Server creates a transfer directory and session state
2. **Chunk Upload** — Each chunk is hashed, stored as `chunk_0`, `chunk_1`, etc.
3. **Assembly** — Chunks are read in order and written to a single output file
4. **Registration** — File metadata stored with access code and JWT token
5. **Download** — Recipient validates code, server streams the assembled file
6. **Expiry** — Periodic cleanup (every 5 min) deletes expired files and metadata

---

## Q13: What happens if the server restarts?

**Answer:** Currently, transfer state is in-memory, so active transfers are lost on restart. However:
- **Completed files** persist in the `uploads/` directory
- **File metadata** (access codes) would need to be re-registered
- This is a deliberate design choice for simplicity — a production system would use a database

---

## Q14: How would you scale this system?

**Answer:**
1. **Database** — Replace in-memory maps with MongoDB/Redis for persistence
2. **Object storage** — Use S3/MinIO for file storage instead of local disk
3. **Load balancer** — Nginx in front of multiple Node instances
4. **Sticky sessions** — Socket.IO sessions pinned to specific servers via Redis adapter
5. **CDN** — Serve completed files via CDN for faster downloads

---

## Q15: What testing approach did you use?

**Answer:** We built a custom test runner (no external framework) with 25+ tests:
- **Unit tests** — formatFileSize, hash generation, access codes, filename validation
- **Integration tests** — Chunk init → process → progress → cleanup flow
- **Edge cases** — Invalid indices, unknown transfers, duplicate chunks, expiry logic

Run via: `npm test`
