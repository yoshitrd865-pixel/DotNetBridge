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
    const toast = showStatus('📄 サーバーへHTML送信中...', '#2980b9');

    try {
        // 現在の画面HTMLを丸ごと取得
        const fullHtml = document.documentElement.outerHTML;

        toast.innerText = '⚙️ サーバー側で最高画質PDF生成中...';
        toast.style.background = '#e67e22';

        const response = await fetch('/api/PdfArchive/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                html: fullHtml,
                invoiceNo: invoiceNo,
                customerCode: customerCode
            })
        });

        if (response.ok) {
            toast.innerText = '✅ PDF完璧保存完了 (R2)';
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