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

export async function initPdfArchive(invoiceNo, customerCode) {
    const toast = showStatus('📄 サーバーへ送信中...', '#2980b9');

    try {
        // 1. #divPage をクローンして操作（画面上の表示には影響を与えない）
        const pageElement = document.getElementById('divPage') || document.body;
        const clonedPage = pageElement.cloneNode(true);

        // 2. 角印（divSealSales や 印影画像）が含まれる要素を強制表示
        const sealElements = clonedPage.querySelectorAll('#divSealSales, #divSealReceipt, .sealSales, [id*="Seal"]');
        sealElements.forEach(el => {
            el.style.display = 'block';
            el.style.visibility = 'visible';
        });

        // 3. 相対パスの画像URL（/images/印鑑.pngなど）を、Puppeteerが解釈できるように絶対URL(https://...)へ変換
        const images = clonedPage.querySelectorAll('img');
        images.forEach(img => {
            if (img.src) {
                img.src = img.src; // JSのプロパティ参照で絶対URLに変換される
            }
        });

        // 4. headとスタイルを維持してきれいなHTMLを構築
        const headHtml = document.head.innerHTML;
        const cleanHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <base href="${window.location.origin}">
                ${headHtml}
                <style>
                    /* 印刷・PDF出力時に角印を強制表示させる追加CSS */
                    #divSealSales, .sealSales, [id*="Seal"] {
                        display: block !important;
                        visibility: visible !important;
                    }
                    /* 余計な下部のモーダル等を隠す */
                    #tfk-fusen-modal, #tfk-remove-modal, #pdf-archive-toast {
                        display: none !important;
                    }
                </style>
            </head>
            <body style="background: #fff; margin: 0; padding: 0;">
                ${clonedPage.outerHTML}
            </body>
            </html>
        `;

        toast.innerText = '⚙️ 高画質PDF生成中...';
        toast.style.background = '#e67e22';

        const response = await fetch('/api/PdfArchive/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                html: cleanHtml,
                invoiceNo: invoiceNo,
                customerCode: customerCode
            })
        });

        if (response.ok) {
            toast.innerText = '✅ PDF保存完了 (R2)';
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