/**
 * Crossway Drop — Ultra-fast cross-platform file sharing server
 * Multi-threaded / Parallel Pipelined Chunked Streaming Engine (Supports 500GB+ at Multi-Gigabit Speeds)
 */
const express = require("express");
const multer = require("multer");
const archiver = require("archiver");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

// ---------- configuration ----------
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, "uploads"));
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || "512000", 10); // 500 GB per file
const MAX_FILES = parseInt(process.env.MAX_FILES || "1000000", 10); // Unlimited files
const EXPIRE_HOURS = parseFloat(process.env.EXPIRE_HOURS || "24");
const MAX_DOWNLOADS = parseInt(process.env.MAX_DOWNLOADS || "0", 10);

fs.mkdirSync(STORAGE_DIR, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "50mb" }));

// Basic security & performance headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// ---------- helpers ----------
const CODE_RE = /^\d{6}$/;
const dropDir = (code) => path.join(STORAGE_DIR, code);
const metaPath = (code) => path.join(dropDir(code), "meta.json");

function detectOS(ua = "") {
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Linux|X11|CrOS/i.test(ua)) return "Linux";
  return "Device";
}

function safeName(name) {
  const base = path.basename(String(name || "file")).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").trim();
  return (base || "file").slice(0, 200);
}

async function newCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await fsp.mkdir(dropDir(code));
      return code;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  throw new Error("No free code available, try again");
}

async function readMeta(code) {
  if (!CODE_RE.test(code)) return null;
  try {
    const meta = JSON.parse(await fsp.readFile(metaPath(code), "utf8"));
    if (Date.now() > meta.expiresAt) {
      await removeDrop(code);
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

async function writeMeta(meta) {
  const tmp = metaPath(meta.code) + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(meta));
  await fsp.rename(tmp, metaPath(meta.code));
}

async function removeDrop(code) {
  if (!CODE_RE.test(code)) return;
  await fsp.rm(dropDir(code), { recursive: true, force: true });
}

// Correct content types for APKs, installers & media
const APP_TYPES = {
  apk: "application/vnd.android.package-archive",
  xapk: "application/octet-stream",
  aab: "application/octet-stream",
  ipa: "application/octet-stream",
  dmg: "application/x-apple-diskimage",
  pkg: "application/octet-stream",
  exe: "application/vnd.microsoft.portable-executable",
  msi: "application/x-msi",
  msix: "application/msix",
  appimage: "application/vnd.appimage",
  deb: "application/vnd.debian.binary-package",
  rpm: "application/x-rpm",
  heic: "image/heic",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  iso: "application/x-iso9660-image",
  tar: "application/x-tar",
  gz: "application/gzip",
  "7z": "application/x-7z-compressed",
  zip: "application/zip",
};

function fileType(name, given) {
  const e = (path.extname(name).slice(1) || "").toLowerCase();
  if (APP_TYPES[e]) return APP_TYPES[e];
  return given && given !== "application/octet-stream" ? given : "application/octet-stream";
}

function publicMeta(meta) {
  return {
    code: meta.code,
    from: meta.from,
    note: meta.note,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    total: meta.total,
    downloads: meta.downloads,
    files: meta.files.map((f, i) => ({ index: i, name: f.name, size: f.size, type: f.type })),
  };
}

// In-memory rate limiter for code lookups
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + ":" + req.route.path;
    const now = Date.now();
    const rec = hits.get(key) || { n: 0, t: now };
    if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
    rec.n++;
    hits.set(key, rec);
    if (rec.n > max) return res.status(429).json({ error: "Too many attempts. Wait a minute and try again." });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.t > 120000) hits.delete(k); }, 60000).unref();

// Active upload sessions map
const activeSessions = new Map();

// ---------- ULTRA-FAST PARALLEL CHUNKED STREAMING ENGINE ----------

