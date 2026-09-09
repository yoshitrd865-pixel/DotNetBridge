// wwwroot/js/modules/pdf-archive.js

// html2pdf.js ライブラリを動的に読み込む補助関数
function loadHtml2Pdf() {
    return new Promise((resolve, reject) => {
        if (window.html2pdf) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('html2pdf.js の読み込みに失敗しました'));
        document.head.appendChild(script);
    });
}

// 画面左下に状態を表示するトースト作成
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
    const toast = showStatus('📄 PDF作成準備中...', '#2980b9');

    try {
        // 1. ライブラリの動的ロード
        await loadHtml2Pdf();
        toast.innerText = '📸 画面をPDFキャプチャ中...';

        // 2. PDF生成オプション
        const element = document.body;
        const opt = {
            margin:       5,
            filename:     `invoice_${customerCode}_${invoiceNo}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, logging: false },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // 3. Blob（バイナリデータ）としてPDFを生成
        const pdfBlob = await html2pdf().set(opt).from(element).output('blob');

        toast.innerText = '☁️ Cloudflare R2へ送信中...';
        toast.style.background = '#e67e22';

        // 4. サーバーAPIへ送信
        const formData = new FormData();
        formData.append('file', pdfBlob, `invoice_${customerCode}_${invoiceNo}.pdf`);
        formData.append('invoiceNo', invoiceNo);
        formData.append('customerCode', customerCode);

        const response = await fetch('/api/PdfArchive/upload', {
            method: 'POST',
            body: formData
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