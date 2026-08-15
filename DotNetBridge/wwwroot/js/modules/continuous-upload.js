// wwwroot/js/modules/continuous-upload.js

let imageQueue = [];
let wakeLock = null;
let compressingCount = 0;

// ⚙️ Web Worker & OffscreenCanvas ロジック
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
      self.postMessage({ success: true, blob: blob });
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
  } catch (e) {
    wakeLock = null;
  }
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
        const compressedFile = new File(
          [e.data.blob],
          file.name.replace(/\.[^/.]+$/, "") + ".jpg",
          { type: 'image/jpeg' }
        );
        resolve(compressedFile);
      } else {
        console.error("[ContinuousUpload] Worker圧縮エラー:", e.data.error);
        reject(new Error(e.data.error));
      }
      worker.terminate();
    };

    worker.onerror = (err) => {
      console.error("[ContinuousUpload] Worker致命的エラー:", err);
      reject(err);
      worker.terminate();
    };

    worker.postMessage({ file: file, maxSide: 1280 });
  });
}

function addPlaceholder(index) {
  const container = document.getElementById('my-previews');
  if (!container) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'img-wrapper-' + index;
  wrapper.style.cssText = 'position:relative; width:120px; height:145px; flex-shrink:0; display:flex; flex-direction:column; align-items:center;';

  const img = document.createElement('div');
  img.id = 'img-view-' + index;
  img.style.cssText = 'width:110px; height:110px; border-radius:8px; border:2px dashed #ccc; background:#f9f9f9; display:flex; align-items:center; justify-content:center; font-size:10px; color:#999;';
  img.innerText = '⏳ 圧縮中...';

  const sizeLabel = document.createElement('div');
  sizeLabel.id = 'size-label-' + index;
  sizeLabel.innerText = 'WAIT...';
  sizeLabel.style.cssText = 'font-size:11px; color:#999; margin-top:4px;';

  const deleteBtn = document.createElement('div');
  deleteBtn.innerHTML = '×';
  deleteBtn.style.cssText = 'position:absolute; top:2px; right:6px; background:rgba(0,0,0,0.5); color:#fff; width:26px; height:26px; border-radius:50%; text-align:center; line-height:22px; cursor:pointer; z-index:10;';
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
    imgView.style.borderStyle = 'solid';
    imgView.style.borderColor = '#F39C12';

    sizeLabel.innerText = formatBytes(compressedFile.size);
    sizeLabel.style.color = '#27AE60';
    sizeLabel.style.fontWeight = 'bold';
    
    const panel = document.getElementById('my-panel');
    if (panel) panel.style.transform = 'translateX(-50%) translateZ(0)';
  });
}

function updateQueueStatus() {
  const activeQueue = imageQueue.filter(i => i !== null);
  const readyFiles = activeQueue.filter(i => i.status === 'ready');
  const isCompressing = activeQueue.some(i => i.status === 'compressing');

  const st = document.getElementById('my-st');
  const upBtn = document.getElementById('my-up');
  const previewsContainer = document.getElementById('my-previews');

  if (activeQueue.length > 0) {
    previewsContainer.style.display = 'flex';
  } else {
    previewsContainer.style.display = 'none';
  }

  if (st) {
    if (isCompressing) {
      st.innerHTML = `⏳ <span style="color:#7f8c8d;">画像を処理中です...</span>`;
    } else {
      st.innerHTML = `📦 <span style="font-size:22px;color:#27AE60;font-weight:bold;">${readyFiles.length}</span> 枚 送信可能`;
    }
  }

  if (upBtn) {
    if (isCompressing) {
      upBtn.disabled = true;
      upBtn.style.background = '#bdc3c7';
      upBtn.innerText = '⏳ 準備中...';
    } else if (readyFiles.length > 0) {
      upBtn.disabled = false;
      upBtn.style.background = '#27AE60';
      upBtn.innerText = `📤 ${readyFiles.length}枚 まとめて送信`;
    } else {
      upBtn.disabled = true;
      upBtn.style.background = '#bdc3c7';
      upBtn.innerText = '📤 まとめて送信';
    }
  }
}

// 🚀 モジュール外部へ公開するメイン関数
export function initContinuousUpload() {
  if (window.myAppClosed) return;

  const targetInput = document.querySelector('input[type="file"]:not(#my-input)');
  if (!targetInput || document.getElementById('my-panel')) return;

  targetInput.style.display = 'none';
  const form = targetInput.closest('form');
  const originalSubmit = form ? form.querySelector('input[type="submit"], button[type="submit"]') : null;
  if (originalSubmit) originalSubmit.style.display = 'none';

  const panel = document.createElement('div');
  panel.id = 'my-panel';
  panel.style.cssText = 'position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:#fff; padding:15px; border-radius:15px; box-shadow:0 8px 30px rgba(0,0,0,0.3); z-index:100000; width:95%; border:3px solid #F39C12; text-align:center; box-sizing:border-box;';
  panel.innerHTML = `
    <div id="my-st" style="font-weight:bold;margin-bottom:10px;font-size:18px;padding-right:24px;">📸 写真を撮影してください</div>
    <div id="my-previews" style="display:none; gap:12px; overflow-x:auto; margin-bottom:12px; padding-bottom:10px; scroll-behavior: smooth;"></div>
    <div id="my-progress-container" style="display:none; width:100%; height:14px; background:#ecf0f1; border-radius:7px; margin-bottom:15px; overflow:hidden; border:1px solid #ccc;">
      <div id="my-progress-bar" style="width:0%; height:100%; background:linear-gradient(90deg, #F39C12, #2ecc71); transition: width 0.3s ease-out;"></div>
    </div>
    <button id="my-add" style="width:100%;padding:18px;background:#F39C12;color:#fff;border:none;border-radius:10px;font-weight:bold;font-size:20px;margin-bottom:10px;box-shadow: 0 4px 6px rgba(0,0,0,0.1);">📷 写真を撮影 (追加)</button>
    <button id="my-up" style="width:100%;padding:15px;background:#bdc3c7;color:#fff;border:none;border-radius:10px;font-weight:bold;font-size:18px;" disabled>📤 まとめて送信</button>
    <input id="my-input" type="file" accept="image/*" capture="environment" style="display:none;">
  `;
  document.body.appendChild(panel);

  const closePanelBtn = document.createElement('div');
  closePanelBtn.id = 'my-panel-close';
  closePanelBtn.innerHTML = '×';
  closePanelBtn.style.cssText = 'position:absolute; top:8px; right:10px; background:#7f8c8d; color:#fff; width:26px; height:26px; border-radius:50%; text-align:center; line-height:22px; cursor:pointer; font-weight:bold; font-size:18px; z-index:100001; box-shadow:0 2px 5px rgba(0,0,0,0.2);';

  closePanelBtn.onclick = (e) => {
    e.preventDefault();
    if (confirm('写真をすべてクリアして、この撮影パネルを閉じますか？\n（元の標準アップロードボタンに戻ります）')) {
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
            document.getElementById('my-st').innerHTML = `⏳ 送信中 (${i+1}/${activeItems.length})`;
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) res();
            else rej();
          };
          xhr.onerror = () => rej();
          xhr.send(fd);
        });
        await uploadPromise;
      } catch (err) {
        alert("送信に失敗しました。電波の良い環境で再試行してください。");
        location.reload();
        return;
      }
    }
    pb.style.width = '100%';
    document.getElementById('my-st').innerHTML = '🎉 全ての送信が完了！';
    setTimeout(() => location.reload(), 800);
  };
}