// 1. Initialize an upload session
app.post("/api/upload/init", async (req, res) => {
  try {
    const { note, files } = req.body || {};
    if (!Array.isArray(files) || !files.length) {
      return res.status(400).json({ error: "Choose at least one file." });
    }
    if (files.length > MAX_FILES) {
      return res.status(400).json({ error: `Maximum ${MAX_FILES} files allowed per transfer.` });
    }

    const code = await newCode();
    const uploadToken = crypto.randomBytes(24).toString("hex");
    const deleteToken = crypto.randomBytes(16).toString("hex");
    const now = Date.now();

    const preparedFiles = [];
    let totalBytes = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const name = safeName(f.name);
      const size = parseInt(f.size || "0", 10);
      if (size > MAX_FILE_MB * 1024 * 1024) {
        await removeDrop(code);
        return res.status(400).json({ error: `File "${name}" exceeds the ${MAX_FILE_MB / 1024} GB limit.` });
      }
      totalBytes += size;
      const stored = `${i}_${name}`;
      const filePath = path.join(dropDir(code), stored);

      // Create sparse / empty file on disk
      await fsp.writeFile(filePath, "");

      preparedFiles.push({
        index: i,
        name,
        stored,
        size,
        type: fileType(name, f.type),
      });
    }

    const session = {
      code,
      uploadToken,
      deleteToken,
      from: detectOS(req.get("user-agent")),
      note: String(note || "").slice(0, 280),
      createdAt: now,
      expiresAt: now + EXPIRE_HOURS * 3600 * 1000,
      total: totalBytes,
      files: preparedFiles,
    };

    activeSessions.set(code, session);

    // Adaptive chunk sizing & parallel pipeline config
    let optimalChunkSize = 8 * 1024 * 1024; // 8MB per chunk for high concurrency
    if (totalBytes > 10 * 1024 * 1024 * 1024) {
      optimalChunkSize = 16 * 1024 * 1024; // 16MB for 10GB+
    }

    res.json({
      code,
      uploadToken,
      chunkSize: optimalChunkSize,
      concurrency: 4, // 4 parallel concurrent streams for wire-speed pipelining
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    console.error("Upload init error:", err);
    res.status(500).json({ error: "Failed to initialize upload session." });
  }
});

// 2. High-speed positional chunk writing (Supports concurrent parallel writes to any offset)
app.post("/api/upload/chunk", async (req, res) => {
  const code = req.get("x-drop-code") || req.query.code;
  const token = req.get("x-upload-token") || req.query.token;
  const fileIndex = parseInt(req.get("x-file-index") || req.query.fileIndex, 10);
  const offset = parseInt(req.get("x-offset") || req.query.offset || "0", 10);

  if (!code || !token || isNaN(fileIndex)) {
    return res.status(400).json({ error: "Invalid chunk parameters." });
  }

  const session = activeSessions.get(code);
  if (!session || session.uploadToken !== token) {
    return res.status(403).json({ error: "Invalid or expired upload session." });
  }

  const targetFile = session.files[fileIndex];
  if (!targetFile) {
    return res.status(404).json({ error: "Target file index not found." });
  }

  const targetPath = path.join(dropDir(code), targetFile.stored);

  try {
    // Read raw incoming binary chunk
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Positional file descriptor write (Safe for concurrent parallel chunks at distinct offsets)
    const fd = await fsp.open(targetPath, "r+");
    await fd.write(buffer, 0, buffer.length, offset);
    await fd.close();

    res.json({ ok: true, fileIndex, offset, bytes: buffer.length });
  } catch (err) {
    console.error("Parallel chunk write error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Disk write error." });
  }
});

