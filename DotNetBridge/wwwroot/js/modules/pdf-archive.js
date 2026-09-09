// wwwroot/js/modules/pdf-archive.js

function showPdfArchiveStatus(message, bgColor = 'rgba(0,0,0,0.85)') {
    let toast = document.getElementById('pdf-archive-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'pdf-archive-toast';
        toast.style.cssText = 'position:fixed; bottom:50px; left:10px; color:#fff; padding:10px 14px; border-radius:8px; font-size:12px; z-index:999999; font-weight:bold; box-shadow:0 4px 10px rgba(0,0,0,0.3); transition: all 0.3s ease;';
        document.body.appendChild(toast);
    }
    toast.style.background = bgColor;
    toast.innerText = message;
    return toast;
}

function getBase64Image(img) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png');
    } catch (e) {
        return img.src;
    }
}

// 完成した画面HTMLを保持する変数
let capturedHtmlString = null;

// 画面が完成した瞬間にDOMスナップショットを取得する関数
export function captureCurrentPageDom() {
    try {
        const docClone = document.documentElement.cloneNode(true);

        // 不要なscriptタグを除去してPuppeteerでの再読み込みエラーを防止
        docClone.querySelectorAll('script').forEach(s => s.remove());

        // 不要な「領収書エリア」「モーダル」「トースト」を削除（付箋は保持）
        const removeSelectors = [
            '#divSealReceipt', 
            '#divReceiptSales', 
            '#divReportSales',
            '#tfk-fusen-modal', 
            '#tfk-remove-modal', 
            '#pdf-archive-toast'
        ];
        removeSelectors.forEach(selector => {
            docClone.querySelectorAll(selector).forEach(el => el.remove());
        });

        docClone.querySelectorAll('div').forEach(el => {
            if (el.innerText && el.innerText.includes('HHC_Pay: QR生成完了')) {
                el.remove();
            }
        });

        // 角印の強制表示
        const sealSales = docClone.querySelector('#divSealSales') || docClone.querySelector('[id*="SealSales"]');
        if (sealSales) {
            sealSales.style.display = 'block';
            sealSales.style.visibility = 'visible';
            sealSales.style.opacity = '1';
        }

        // 画像のBase64化（リンク切れ防止）
        const originalImages = document.querySelectorAll('img');
        const clonedImages = docClone.querySelectorAll('img');
        clonedImages.forEach((clonedImg, index) => {
            const origImg = originalImages[index];
            if (origImg && origImg.complete && origImg.naturalWidth !== 0) {
                clonedImg.src = getBase64Image(origImg);
            }
        });

        // Absolute URL補正
        const base = document.createElement('base');
        base.href = window.location.origin + '/';
        docClone.querySelector('head').insertBefore(base, docClone.querySelector('head').firstChild);

        capturedHtmlString = docClone.outerHTML;
    } catch (e) {
        console.error('[PdfArchive Capture Error]', e);
    }
}

export async function archivePdfInBackground(invoiceNo, customerCode) {
    if (!capturedHtmlString) {
        captureCurrentPageDom();
    }

    const toast = showPdfArchiveStatus('⚡ R2へ自動保存中...', '#2980b9');

    fetch('/api/PdfArchive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            html: capturedHtmlString,
            invoiceNo: invoiceNo,
            customerCode: customerCode
        })
    }).then(async res => {
        if (res.ok) {
            toast.innerText = '✅ R2への自動保存が完了しました';
            toast.style.background = '#27ae60';
            setTimeout(() => toast.remove(), 4000);
        } else {
            throw new Error(await res.text());
        }
    }).catch(err => {
        console.error('[PdfArchive Error]', err);
        toast.innerText = `⚠️ R2保存失敗: ${err.message}`;
        toast.style.background = '#c0392b';
        setTimeout(() => toast.remove(), 7000);
    });
}

export function setupAutoArchiveOnPrint(invoiceNo, customerCode) {
    window.addEventListener('beforeprint', () => {
        archivePdfInBackground(invoiceNo, customerCode);
    });
}