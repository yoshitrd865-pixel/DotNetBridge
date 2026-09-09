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
}