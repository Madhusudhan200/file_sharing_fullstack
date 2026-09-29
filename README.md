# Crossway Drop — Full-Stack File & Application Sharing

Ultra-fast, zero-registration cross-platform file sharing platform with **Frontend** and **Backend** organized in one repository.

---

## 📁 Repository Structure

```
file-sharing-fullstack/
├── frontend/                   # 🌐 Client-side Web Application
│   ├── index.html              # Responsive UI & drag-and-drop zone
│   ├── style.css               # Styling system with light/dark mode
│   ├── app.js                  # Multi-channel parallel streaming client
│   ├── jszip.min.js            # Mac .app bundle packaging
│   ├── favicon.svg             # Application favicon
│   └── README.md
│
├── backend/                    # ⚙️ Server-side Engine
│   ├── server.js               # Multi-stream positional writing server
│   ├── package.json            # Node.js dependencies
│   ├── package-lock.json
│   ├── Dockerfile              # Docker container definition
│   └── README.md
│
├── docker-compose.yml          # One-click Docker deployment
├── package.json                # Root package & run scripts
├── .gitignore
└── README.md
```

---

## ⚡ Key Capabilities

- **4× Parallel Streaming Engine**: Saturates multi-gigabit LAN / Wi-Fi lines (1GB in under 30 seconds).
- **500GB+ File Capacity**: Zero browser memory bloat via memory-safe slice chunking.
- **Universal Application Support**:
  - 🤖 **Android**: Native `.apk` direct install support with `application/vnd.android.package-archive` MIME headers.
  - 🍏 **macOS**: Drag-and-drop `.app` bundles from `/Applications` with automatic packaging.
  - 🪟 **Windows & Linux**: Direct sharing for `.exe`, `.msi`, `.deb`, `.rpm`, and `.AppImage`.
- **Unlimited Files**: Add hundreds or thousands of files in a single transfer session.

---

## 🚀 Quick Start

### 1. Install & Run Locally

```bash
cd file-sharing-fullstack
npm run postinstall
npm start
```

### 2. Access the Application

- **This PC**: `http://localhost:3000`
- **Phones / Tablets on Wi-Fi**: `http://<your-lan-ip>:3000`
