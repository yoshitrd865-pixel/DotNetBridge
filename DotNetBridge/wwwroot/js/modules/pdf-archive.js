// wwwroot/js/modules/pdf-archive.js

export async function initPdfArchive(invoiceNo, customerCode) {
    // 既にキャプチャ済み、または「今回請求額」がない画面では実行しない
    if (window.__pdfArchived) return;
    if (!document.body.innerText.includes('今回請求額')) return;

    window.__pdfArchived = true; // 二重送信防止フラグ

    try {
        // html2pdf ライブラリがロードされているか確認
        if (typeof html2pdf === 'undefined') {
            await loadHtml2PdfScript();
        }

        // キャプチャ対象（テーブルまたは全体）
        const element = document.getElementById('tblSales') || document.body;

        const opt = {
            margin:       5,
            filename:     'invoice.pdf',
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // 画面をPDF化（Blob取得）
        const pdfBlob = await html2pdf().set(opt).from(element).output('blob');

        // C# API へ送信
        const formData = new FormData();
        formData.append('file', pdfBlob, 'invoice.pdf');
        formData.append('invoiceNo', invoiceNo || '');
        formData.append('customerCode', customerCode || '');

        const uploadUrl = `${window.location.origin}/api/PdfArchive/upload`;

        fetch(uploadUrl, {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => console.log('📦 [R2 Archive] 保存成功:', data))
        .catch(err => console.error('⚠️ [R2 Archive] 送信失敗:', err));

    } catch (e) {
        console.error('⚠️ [R2 Archive] キャプチャ失敗:', e);
    }
}

// html2pdf CDN を動的に読み込む補助関数
function loadHtml2PdfScript() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}