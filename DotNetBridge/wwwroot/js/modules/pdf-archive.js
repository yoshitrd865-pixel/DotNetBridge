// wwwroot/js/modules/pdf-archive.js

// トースト通知表示関数
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

// 角印などの画像を確実にPDFに乗せるためのBase64変換関数
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

// バックグラウンドでPDFを保存するメイン関数
export async function archivePdfInBackground(invoiceNo, customerCode) {
    const toast = showPdfArchiveStatus('⚡ R2へ自動保存中...', '#2980b9');

    try {
        // 1. 完成画面のDOMをクローン
        const docClone = document.documentElement.cloneNode(true);

        // 2. 不要な「領収書エリア」と「トースト/モーダル」のみを物理削除（付箋ボタン等は維持）
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

        // 画面左下のトースト通知バッジのみ削除
        docClone.querySelectorAll('div').forEach(el => {
            if (el.innerText && el.innerText.includes('HHC_Pay: QR生成完了')) {
                el.remove();
            }
        });

        // 3. 角印（#divSealSales）を強制表示化
        const sealSales = docClone.querySelector('#divSealSales') || docClone.querySelector('[id*="SealSales"]');
        if (sealSales) {
            sealSales.style.display = 'block';
            sealSales.style.visibility = 'visible';
            sealSales.style.opacity = '1';
        }

        // 4. 画像をBase64化してリンク切れを防止
        const originalImages = document.querySelectorAll('img');
        const clonedImages = docClone.querySelectorAll('img');
        clonedImages.forEach((clonedImg, index) => {
            const origImg = originalImages[index];
            if (origImg && origImg.complete && origImg.naturalWidth !== 0) {
                clonedImg.src = getBase64Image(origImg);
            }
        });

        // 5. Absolute URL補正
        const base = document.createElement('base');
        base.href = window.location.origin + '/';
        docClone.querySelector('head').insertBefore(base, docClone.querySelector('head').firstChild);

        // 6. バックグラウンドでサーバーへ送信
        fetch('/api/PdfArchive/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                html: docClone.outerHTML,
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

    } catch (err) {
        console.error('[PdfArchive Prep Error]', err);
    }
}

// 印刷イベント連動（印刷実行で自動起動）
export function setupAutoArchiveOnPrint(invoiceNo, customerCode) {
    window.addEventListener('beforeprint', () => {
        archivePdfInBackground(invoiceNo, customerCode);
    });
}