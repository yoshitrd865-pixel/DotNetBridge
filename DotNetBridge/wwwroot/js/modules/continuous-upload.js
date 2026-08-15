// wwwroot/js/modules/continuous-upload.js

let imageQueue = [];
let wakeLock = null;
let compressingCount = 0;

const DB_NAME = 'TFK_OfflineUploadDB';
const STORE_NAME = 'failed_uploads';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveFailedImage(file, formAction, inputName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({ file, fileName: file.name, formAction, inputName, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getSavedImages() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (e) { return []; }
}

async function clearSavedImages() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.oncomplete = () => resolve();
      req.onerror = () => resolve();
    });
  } catch (e) {}
}

const workerScript = `
  self.onmessage = async function(e) {
    const { file, maxSide } = e.data;
    try {
      const bitmap = await createImageBitmap(file);
      let width = bitmap.width;
      let height = bitmap.height;
      if (width > height) {
        if (width > maxSide) { height *= maxSide / width; width = maxSide; }
      } else {
        if (height > maxSide) { width *= maxSide / height; height = maxSide; }
      }
      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      self.postMessage({ success: true, blob });
    } catch (error) {
      self.postMessage({ success: false, error: error.message });
    }
  };
`;

const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(workerBlob);

async function requestWakeLockIfNeeded() {
  compressingCount++;
  if (wakeLock) return;
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { wakeLock = null; }
}

