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

// 画像をCanvas経由でBase64データURLに変換する関数
function getBase64Image(img) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png');
    } catch (e) {
        return img.src; // CORS等で変換失敗時はフォールバック
    }
}

export async function initPdfArchive(invoiceNo, customerCode) {
    const toast = showStatus('📄 画面データを最適化中...', '#2980b9');

    try {
        // 1. #divPage をクローン
        const pageElement = document.getElementById('divPage') || document.body;
        const clonedPage = pageElement.cloneNode(true);

        // 2. 不要な「領収書エリア」やモーダル、UIパーツを完全除去
        const removeSelectors = [
            '#divSealReceipt', 
            '#divReceiptSales', 
            '#divReportSales', 
            '#divReportReceipt', 
            '#tfk-fusen-modal', 
            '#tfk-remove-modal', 
            '#pdf-archive-toast'
        ];
        removeSelectors.forEach(selector => {
            clonedPage.querySelectorAll(selector).forEach(el => el.remove());
        });

        // 3. 角印（divSealSales）を強制表示
        const sealSales = clonedPage.querySelector('#divSealSales');
        if (sealSales) {
            sealSales.style.display = 'block';
            sealSales.style.visibility = 'visible';
        }

        // 4. 画面上の全画像（角印含む）をBase64に置換して絶対リンク切れを防止
        const originalImages = pageElement.querySelectorAll('img');
        const clonedImages = clonedPage.querySelectorAll('img');
        clonedImages.forEach((clonedImg, index) => {
            const origImg = originalImages[index];
            if (origImg && origImg.complete && origImg.naturalWidth !== 0) {
                clonedImg.src = getBase64Image(origImg);
            } else if (clonedImg.src) {
                clonedImg.src = new URL(clonedImg.getAttribute('src'), window.location.href).href;
            }
        });

        // 5. 完全独立したHTMLを組み立て
        const headHtml = document.head.innerHTML;
        const cleanHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <base href="${window.location.origin}/">
                ${headHtml}
                <style>
                    body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
                    #divSealSales { display: block !important; visibility: visible !important; }
                    #divSealReceipt, #divReceiptSales, #divReportSales { display: none !important; }
                </style>
            </head>
            <body>
                ${clonedPage.outerHTML}
            </body>
            </html>
        `;

        toast.innerText = '⚙️ サーバー側でPDF生成中...';
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