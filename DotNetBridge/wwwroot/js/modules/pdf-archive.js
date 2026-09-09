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
    const toast = showStatus('📄 画面データを送信中...', '#2980b9');

    try {
        // 1. 今見えている完成画面（QRコード追加済み）のHTMLをそのままクローン
        const docClone = document.documentElement.cloneNode(true);

        // 2. 印刷補正用スタイルをheadの末尾に追加（角印を表示し、余計なトースト等を隠すだけ）
        const style = document.createElement('style');
        style.textContent = `
            /* 角印・社印を強制表示 */
            #divSealSales, .sealSales, [id*="SealSales"] {
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            /* 不要なトーストやモーダルを隠す */
            #pdf-archive-toast, #tfk-fusen-modal, #tfk-remove-modal {
                display: none !important;
            }
        `;
        docClone.querySelector('head').appendChild(style);

        // 3. Absolute URL補正（Baseタグを追加して相対パスのCSS/画像参照を本物ドメインに向けさせる）
        const base = document.createElement('base');
        base.href = window.location.origin + '/';
        docClone.querySelector('head').insertBefore(base, docClone.querySelector('head').firstChild);

        toast.innerText = '⚙️ サーバー側でPDF生成中...';
        toast.style.background = '#e67e22';

        const response = await fetch('/api/PdfArchive/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                html: docClone.outerHTML,
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
}// wwwroot/js/modules/pdf-archive.js

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

export async function archivePdfInBackground(invoiceNo, customerCode) {
    const toast = showStatus('⚡ R2へ自動保存中...', '#2980b9');

    try {
        // 1. 今見えている完成画面（QRコード追加済み）のDOMをクローン
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

        // 画面左下の「HHC_Pay」トースト通知バッジのみ削除
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

        // 4. 角印画像を含む全画像をBase64化してリンク切れを防止
        const originalImages = document.querySelectorAll('img');
        const clonedImages = docClone.querySelectorAll('img');
        clonedImages.forEach((clonedImg, index) => {
            const origImg = originalImages[index];
            if (origImg && origImg.complete && origImg.naturalWidth !== 0) {
                clonedImg.src = getBase64Image(origImg);
            }
        });

        // 5. Absolute URL補正（Baseタグ追加）
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

// 印刷イベント連動（印刷ボタン押下またはwindow.print呼び出しで自動保存）
export function setupAutoArchiveOnPrint(invoiceNo, customerCode) {
    window.addEventListener('beforeprint', () => {
        archivePdfInBackground(invoiceNo, customerCode);
    });
}