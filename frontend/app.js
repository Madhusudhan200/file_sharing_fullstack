(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const OSES = ["iOS", "Android", "macOS", "Windows", "Linux"];

  // ---------- helpers ----------
  function detectOS() {
    const ua = navigator.userAgent || "";
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(p) && navigator.maxTouchPoints > 1)) return "iOS";
    if (/Android/i.test(ua)) return "Android";
    if (/Win/i.test(p) || /Windows/.test(ua)) return "Windows";
    if (/Mac/i.test(p) || /Mac OS X/.test(ua)) return "macOS";
    if (/Linux|X11|CrOS/i.test(p + ua)) return "Linux";
    return "Browser";
  }
  const ME = detectOS();
  $("thisOS").textContent = ME;

  const fmt = (n) => {
    if (isNaN(n) || n <= 0) return "0 B";
    if (n < 1024) return n + " B";
    const u = ["KB", "MB", "GB", "TB", "PB"];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n < 10 ? n.toFixed(1) : n.toFixed(0)) + " " + u[i];
  };

  const fmtTime = (seconds) => {
    if (!isFinite(seconds) || seconds <= 0) return "calculating…";
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    if (mins < 60) return `${mins}m ${secs}s`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  const ext = (name) => {
    const m = /\.([a-z0-9]+)$/i.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  };

  function getAppInfo(fileName) {
    const e = ext(fileName);
    if (e === "apk" || e === "xapk" || e === "aab") {
      return { isApp: true, type: "apk", label: "APK", desc: "Android App Package", btnText: "📲 Install APK", colorClass: "app-apk" };
    }
    if (e === "exe" || e === "msi" || e === "msix") {
      return { isApp: true, type: "win", label: "EXE", desc: "Windows Application", btnText: "💻 Download App", colorClass: "app-win" };
    }
    if (e === "dmg" || e === "pkg" || e === "app" || (fileName && fileName.endsWith(".app.zip"))) {
      return { isApp: true, type: "mac", label: "MAC", desc: "macOS Application Bundle", btnText: "🍏 Download Mac App", colorClass: "app-mac" };
    }
    if (e === "appimage" || e === "deb" || e === "rpm") {
      return { isApp: true, type: "linux", label: "LINUX", desc: "Linux App Package", btnText: "🐧 Download Package", colorClass: "app-linux" };
    }
    if (e === "ipa") {
      return { isApp: true, type: "ios", label: "IPA", desc: "iOS App Package", btnText: "📱 Download iOS App", colorClass: "app-ios" };
    }
    return { isApp: false, type: "file", label: e || "FILE", desc: "", btnText: "⚡ Download", colorClass: "" };
  }

  const ago = (t) => {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    return Math.round(h / 24) + " d ago";
  };

  const until = (t) => {
    const m = Math.max(0, Math.round((t - Date.now()) / 60000));
    return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
  };

  const el = (tag, attrs = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach((c) => c && e.append(c));
    return e;
  };

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  async function copy(text, btn, label) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied ✓";
    } catch {
      btn.textContent = text;
    }
    setTimeout(() => (btn.textContent = label), 1600);
  }

  // ---------- config ----------
  let config = { maxFileMB: 512000, maxFiles: 1000000, expireHours: 24 };
  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => {
      config = c;
      $("limits").textContent = `Unlimited files · APKs · Windows EXE · Mac DMG/App · Linux · Videos · Any file up to ${fmt(config.maxFileMB * 1048576)} (500 GB+)`;
      $("expireNote").textContent = `Files are deleted automatically after ${config.expireHours} hours.`;
    })
    .catch(() => {});

  // ---------- route matrix ----------
  (function buildMatrix() {
    const t = $("matrix");
    const head = el("tr", {}, [el("th")]);
    OSES.forEach((o) => head.append(el("th", { text: o, class: o === ME ? "me" : "" })));
    t.append(head);
    OSES.forEach((r) => {
      const tr = el("tr", {}, [el("th", { text: r, class: "rowh" + (r === ME ? " me" : "") })]);
      OSES.forEach((c) => {
        const cls = r === ME && c === ME ? "self" : r === ME || c === ME ? "me" : "";
        tr.append(el("td", { text: "✓", class: cls, title: `${r} → ${c}` }));
      });
      t.append(tr);
    });
  })();

  // ---------- picking files & apps (Universal Handler) ----------
  let picked = [];

  function renderPicked() {
    const ul = $("pickList");
    ul.replaceChildren();
    ul.hidden = !picked.length;

    const renderLimit = Math.min(picked.length, 80);
    for (let i = 0; i < renderLimit; i++) {
      const f = picked[i];
      const appInfo = getAppInfo(f.name);
      const icon = el("div", { class: "ficon " + appInfo.colorClass });

      if (appInfo.isApp) {
        icon.innerHTML = `<span class="app-badge">${appInfo.label}</span>`;
      } else if (/^image\//.test(f.type) && f.size < 15 * 1048576) {
        const img = new Image();
        img.alt = "";
        img.src = URL.createObjectURL(f);
        img.onload = () => URL.revokeObjectURL(img.src);
        img.onerror = () => { icon.textContent = ext(f.name) || "img"; };
        icon.append(img);
      } else {
        icon.textContent = ext(f.name) || "file";
      }

      ul.append(
        el("li", {}, [
          icon,
          el("div", { class: "finfo" }, [
            el("div", { class: "fname", text: f.name }),
            el("div", { class: "fmeta", text: fmt(f.size) + (appInfo.desc ? ` • ${appInfo.desc}` : "") }),
          ]),
          el("button", {
            class: "x",
            "aria-label": "Remove " + f.name,
            text: "✕",
            onclick: () => {
              picked.splice(i, 1);
              renderPicked();
            },
          }),
        ])
      );
    }

    if (picked.length > 80) {
      const moreCount = picked.length - 80;
      ul.append(
        el("li", { class: "more-files-row" }, [
          el("div", { class: "fname muted", text: `+ ${moreCount} more files selected` }),
          el("button", {
            class: "btn sm danger-outline",
            text: "Clear All",
            onclick: () => {
              picked = [];
              renderPicked();
            },
          }),
        ])
      );
    }

    const total = picked.reduce((a, f) => a + (f.size || 0), 0);
    $("pickSummary").textContent = picked.length
      ? `${picked.length} item${picked.length > 1 ? "s" : ""} · ${fmt(total)}`
      : "";
    $("sendBtn").disabled = !picked.length;
  }

  // Auto-package Mac .app bundles into a clean .app.zip
  async function packageAppFolderIfApp(files) {
    if (!files || !files.length) return [];
    const appBundles = new Map();
    const regularFiles = [];

    for (const f of files) {
      const relPath = f.webkitRelativePath || f.relativePath || f.name;
      const match = /^([^/]+\.app)\/(.*)$/.exec(relPath);
      if (match) {
        const bundleName = match[1];
        if (!appBundles.has(bundleName)) appBundles.set(bundleName, []);
        appBundles.get(bundleName).push({ path: match[2], file: f });
      } else {
        regularFiles.push(f);
      }
    }

    const result = [...regularFiles];

    for (const [bundleName, bundleFiles] of appBundles.entries()) {
      if (typeof JSZip !== "undefined") {
        $("sendMsg").className = "msg muted";
        $("sendMsg").textContent = `Packaging Mac app ${bundleName}…`;
        const zip = new JSZip();
        for (const item of bundleFiles) {
          zip.file(bundleName + "/" + item.path, item.file);
        }
        const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
        const zipFile = new File([zipBlob], bundleName + ".zip", { type: "application/zip" });
        result.push(zipFile);
      } else {
        result.push(...bundleFiles.map((b) => b.file));
      }
    }

    return result;
  }

  async function addFiles(rawList) {
    if (!rawList || !rawList.length) return;
    const msg = $("sendMsg");
    msg.textContent = "";
    msg.className = "msg";

    const list = await packageAppFolderIfApp(Array.from(rawList));

    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!f) continue;
      const fSize = f.size || 0;
      if (fSize > config.maxFileMB * 1048576) {
        msg.className = "msg err";
        msg.textContent = `${f.name} exceeds ${fmt(config.maxFileMB * 1048576)} limit.`;
        continue;
      }
      picked.push(f);
    }
    renderPicked();
  }

  // File and Folder picking triggers
  $("pickFilesBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("fileIn").click();
  });
  $("pickFolderBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("folderIn").click();
  });
  $("drop").addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    $("fileIn").click();
  });

  $("fileIn").addEventListener("change", async (e) => {
    await addFiles(e.target.files);
    e.target.value = "";
  });
  $("folderIn").addEventListener("change", async (e) => {
    await addFiles(e.target.files);
    e.target.value = "";
  });

  // Deep recursive scanner for dropped folders and .app bundles
  async function scanEntry(entry, pathPrefix = "") {
    if (!entry) return [];
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((f) => {
          if (pathPrefix) {
            Object.defineProperty(f, "webkitRelativePath", {
              value: pathPrefix + f.name,
              writable: false,
            });
          }
          resolve([f]);
        }, () => resolve([]));
      });
    }
    if (entry.isDirectory) {
      const currentPath = pathPrefix ? pathPrefix + entry.name + "/" : entry.name + "/";
      const reader = entry.createReader();
      const readAll = async () => {
        return new Promise((resolve) => {
          reader.readEntries(async (entries) => {
            if (!entries || !entries.length) return resolve([]);
            const sub = await Promise.all(entries.map((ent) => scanEntry(ent, currentPath)));
            const more = await readAll();
            resolve(sub.flat().concat(more));
          }, () => resolve([]));
        });
      };
      return await readAll();
    }
    return [];
  }

  async function extractDroppedFiles(dataTransfer) {
    const files = [];
    if (dataTransfer.items && dataTransfer.items.length) {
      const items = [...dataTransfer.items];
      for (const item of items) {
        if (typeof item.webkitGetAsEntry === "function") {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            const extracted = await scanEntry(entry);
            files.push(...extracted);
            continue;
          }
        }
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    } else if (dataTransfer.files) {
      files.push(...dataTransfer.files);
    }
    return files;
  }

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("over");
    })
  );

  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (e.dataTransfer) {
      const files = await extractDroppedFiles(e.dataTransfer);
      await addFiles(files);
    }
  });

  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!e.target.closest("#drop") && e.dataTransfer) {
      const files = await extractDroppedFiles(e.dataTransfer);
      if (files.length) await addFiles(files);
    }
  });

  document.addEventListener("paste", async (e) => {
    if (e.target.closest("input,textarea")) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) await addFiles(files);
  });

  // ---------- MULTI-THREADED / PARALLEL PIPELINED STREAM SENDER ----------
  let abortController = null;
  let isUploading = false;

  $("sendBtn").addEventListener("click", async () => {
    if (!picked.length || isUploading) return;

    isUploading = true;
    abortController = new AbortController();
    const signal = abortController.signal;

    const totalBytes = picked.reduce((a, f) => a + (f.size || 0), 0);
    const msg = $("sendMsg");
    msg.textContent = "";
    msg.className = "msg";

    $("sendBtn").disabled = true;
    $("sendProg").hidden = false;
    $("progBar").style.width = "0%";
    $("progText").textContent = `Launching multi-channel stream…`;

    const startedTime = Date.now();
    let totalUploadedBytes = 0;
    let speedSamples = [];

    try {
      // 1. Initialize transfer session
      const fileDescriptors = picked.map((f) => ({
        name: f.name,
        size: f.size || 0,
        type: f.type || "application/octet-stream",
      }));

      const initRes = await fetch("/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: $("noteIn").value.trim(),
          files: fileDescriptors,
        }),
        signal,
      });

      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to initialize session.");
      }

      const { code, uploadToken, chunkSize = 8 * 1024 * 1024, concurrency = 4 } = await initRes.json();

      // 2. Build full task queue of all chunks
      const chunkTasks = [];
      for (let fileIdx = 0; fileIdx < picked.length; fileIdx++) {
        const file = picked[fileIdx];
        const fileSize = file.size || 0;
        let offset = 0;
        while (offset < fileSize) {
          const end = Math.min(offset + chunkSize, fileSize);
          chunkTasks.push({
            file,
            fileIdx,
            offset,
            end,
            size: end - offset,
          });
          offset = end;
        }
      }

      // 3. Multi-Connection Worker Pool (4 parallel streams)
      let taskIndex = 0;
      const workerCount = Math.min(concurrency, Math.max(1, chunkTasks.length));

      const runWorker = async () => {
        while (taskIndex < chunkTasks.length) {
          if (signal.aborted) throw new Error("Upload cancelled");

          const currentIndex = taskIndex++;
          const task = chunkTasks[currentIndex];
          if (!task) break;

          const chunkBlob = task.file.slice(task.offset, task.end);
          let success = false;
          let retries = 0;

          while (!success && retries < 5) {
            try {
              const res = await fetch("/api/upload/chunk", {
                method: "POST",
                headers: {
                  "x-drop-code": code,
                  "x-upload-token": uploadToken,
                  "x-file-index": String(task.fileIdx),
                  "x-offset": String(task.offset),
                  "Content-Type": "application/octet-stream",
                },
                body: chunkBlob,
                signal,
              });

              if (!res.ok) {
                throw new Error("HTTP error " + res.status);
              }

              success = true;
              totalUploadedBytes += task.size;

              const now = Date.now();
              const durationSec = Math.max(0.05, (now - startedTime) / 1000);
              const currentSpeed = totalUploadedBytes / durationSec;

              speedSamples.push(currentSpeed);
              if (speedSamples.length > 10) speedSamples.shift();
              const smoothedSpeed = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;

              const pct = totalBytes > 0 ? Math.min(99, Math.round((totalUploadedBytes / totalBytes) * 100)) : 100;
              const remainingBytes = Math.max(0, totalBytes - totalUploadedBytes);
              const etaSec = smoothedSpeed > 0 ? remainingBytes / smoothedSpeed : 0;

              $("progBar").style.width = pct + "%";
              $("progText").innerHTML = `<b>${pct}%</b> · ${fmt(totalUploadedBytes)} / ${fmt(totalBytes)} · <span class="speed">⚡ ${fmt(smoothedSpeed)}/s</span> · ETA: ${fmtTime(etaSec)}`;
            } catch (err) {
              if (signal.aborted) throw err;
              retries++;
              await new Promise((r) => setTimeout(r, 400 * retries));
            }
          }

          if (!success) {
            throw new Error(`Failed to upload ${task.file.name}`);
          }
        }
      };

      const workers = Array.from({ length: workerCount }, () => runWorker());
      await Promise.all(workers);

      // 4. Finalize drop
      $("progText").textContent = "Finalizing drop…";
      const finishRes = await fetch("/api/upload/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, uploadToken }),
        signal,
      });

      if (!finishRes.ok) {
        throw new Error("Failed to finalize drop.");
      }

      const finishData = await finishRes.json();
      $("progBar").style.width = "100%";
      $("sendProg").hidden = true;

      store.set("drop:" + finishData.code, finishData.deleteToken);
      showCode(finishData);
      picked = [];
      $("noteIn").value = "";
      renderPicked();
    } catch (err) {
      $("sendProg").hidden = true;
      $("sendBtn").disabled = false;
      if (err.name === "AbortError" || err.message === "Upload cancelled") {
        msg.className = "msg muted";
        msg.textContent = "Upload cancelled.";
      } else {
        msg.className = "msg err";
        msg.textContent = err.message || "Transfer error. Check connection.";
      }
    } finally {
      isUploading = false;
      abortController = null;
    }
  });

  $("cancelBtn").addEventListener("click", () => {
    if (abortController) abortController.abort();
  });

  window.addEventListener("beforeunload", (e) => {
    if (isUploading) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  let sentCode = null;
  function showCode(data) {
    sentCode = data.code;
    $("codeTiles").replaceChildren(
      ...data.code.split("").map((d) => el("div", { class: "tile", text: d }))
    );
    $("qr").src = "/api/qr/" + data.code;
    $("expiry").textContent = `${data.files} item${data.files > 1 ? "s" : ""} · ${fmt(data.total)} · auto-deleted in ${until(data.expiresAt)}`;
    $("sendForm").hidden = true;
    $("result").hidden = false;
    resetDelete();
  }

  const link = () => `${location.origin}/r/${sentCode}`;
  $("copyCode").addEventListener("click", (e) => copy(sentCode, e.target, "Copy code"));
  $("copyLink").addEventListener("click", (e) => copy(link(), e.target, "Copy link"));
  $("sendMore").addEventListener("click", () => {
    $("result").hidden = true;
    $("sendForm").hidden = false;
  });

  let armTimer;
  function resetDelete() {
    const b = $("deleteBtn");
    b.classList.remove("armed");
    b.textContent = "Delete now";
    b.disabled = false;
    clearTimeout(armTimer);
  }

  $("deleteBtn").addEventListener("click", async () => {
    const b = $("deleteBtn");
    if (!b.classList.contains("armed")) {
      b.classList.add("armed");
      b.textContent = "Tap again to confirm delete";
      armTimer = setTimeout(resetDelete, 4000);
      return;
    }
    clearTimeout(armTimer);
    b.disabled = true;
    const ok = await deleteDrop(sentCode);
    if (ok) {
      $("result").hidden = true;
      $("sendForm").hidden = false;
      $("sendMsg").className = "msg ok";
      $("sendMsg").textContent = `Drop ${sentCode} deleted.`;
    } else {
      resetDelete();
    }
  });

  async function deleteDrop(code) {
    const token = store.get("drop:" + code);
    try {
      const r = await fetch("/api/drop/" + code, {
        method: "DELETE",
        headers: { "x-delete-token": token || "" },
      });
      if (r.ok || r.status === 404) {
        store.del("drop:" + code);
        return true;
      }
    } catch {}
    return false;
  }

  // ---------- receiving ----------
  const boxes = [...$("codeIn").querySelectorAll("input")];
  boxes.forEach((b, i) => {
    b.addEventListener("input", () => {
      b.value = b.value.replace(/\D/g, "").slice(-1);
      if (b.value && i < 5) boxes[i + 1].focus();
      lookup();
    });
    b.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !b.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].value = "";
      }
    });
    b.addEventListener("paste", (e) => {
      const d = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      d.split("").forEach((c, j) => {
        if (boxes[j]) boxes[j].value = c;
      });
      boxes[Math.min(5, d.length)].focus();
      lookup();
    });
  });

  const setBoxes = (code) => code.split("").forEach((c, j) => (boxes[j].value = c));

  let lastLookup = "";
  async function lookup(force) {
    const code = boxes.map((b) => b.value).join("");
    const msg = $("recvMsg");
    if (code.length < 6) {
      lastLookup = "";
      return;
    }
    if (code === lastLookup && !force) return;
    lastLookup = code;
    msg.className = "msg muted";
    msg.textContent = `Looking up drop ${code}…`;
    try {
      const r = await fetch("/api/drop/" + code);
      const data = await r.json();
      if (!r.ok) {
        msg.className = "msg err";
        msg.textContent = data.error || "No drop found for that code.";
        $("dropView").replaceChildren();
        return;
      }
      msg.textContent = "";
      renderDrop(data);
    } catch {
      msg.className = "msg err";
      msg.textContent = "Couldn't reach the server. Check your connection.";
    }
  }

  function renderDrop(d) {
    const base = `/api/drop/${d.code}`;
    const head = el("div", { class: "card-head" }, [
      el("div", { class: "row between" }, [
        el("span", { class: "eyebrow", text: "Drop #" + d.code }),
        el("span", { class: "badge-speed", text: "⚡ Multi-Channel Wire Speed" }),
      ]),
      el("span", { class: "route", text: `Sent from ${d.from} → ${ME}` }),
      el("span", {
        class: "fmeta",
        text: `${d.files.length} item${d.files.length > 1 ? "s" : ""} · ${fmt(d.total)} · sent ${ago(d.createdAt)} · expires in ${until(d.expiresAt)}`,
      }),
    ]);
    if (d.note) head.append(el("p", { class: "note", text: `“${d.note}”` }));

    const ul = el("ul", { class: "flist" });
    d.files.forEach((f) => {
      const appInfo = getAppInfo(f.name);
      const url = `${base}/file/${f.index}`;
      const icon = el("div", { class: "ficon " + appInfo.colorClass });

      if (appInfo.isApp) {
        icon.innerHTML = `<span class="app-badge">${appInfo.label}</span>`;
      } else if (/^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.test(f.type)) {
        const img = new Image();
        img.alt = "";
        img.loading = "lazy";
        img.src = url + "?view=1";
        img.onerror = () => { icon.textContent = ext(f.name) || "img"; };
        icon.append(img);
      } else {
        icon.textContent = ext(f.name) || "file";
      }

      const actions = el("div", { class: "row", style: "flex-wrap:nowrap" });
      if (/^(image|video|audio)\/|^application\/pdf$|^text\//.test(f.type)) {
        actions.append(
          el("a", { class: "btn sm", href: url + "?view=1", target: "_blank", rel: "noopener", text: "Stream / View" })
        );
      }

      actions.append(
        el("a", { class: "btn sm primary " + (appInfo.isApp ? "app-btn" : ""), href: url, download: f.name, text: appInfo.btnText })
      );

      ul.append(
        el("li", {}, [
          icon,
          el("div", { class: "finfo" }, [
            el("div", { class: "fname", text: f.name }),
            el("div", { class: "fmeta", text: fmt(f.size) + (appInfo.desc ? ` • ${appInfo.desc}` : "") }),
          ]),
          actions,
        ])
      );
    });

    const card = el("div", { class: "card" }, [head, ul]);
    const foot = el("div", { class: "card-foot row between" });

    if (d.files.length > 1) {
      foot.append(
        el("a", {
          class: "btn primary sm",
          href: `${base}/zip`,
          download: `crossway-drop-${d.code}.zip`,
          text: "⚡ Download All as .ZIP",
        })
      );
    }

    if (store.get("drop:" + d.code)) {
      const del = el("button", { class: "btn sm danger", text: "Delete Drop" });
      let t;
      del.addEventListener("click", async () => {
        if (!del.classList.contains("armed")) {
          del.classList.add("armed");
          del.textContent = "Tap again to delete";
          t = setTimeout(() => {
            del.classList.remove("armed");
            del.textContent = "Delete Drop";
          }, 4000);
          return;
        }
        clearTimeout(t);
        del.disabled = true;
        if (await deleteDrop(d.code)) {
          $("dropView").replaceChildren();
          $("recvMsg").className = "msg ok";
          $("recvMsg").textContent = `Drop ${d.code} deleted.`;
        } else {
          del.disabled = false;
        }
      });
      foot.append(del);
    }

    if (foot.childNodes.length) card.append(foot);

    const hasApk = d.files.some((f) => ext(f.name) === "apk");
    const hasExe = d.files.some((f) => ext(f.name) === "exe" || ext(f.name) === "msi");
    const hasMac = d.files.some((f) => ext(f.name) === "dmg" || ext(f.name) === "pkg" || ext(f.name) === "app" || f.name.endsWith(".app.zip"));

    if (hasApk) {
      card.append(
        el("div", {
          class: "card-foot fmeta app-hint-box",
          text: "💡 Android APK: Tap 'Install APK'. Once downloaded, open it from notification/Downloads to install on your phone.",
        })
      );
    } else if (hasExe) {
      card.append(
        el("div", {
          class: "card-foot fmeta app-hint-box",
          text: "💡 Windows App: Run the downloaded .exe/.msi file to start installation.",
        })
      );
    } else if (hasMac) {
      card.append(
        el("div", {
          class: "card-foot fmeta app-hint-box",
          text: "💡 macOS App: Open the downloaded .dmg / unzip the .app.zip and move to your Applications folder.",
        })
      );
    } else if (ME === "iOS") {
      card.append(
        el("div", {
          class: "card-foot fmeta",
          text: "iPhone: Downloads save to Files › Downloads. For instant photo/video saving, tap View/Stream then Share › Save.",
        })
      );
    }
    $("dropView").replaceChildren(card);
  }

  // Handle incoming link /r/123456
  const m = /^\/r\/(\d{6})\/?$/.exec(location.pathname);
  if (m) {
    setBoxes(m[1]);
    lookup(true).then(() => {
      if (window.innerWidth < 860) $("codeIn").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  renderPicked();
})();