// 3. Complete and finalize upload session
app.post("/api/upload/finish", async (req, res) => {
  const { code, uploadToken } = req.body || {};
  if (!code || !uploadToken) {
    return res.status(400).json({ error: "Missing code or upload token." });
  }

  const session = activeSessions.get(code);
  if (!session || session.uploadToken !== uploadToken) {
    return res.status(403).json({ error: "Invalid upload session." });
  }

  try {
    for (const f of session.files) {
      const p = path.join(dropDir(code), f.stored);
      const stat = await fsp.stat(p).catch(() => null);
      if (stat) {
        f.size = stat.size;
      }
    }

    const totalCalculated = session.files.reduce((a, f) => a + f.size, 0);
    const meta = {
      code: session.code,
      from: session.from,
      note: session.note,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      downloads: 0,
      deleteTokenHash: crypto.createHash("sha256").update(session.deleteToken).digest("hex"),
      total: totalCalculated,
      files: session.files,
    };

    await writeMeta(meta);
    activeSessions.delete(code);

    res.json({
      code: meta.code,
      deleteToken: session.deleteToken,
      expiresAt: meta.expiresAt,
      files: meta.files.length,
      total: meta.total,
    });
  } catch (err) {
    console.error("Finish upload error:", err);
    res.status(500).json({ error: "Failed to finalize upload." });
  }
});

// ---------- FALLBACK STANDARD MULTIPART UPLOAD ----------
async function claimCode(req, res, next) {
  try {
    req.dropCode = await newCode();
    req.fileCounter = 0;
    next();
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dropDir(req.dropCode)),
  filename: (req, file, cb) => cb(null, `${req.fileCounter++}_${safeName(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES, fields: 20 },
});

app.post("/api/upload", claimCode, (req, res) => {
  upload.array("files", MAX_FILES)(req, res, async (err) => {
    const code = req.dropCode;
    if (err) {
      await removeDrop(code);
      const msg =
        err.code === "LIMIT_FILE_SIZE" ? `A file exceeds the ${MAX_FILE_MB / 1024} GB limit.` :
        err.code === "LIMIT_FILE_COUNT" ? `You can send up to ${MAX_FILES} files at once.` :
        "Upload failed. Please try again.";
      return res.status(400).json({ error: msg });
    }
    if (!req.files || !req.files.length) {
      await removeDrop(code);
      return res.status(400).json({ error: "Choose at least one file." });
    }
    const fixName = (n) => { try { return Buffer.from(n, "latin1").toString("utf8"); } catch { return n; } };
    const now = Date.now();
    const deleteToken = crypto.randomBytes(16).toString("hex");
    const meta = {
      code,
      from: detectOS(req.get("user-agent")),
      note: String(req.body.note || "").slice(0, 280),
      createdAt: now,
      expiresAt: now + EXPIRE_HOURS * 3600 * 1000,
      downloads: 0,
      deleteTokenHash: crypto.createHash("sha256").update(deleteToken).digest("hex"),
      total: req.files.reduce((a, f) => a + f.size, 0),
      files: req.files.map((f) => {
        const name = safeName(fixName(f.originalname));
        return { name, stored: f.filename, size: f.size, type: fileType(name, f.mimetype) };
      }),
    };
    await writeMeta(meta);
    res.json({ code, deleteToken, expiresAt: meta.expiresAt, files: meta.files.length, total: meta.total });
  });
});

// ---------- RECEIVE & DOWNLOAD ----------
app.get("/api/drop/:code", rateLimit(60, 60000), async (req, res) => {
  const meta = await readMeta(req.params.code);
  if (!meta) return res.status(404).json({ error: "No drop has that code, or it has expired." });
  res.json(publicMeta(meta));
});

async function countDownload(meta) {
  meta.downloads++;
  await writeMeta(meta);
  if (MAX_DOWNLOADS > 0 && meta.downloads >= MAX_DOWNLOADS) {
    setTimeout(() => removeDrop(meta.code), 60_000);
  }
}

// Multi-Gigabit Single File Download with Range & High Stream Buffers
app.get("/api/drop/:code/file/:index", async (req, res) => {
  const meta = await readMeta(req.params.code);
  const fileIndex = parseInt(req.params.index, 10);
  const f = meta && meta.files[fileIndex];
  if (!f) return res.status(404).json({ error: "File not found or expired." });

  const filePath = path.join(dropDir(meta.code), f.stored);
  const inline = req.query.view === "1";

  try {
    const stat = await fsp.stat(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader("Content-Type", f.type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(f.name)}`
    );
    res.setHeader("Accept-Ranges", "bytes");

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Content-Length", chunksize);

      const fileStream = fs.createReadStream(filePath, { start, end, highWaterMark: 2 * 1024 * 1024 });
      fileStream.pipe(res);
    } else {
      if (!inline) countDownload(meta).catch(() => {});
      res.setHeader("Content-Length", fileSize);
      const fileStream = fs.createReadStream(filePath, { highWaterMark: 2 * 1024 * 1024 });
      fileStream.pipe(res);
    }
  } catch {
    if (!res.headersSent) res.status(404).json({ error: "File not accessible." });
  }
});

