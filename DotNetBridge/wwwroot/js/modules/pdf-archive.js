// wwwroot/js/modules/pdf-archive.js

function showStatus(message, bgColor = 'rgba(0,0,0,0.85)') {
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

// 画面上で計算されたスタイルのうち、レンダリングに必要な主要プロパティをインライン化する
function inlineComputedStyles(sourceEl, targetEl) {
    const computed = window.getComputedStyle(sourceEl);
    if (computed.display === 'none') {
        // 角印などの例外を除き、本来非表示のものは非表示のまま
        if (!sourceEl.id?.includes('SealSales') && !sourceEl.className?.includes('sealSales')) {
            targetEl.style.display = 'none';
            return;
        }
    }

    // 主要なレイアウト用スタイルをコピー
    const propertiesToCopy = [
        'display', 'position', 'top', 'left', 'right', 'bottom',
        'width', 'height', 'margin', 'padding', 'border', 'border-collapse',
        'font-family', 'font-size', 'font-weight', 'color', 'background-color',
        'text-align', 'vertical-align', 'box-sizing', 'visibility'
    ];

    propertiesToCopy.forEach(prop => {
        targetEl.style[prop] = computed.getPropertyValue(prop);
    });

    // 子要素も再帰的にコピー
    const sourceChildren = Array.from(sourceEl.children);
    const targetChildren = Array.from(targetEl.children);
    sourceChildren.forEach((child, i) => {
        if (targetChildren[i]) {
            inlineComputedStyles(child, targetChildren[i]);
        }
    });
}

export async function initPdfArchive(invoiceNo, customerCode) {
    const toast = showStatus('📄 画面見た目を計算中...', '#2980b9');

    try {
        const pageElement = document.getElementById('divPage') || document.body;
        const clonedPage = pageElement.cloneNode(true);

        // 1. 不要な領収書枠・モジュールを削除
        const removeSelectors = ['#divSealReceipt', '#divReceiptSales', '#tfk-fusen-modal', '#tfk-remove-modal', '#pdf-archive-toast'];
        removeSelectors.forEach(s => clonedPage.querySelectorAll(s).forEach(el => el.remove()));

        // 2. 画面上の計算済みスタイルを全DOMへ直焼き込み
        inlineComputedStyles(pageElement, clonedPage);

        // 3. 角印（#divSealSales）を確定表示
        const sealSales = clonedPage.querySelector('#divSealSales') || clonedPage.querySelector('[id*="Seal"]');
        if (sealSales) {
            sealSales.style.display = 'block';
            sealSales.style.visibility = 'visible';
            sealSales.style.opacity = '1';
        }

        // 4. 画像のBase64埋め込み
        const originalImages = pageElement.querySelectorAll('img');
        const clonedImages = clonedPage.querySelectorAll('img');
        clonedImages.forEach((clonedImg, index) => {
            const origImg = originalImages[index];
            if (origImg && origImg.complete && origImg.naturalWidth !== 0) {
                clonedImg.src = getBase64Image(origImg);
            }
        });

        // 5. 完全自立型のHTMLを作成（外部CSS依存をゼロにする）
        const cleanHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
                    table { border-collapse: collapse; }
                </style>
            </head>
            <body>
                ${clonedPage.outerHTML}
            </body>
            </html>
        `;

        toast.innerText = '⚙️ 高精度PDF生成中...';
        toast.style.background = '#e67e22';

        const response = await fetch('/api/PdfArchive/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                html: cleanHtml,
                invoiceNo: invoiceNo,
                customerCode: customerCode
            })
        });

        if (response.ok) {
            toast.innerText = '✅ 完璧なPDFを保存しました (R2)';
            toast.style.background = '#27ae60';
            setTimeout(() => toast.remove(), 4000);
        } else {
            const errText = await response.text();
            throw new Error(`サーバーエラー: ${response.status} - ${errText}`);
        }

    } catch (err) {
        console.error('[PdfArchive Error]', err);
        toast.innerText = `⚠️ PDF保存失敗: ${err.message}`;
        toast.style.background = '#c0392b';
        setTimeout(() => toast.remove(), 7000);
    }
}