function releaseWakeLockIfDone() {
  compressingCount = Math.max(0, compressingCount - 1);
  if (compressingCount === 0 && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    worker.onmessage = (e) => {
      if (e.data.success) {
        const compressedFile = new File([e.data.blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", { type: 'image/jpeg' });
        resolve(compressedFile);
      } else { reject(new Error(e.data.error)); }
      worker.terminate();
    };
    worker.onerror = (err) => { reject(err); worker.terminate(); };
    worker.postMessage({ file, maxSide: 1280 });
  });
}

function addPlaceholder(index) {
  const container = document.getElementById('my-previews');
  if (!container) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'img-wrapper-' + index;
  wrapper.style.cssText = 'position:relative; width:100px; height:125px; flex-shrink:0; display:flex; flex-direction:column; align-items:center;';

  const img = document.createElement('div');
  img.id = 'img-view-' + index;
  img.style.cssText = 'width:90px; height:90px; border-radius:10px; border:1px solid #cbd5e1; background:#f8fafc; display:flex; align-items:center; justify-content:center; font-size:11px; color:#64748b;';
  img.innerText = '処理中...';

  const sizeLabel = document.createElement('div');
  sizeLabel.id = 'size-label-' + index;
  sizeLabel.innerText = 'WAIT';
  sizeLabel.style.cssText = 'font-size:11px; color:#94a3b8; margin-top:4px; font-weight:500;';

  const deleteBtn = document.createElement('div');
  deleteBtn.innerHTML = '✕';
  deleteBtn.style.cssText = 'position:absolute; top:-4px; right:2px; background:#475569; color:#fff; width:22px; height:22px; border-radius:50%; text-align:center; line-height:20px; cursor:pointer; z-index:10; font-size:11px; box-shadow: 0 2px 4px rgba(0,0,0,0.15);';
  deleteBtn.onclick = () => {
    if (imageQueue[index] && imageQueue[index].previewUrl) {
      URL.revokeObjectURL(imageQueue[index].previewUrl);
    }
    imageQueue[index] = null;
    wrapper.remove();
    updateQueueStatus();
  };

  wrapper.appendChild(img);
  wrapper.appendChild(sizeLabel);
  wrapper.appendChild(deleteBtn);
  container.appendChild(wrapper);
  container.scrollLeft = container.scrollWidth;
}

function finalizePreview(index, compressedFile) {
  const imgView = document.getElementById('img-view-' + index);
  const sizeLabel = document.getElementById('size-label-' + index);
  if (!imgView || !sizeLabel) return;

  const previewUrl = URL.createObjectURL(compressedFile);
  imageQueue[index].previewUrl = previewUrl;

  requestAnimationFrame(() => {
    imgView.innerText = '';
    imgView.style.backgroundImage = `url(${previewUrl})`;
    imgView.style.backgroundSize = 'cover';
    imgView.style.border = '1px solid #cbd5e1';

    sizeLabel.innerText = formatBytes(compressedFile.size);
    sizeLabel.style.color = '#0284c7';
    sizeLabel.style.fontWeight = '600';
    
    const panel = document.getElementById('my-panel');
    if (panel) panel.style.transform = 'translateX(-50%) translateZ(0)';
  });
}

async function updateQueueStatus() {
  const activeQueue = imageQueue.filter(i => i !== null);
  const readyFiles = activeQueue.filter(i => i.status === 'ready');
  const isCompressing = activeQueue.some(i => i.status === 'compressing');

  const st = document.getElementById('my-st');
  const upBtn = document.getElementById('my-up');
  const resendBtn = document.getElementById('my-resend-btn');
  const previewsContainer = document.getElementById('my-previews');

  const savedImages = await getSavedImages();

  if (activeQueue.length > 0) {
    previewsContainer.style.display = 'flex';
  } else {
    previewsContainer.style.display = 'none';
  }

  if (savedImages.length > 0 && readyFiles.length === 0 && !isCompressing) {
    if (resendBtn) {
      resendBtn.style.display = 'block';
      resendBtn.innerText = `未送信画像 (${savedImages.length}件) を再送信`;
    }
    if (st) st.innerHTML = `<span style="color:#ef4444;font-weight:600;">未送信データが ${savedImages.length} 件あります</span>`;
  } else {
    if (resendBtn) resendBtn.style.display = 'none';
    if (st) {
      if (isCompressing) {
        st.innerHTML = `<span style="color:#64748b;">画像を最適化中...</span>`;
      } else {
        st.innerHTML = `選択済み: <span style="font-size:18px;color:#0284c7;font-weight:700;">${readyFiles.length}</span> 件`;
      }
    }
  }

  if (upBtn) {
    if (isCompressing) {
      upBtn.disabled = true;
      upBtn.style.background = '#cbd5e1';
      upBtn.innerText = '処理中...';
    } else if (readyFiles.length > 0) {
      upBtn.disabled = false;
      upBtn.style.background = '#0284c7';
      upBtn.innerText = `送信する (${readyFiles.length}件)`;
    } else {
      upBtn.disabled = true;
      upBtn.style.background = '#e2e8f0';
      upBtn.style.color = '#94a3b8';
      upBtn.innerText = '送信する';
    }
  }
}

export function initContinuousUpload() {
  if (window.myAppClosed) return;

  const targetInput = document.querySelector('input[type="file"]:not(#my-input)');
  if (!targetInput || document.getElementById('my-panel')) return;

  targetInput.style.display = 'none';
  const form = targetInput.closest('form');
  const originalSubmit = form ? form.querySelector('input[type="submit"], button[type="submit"]') : null;
  if (originalSubmit) originalSubmit.style.display = 'none';

// 🏛️ シックデザイン × 撮影ボタン連打位置を復元したレイアウト
  const panel = document.createElement('div');
  panel.id = 'my-panel';
  panel.style.cssText = `
    position: fixed;
    bottom: 75px;
    left: 50%;
    transform: translateX(-50%);
    background: #ffffff;
    padding: 14px;
    border-radius: 16px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
    z-index: 100000;
    width: 92%;
    max-width: 400px;
    border: 1px solid #cbd5e1;
    text-align: center;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  panel.innerHTML = `
    <div id="my-st" style="font-weight:600; margin-bottom:10px; font-size:15px; color:#334155;">📸 写真を撮影してください</div>
    <div id="my-previews" style="display:none; gap:10px; overflow-x:auto; margin-bottom:10px; padding-bottom:6px; scroll-behavior: smooth;"></div>
    
    <div id="my-progress-container" style="display:none; width:100%; height:8px; background:#f1f5f9; border-radius:4px; margin-bottom:10px; overflow:hidden;">
      <div id="my-progress-bar" style="width:0%; height:100%; background:#0284c7; transition: width 0.3s ease;"></div>
    </div>
    
    <!-- 🔄 未送信データ専用の再送ボタン -->
    <button id="my-resend-btn" style="display:none; width:100%; padding:14px; background:#ef4444; color:#fff; border:none; border-radius:10px; font-weight:600; font-size:15px; margin-bottom:8px; cursor:pointer;">未送信画像を再送信</button>

    <!-- 📷 メインの撮影追加ボタン（連打しやすい上部・フル幅位置） -->
    <button id="my-add" style="width:100%; padding:16px; background:#0f172a; color:#ffffff; border:none; border-radius:12px; font-weight:700; font-size:17px; margin-bottom:8px; cursor:pointer; box-shadow: 0 4px 12px rgba(15,23,42,0.15); display:flex; align-items:center; justify-content:center; gap:6px;">
      <span>📷</span> 写真を撮影 (追加)
    </button>

    <!-- 📤 下部の送信ボタン -->
    <button id="my-up" style="width:100%; padding:12px; background:#e2e8f0; color:#94a3b8; border:none; border-radius:10px; font-weight:600; font-size:15px; cursor:pointer;" disabled>
      まとめて送信
    </button>

    <input id="my-input" type="file" accept="image/*" capture="environment" style="display:none;">
  `;
  document.body.appendChild(panel);

  const closePanelBtn = document.createElement('div');
  closePanelBtn.id = 'my-panel-close';
  closePanelBtn.innerHTML = '✕';
  closePanelBtn.style.cssText = 'position:absolute; top:12px; right:12px; color:#94a3b8; width:20px; height:20px; text-align:center; line-height:20px; cursor:pointer; font-size:12px; z-index:100001;';

  closePanelBtn.onclick = (e) => {
    e.preventDefault();
    if (confirm('追加した写真をクリアしてパネルを閉じますか？')) {
      window.myAppClosed = true;
      imageQueue.forEach(item => {
        if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      imageQueue = [];
      panel.remove();
      targetInput.style.display = 'block';
      if (originalSubmit) originalSubmit.style.display = 'block';
    }
  };
  panel.appendChild(closePanelBtn);

  const hi = document.getElementById('my-input');
  document.getElementById('my-add').onclick = (e) => { e.preventDefault(); hi.click(); };

  document.getElementById('my-resend-btn').onclick = async (e) => {
    e.preventDefault();
    const savedImages = await getSavedImages();
    if (savedImages.length === 0) return;

    document.getElementById('my-resend-btn').disabled = true;
    document.getElementById('my-add').disabled = true;
    closePanelBtn.style.display = 'none';
    const pb = document.getElementById('my-progress-bar');
    document.getElementById('my-progress-container').style.display = 'block';

    for (let i = 0; i < savedImages.length; i++) {
      const item = savedImages[i];
      const fd = new FormData(form);
      fd.set(targetInput.name, item.file, item.fileName);

      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', item.formAction || form.action || window.location.href);
        await new Promise((res, rej) => {
          xhr.upload.onprogress = (ev) => {
            const filePercent = ev.loaded / ev.total;
            const totalPercent = ((i + filePercent) / savedImages.length) * 100;
            pb.style.width = totalPercent + '%';
            document.getElementById('my-st').innerHTML = `<span style="color:#0284c7;">再送信中 (${i+1}/${savedImages.length})</span>`;
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) res();
            else rej(new Error('HTTP ' + xhr.status));
          };
          xhr.onerror = () => rej(new Error('Network Error'));
          xhr.send(fd);
        });
      } catch (err) {
        alert("再送信に失敗しました。電波状態を確認してください。");
        document.getElementById('my-resend-btn').disabled = false;
        document.getElementById('my-add').disabled = false;
        closePanelBtn.style.display = 'block';
        return;
      }
    }

    pb.style.width = '100%';
    document.getElementById('my-st').innerHTML = '送信完了';

    try { await clearSavedImages(); } catch (e) {}

    setTimeout(() => { window.location.href = window.location.href; }, 400);
  };

  hi.onchange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const index = imageQueue.length;

      imageQueue.push({ file: null, status: 'compressing', previewUrl: null });
      addPlaceholder(index);
      updateQueueStatus();

      hi.value = '';
      await requestWakeLockIfNeeded();

      try {
        await new Promise(r => setTimeout(r, 100));
        const compressedFile = await compressImage(file);
        if (imageQueue[index]) {
          imageQueue[index].file = compressedFile;
          imageQueue[index].status = 'ready';
          finalizePreview(index, compressedFile);
          updateQueueStatus();
        }
      } finally {
        releaseWakeLockIfDone();
      }
    }
  };

  document.getElementById('my-up').onclick = async (e) => {
    e.preventDefault();
    const activeItems = imageQueue.filter(i => i !== null && i.status === 'ready');
    if (activeItems.length === 0) return;

    document.getElementById('my-up').disabled = true;
    document.getElementById('my-add').disabled = true;
    closePanelBtn.style.display = 'none';
    const pb = document.getElementById('my-progress-bar');
    document.getElementById('my-progress-container').style.display = 'block';

    let failedCount = 0;

    for (let i = 0; i < activeItems.length; i++) {
      const fd = new FormData(form);
      const fileObj = activeItems[i].file;
      fd.set(targetInput.name, fileObj, fileObj.name);

      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', form.action || window.location.href);
        const uploadPromise = new Promise((res, rej) => {
          xhr.upload.onprogress = (ev) => {
            const filePercent = ev.loaded / ev.total;
            const totalPercent = ((i + filePercent) / activeItems.length) * 100;
            pb.style.width = totalPercent + '%';
            document.getElementById('my-st').innerHTML = `<span style="color:#0284c7;">送信中 (${i+1}/${activeItems.length})</span>`;
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) res();
            else rej(new Error('HTTP ' + xhr.status));
          };
          xhr.onerror = () => rej(new Error('Network Error'));
          xhr.send(fd);
        });
        await uploadPromise;
      } catch (err) {
        failedCount++;
        await saveFailedImage(fileObj, form.action || window.location.href, targetInput.name);
      }
    }

    pb.style.width = '100%';
    if (failedCount > 0) {
      alert(`通信環境の影響で ${failedCount} 件の送信に失敗しました。端末内に保護されました。`);
      window.location.href = window.location.href;
    } else {
      document.getElementById('my-st').innerHTML = '送信完了';
      setTimeout(() => { window.location.href = window.location.href; }, 400);
    }
  };

  updateQueueStatus();
}