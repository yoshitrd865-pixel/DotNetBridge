// wwwroot/js/modules/pdf-archive.js

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
    const toast = showStatus('📄 PDF作成中...', '#2980b9');

    try {
        await loadHtml2Pdf();
        toast.innerText = '📸 請求書領域(#divPage)を印刷モードでキャプチャ中...';

        // 1. デベロッパーツールで特定した「請求書本体」の要素をピンポイント指定
        const targetElement = document.getElementById('divPage') || document.body;

        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 300));

        // 2. A4サイズ指定と要素キャプチャ設定（mediaType: 'print' を追加）
        const opt = {
            margin:       [0, 0, 0, 0], // ピンポイント撮影のため余白ゼロ
            filename:     `invoice_${customerCode}_${invoiceNo}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { 
                scale: 2,               // 高画質化
                useCORS: true, 
                logging: false,
                scrollX: 0,
                scrollY: 0,
                windowWidth: 1024,      // 幅崩れ防止
                mediaType: 'print'      // ★ 印刷用レイアウト（@media print）でレンダリング
            },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        const pdfBlob = await html2pdf().set(opt).from(targetElement).output('blob');

        toast.innerText = '☁️ Cloudflare R2へ送信中...';
        toast.style.background = '#e67e22';

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