// Download everything as fast streaming ZIP
app.get("/api/drop/:code/zip", async (req, res) => {
  const meta = await readMeta(req.params.code);
  if (!meta) return res.status(404).json({ error: "No drop has that code, or it has expired." });

  countDownload(meta).catch(() => {});
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="crossway-drop-${meta.code}.zip"`);

  const zip = archiver("zip", { store: true, highWaterMark: 4 * 1024 * 1024 });
  zip.on("error", () => res.destroy());
  zip.pipe(res);

  const used = new Map();
  for (const f of meta.files) {
    let name = f.name;
    const n = used.get(name) || 0;
    used.set(f.name, n + 1);
    if (n) name = name.replace(/(\.[^.]*)?$/, `-${n + 1}$1`);
    zip.file(path.join(dropDir(meta.code), f.stored), { name });
  }
  zip.finalize();
});

// Delete drop
app.delete("/api/drop/:code", async (req, res) => {
  const meta = await readMeta(req.params.code);
  if (!meta) return res.status(404).json({ error: "Drop not found." });
  const token = String(req.get("x-delete-token") || "");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(meta.deleteTokenHash))) {
    return res.status(403).json({ error: "Only the sender can delete this drop." });
  }
  await removeDrop(meta.code);
  res.json({ deleted: true });
});

// QR code (SVG)
const QRCode = require("qrcode");
app.get("/api/qr/:code", async (req, res) => {
  if (!CODE_RE.test(req.params.code)) return res.status(400).end();
  const url = `${req.protocol}://${req.get("host")}/r/${req.params.code}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#0F172A", light: "#FFFFFF" } });
  res.type("image/svg+xml").send(svg);
});

app.get("/api/config", (req, res) => {
  res.json({
    maxFileMB: MAX_FILE_MB,
    maxFiles: MAX_FILES,
    expireHours: EXPIRE_HOURS,
    maxDownloads: MAX_DOWNLOADS,
  });
});

// Static files (supports both frontend/ and public/ structures)
const FRONTEND_DIR = fs.existsSync(path.join(__dirname, "..", "frontend"))
  ? path.join(__dirname, "..", "frontend")
  : fs.existsSync(path.join(__dirname, "frontend"))
  ? path.join(__dirname, "frontend")
  : path.join(__dirname, "public");

app.use(express.static(FRONTEND_DIR, { extensions: ["html"] }));
app.get("/r/:code", (req, res) => res.sendFile(path.join(FRONTEND_DIR, "index.html")));

// Cleanup
async function cleanup() {
  let entries = [];
  try { entries = await fsp.readdir(STORAGE_DIR); } catch { return; }
  for (const code of entries) {
    if (!CODE_RE.test(code)) continue;
    try {
      const meta = JSON.parse(await fsp.readFile(metaPath(code), "utf8"));
      if (Date.now() > meta.expiresAt) await removeDrop(code);
    } catch {
      const st = await fsp.stat(dropDir(code)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 3600_000) await removeDrop(code);
    }
  }
}
setInterval(cleanup, 10 * 60 * 1000).unref();
cleanup();

const server = app.listen(PORT, HOST, () => {
  const nets = require("os").networkInterfaces();
  const ips = Object.values(nets).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n.address);
  console.log(`\nCrossway Drop is running`);
  console.log(`  This computer:   http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  Phones on Wi-Fi: http://${ip}:${PORT}`));
  console.log(`  Files stored in: ${STORAGE_DIR} (auto-deleted after ${EXPIRE_HOURS} h)\n`);
});
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 120000;
