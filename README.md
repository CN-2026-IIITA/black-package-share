# 🚀 Black Packet — Advanced Secure File Transfer System

<div align="center">

**Chunk-Based • Resumable • Auto-Expiring • LAN-Ready**

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socketdotio)](https://socket.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [What Makes This Unique](#-what-makes-this-unique)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Setup & Installation](#-setup--installation)
- [API Reference](#-api-reference)
- [How It Works](#-how-it-works)
- [Team Contributions](#-team-contributions)
- [Attribution](#-attribution)

---

## 🎯 Overview

**Black Packet** is an advanced file transfer system built with Node.js that goes far beyond simple file upload/download. It implements a **chunk-based transfer protocol** with features typically found in enterprise-grade file sharing systems:

- Files are split into optimally-sized chunks and transferred independently
- Failed chunks are retried with exponential backoff — no need to restart the entire transfer
- Interrupted transfers can be **resumed** from the last successful chunk
- Download links auto-expire after a configurable time period
- Files are accessed via **secure 6-digit codes** backed by JWT tokens
- Devices on the same LAN are discovered automatically via UDP broadcast

---

## 💡 What Makes This Unique

### Problem Statement
Existing file sharing solutions either:
- Require internet (Google Drive, WeTransfer) — unusable in offline/LAN scenarios
- Lack resume capability — a 400MB upload must restart from scratch after a brief disconnection
- Have no security — anyone with the link can download indefinitely
- Treat files as monolithic blobs — no chunk-level error recovery

### Our Solution
Black Packet solves **all four problems** simultaneously:

| Problem | Our Approach |
|---------|-------------|
| Internet dependency | UDP-based LAN discovery — works without internet |
| No resume | Chunk index tracking — resume from exact failure point |
| No security | 6-digit access codes + JWT tokens + auto-expiry |
| No error recovery | ACK-based protocol with per-chunk retry (3 attempts, exponential backoff) |

### Novelty Highlights
1. **Custom Transfer Protocol**: Implements send → ACK → next-chunk flow similar to TCP but at the application layer, giving us fine-grained control over error handling
2. **Network-Aware Chunk Sizing**: Automatically adjusts chunk size (64KB–1MB) based on file size to balance overhead vs. throughput
3. **Zero-Config LAN Transfer**: UDP broadcast discovers peers automatically — no IP address entry needed

---
// debug configuration (used during testing)
const DEBUG_MODE = true;
const LOG_CHUNK_FLOW = true;
const SIMULATE_PACKET_LOSS = false;

if (DEBUG_MODE) {
    console.log("Debug mode enabled: Tracking chunk transfers...");
}
## ✨ Features

### Core Features
- ✅ **Chunked File Upload** — Files split into optimal-size chunks
- ✅ **Real-Time Progress** — Percentage, speed, ETA via Socket.IO
- ✅ **Resume Transfers** — Skip already-uploaded chunks after interruption
- ✅ **Retry with Backoff** — Failed chunks retried up to 3× with exponential delay
- ✅ **Secure Access Codes** — 6-digit codes for file download
- ✅ **Auto-Expiring Links** — Configurable expiry (10min – 24hr)
- ✅ **JWT Token Auth** — Cryptographic token validation for downloads
- ✅ **LAN Discovery** — Find devices on local network without internet

### Frontend Features
- 🎨 Premium dark theme with glassmorphism design
- 🖱️ Drag-and-drop file upload
- 📊 Real-time progress bar with speed and ETA
- 📋 Transfer history panel
- 🌐 LAN device discovery panel
- 📱 Fully responsive (mobile-friendly)

### Technical Features
- 🔒 SHA-256 integrity verification per chunk
- 📦 In-memory file metadata store
- 🧹 Automatic cleanup of expired files
- 📡 WebSocket real-time communication
- 🔍 Health monitoring endpoint

---
//  analytics tracking (placeholder for future implementation)
function trackTransferEvent(eventType, metadata) {
    console.log(`[Analytics] Event: ${eventType}`, metadata);
}

// Example usage
trackTransferEvent("UPLOAD_STARTED", { fileSize: "120MB" });
## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | HTML5, CSS3, JavaScript | User interface |
| **Backend** | Node.js, Express.js | REST API server |
| **Real-Time** | Socket.IO | Live progress updates |
| **File Handling** | Multer | Multipart upload processing |
| **Security** | JSON Web Tokens (JWT) | Token-based file access |
| **Networking** | UDP (dgram) | LAN device discovery |
| **Crypto** | Node.js crypto | SHA-256 hashing |

---
// retry simulation for testing exponential backoff
function simulateRetry(attempt) {
    const delay = Math.pow(2, attempt) * 100;
    console.log(`Retry attempt ${attempt}, waiting ${delay}ms`);
}

// Example test loop
for (let i = 1; i <= 3; i++) {
    simulateRetry(i);
}
## 🏗️ Architecture

```
black-packet/
├── frontend/               # UI Layer (Member 1)
│   ├── index.html          # Main HTML with all panels
│   ├── style.css           # Dark theme + glassmorphism
│   └── app.js              # Client-side logic + Socket.IO
├── backend/                # Server Layer (Member 2)
│   ├── server.js           # Express + Socket.IO entry point
│   ├── routes.js           # REST API endpoints
│   └── fileHandler.js      # File metadata + access management
├── networking/             # Transfer Protocol (Member 3)
│   ├── chunkTransfer.js    # Chunk splitting + ACK protocol
│   ├── socketHandler.js    # Real-time event handlers
│   └── lanDiscovery.js     # UDP LAN peer discovery
├── utils/                  # Shared Utilities (Member 4)
│   ├── logger.js           # Colored timestamped logging
│   └── helpers.js          # Formatting, hashing, validation
├── test/                   # Test Suite (Member 4)
│   └── testCases.js        # 25+ unit & integration tests
├── docs/                   # Documentation (Member 4)
│   ├── ARCHITECTURE.md     # System design details
│   ├── API_REFERENCE.md    # Complete API documentation
│   └── VIVA_PREP.md        # Viva questions & answers
├── package.json
├── .gitignore
├── .env.example
└── README.md               # This file
```

### Data Flow

```
┌──────────┐    HTTP + Socket.IO    ┌──────────┐    Chunk Engine    ┌──────────────┐
│ Frontend │ ◄──────────────────►   │ Backend  │ ◄────────────────► │  Networking   │
│  (app.js)│                        │(server.js│                    │(chunkTransfer)│
└──────────┘                        │ routes.js│                    │(socketHandler)│
                                    │fileHndlr)│                    │(lanDiscovery) │
                                    └──────────┘                    └──────────────┘
                                         │
                                         ▼
                                    ┌──────────┐
                                    │  uploads/ │  (chunks → assembled files)
                                    └──────────┘
```
// LAN discovery simulation
function mockLanDiscovery() {
    return [
        { device: "Device-A", ip: "192.168.0.2" },
        { device: "Device-B", ip: "192.168.0.3" }
    ];
}

console.log("Discovered Devices:", mockLanDiscovery());
---

## 🚀 Setup & Installation

### Prerequisites
- Node.js v18 or higher
- npm v9 or higher

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-team/black-packet.git
cd black-packet

# 2. Install dependencies
npm install

# 3. (Optional) Configure environment
cp .env.example .env
# Edit .env as needed

# 4. Start the server
npm start

# 5. Open in browser
# Navigate to http://localhost:3000
```

### Running Tests

```bash
npm test
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload/init` | Initialize a chunked upload |
| `POST` | `/api/upload/chunk/:id` | Upload a single chunk |
| `POST` | `/api/upload/complete/:id` | Finalize upload, get access code |
| `GET` | `/api/download/:code` | Download file by access code |
| `GET` | `/api/transfer/status/:id` | Get transfer progress |
| `GET` | `/api/transfer/resume/:id` | Get missing chunks for resume |
| `GET` | `/api/lan/discover` | List LAN peers |
| `GET` | `/api/health` | Server health & stats |

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for full details.

---

## ⚙️ How It Works

### Upload Flow
```
1. User drops a file → Frontend determines chunk count
2. POST /api/upload/init → Server creates transfer session
3. For each chunk (i = 0 to N):
   a. Frontend slices file[i * chunkSize .. (i+1) * chunkSize]
   b. POST /api/upload/chunk/:id?chunkIndex=i → Server stores chunk
   c. Server computes SHA-256 hash, stores to disk, sends ACK
   d. On failure → retry up to 3× with exponential backoff
   e. Socket.IO broadcasts progress to all connected clients
4. POST /api/upload/complete → Server assembles chunks into file
5. Server generates 6-digit access code + JWT token
6. Download link auto-expires after configured time
```

### Download Flow
```
1. Recipient enters 6-digit code
2. Server validates code + checks expiry
3. If valid → streams file to recipient
4. If expired → returns 410 Gone
```

### Resume Flow
```
1. Upload interrupted (network failure, browser close)
2. Client calls GET /api/transfer/resume/:id
3. Server returns list of missing chunk indices
4. Client uploads ONLY the missing chunks
5. Resumes from where it left off — no wasted bandwidth
```

---

## 👥 Team Contributions

| Member | Module | Key Deliverables |
|--------|--------|-----------------|
| **Member 1** | `frontend/` | HTML structure, CSS design system, client-side upload/download logic, Socket.IO integration |
| **Member 2** | `backend/` | Express server setup, REST API routes, file metadata management, JWT auth, auto-expiry |
| **Member 3** | `networking/` | Chunk transfer engine, ACK protocol, retry logic, Socket.IO handlers, LAN discovery |
| **Member 4** | `utils/` `test/` `docs/` | Logger, helpers, 25+ test cases, README, architecture docs, viva prep |

---

## 📝 Attribution

- **Express.js** — MIT License — [expressjs.com](https://expressjs.com)
- **Socket.IO** — MIT License — [socket.io](https://socket.io)
- **Multer** — MIT License — [github.com/expressjs/multer](https://github.com/expressjs/multer)
- **JSON Web Tokens** — MIT License — [github.com/auth0/node-jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)
- **UUID** — MIT License — [github.com/uuidjs/uuid](https://github.com/uuidjs/uuid)
- **dotenv** — BSD-2-Clause License — [github.com/motdotla/dotenv](https://github.com/motdotla/dotenv)
- **Inter Font** — SIL Open Font License — [fonts.google.com/specimen/Inter](https://fonts.google.com/specimen/Inter)
- Chunk-based transfer concepts inspired by BitTorrent protocol and HTTP range requests (RFC 7233)
- ACK-based reliability pattern inspired by TCP protocol design

---

<div align="center">

**Built with ❤️ by the Black Packet Team**

</div>
