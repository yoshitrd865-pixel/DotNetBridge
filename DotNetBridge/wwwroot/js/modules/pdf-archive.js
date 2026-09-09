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
    const toast = showStatus('📄 PDF作成準備中...', '#2980b9');

    try {
        await loadHtml2Pdf();
        toast.innerText = '📸 画面レイアウト調整中...';

        // 請求書のメインコンテナを取得（見つからない場合は body ）
        const element = document.querySelector('.invoice-container') || document.querySelector('#invoice-print-area') || document.body;

        // 1. 撮影用の一時スタイルを適用（A4幅に固定して崩れを防ぐ）
        const originalStyle = element.getAttribute('style') || '';
        element.style.width = '794px'; // A4標準幅(px換算)
        element.style.padding = '20px';
        element.style.background = '#ffffff';

        // 2. 不要なUIボタン（「付箋を貼る」など）を一時的に隠すCSSを注入
        const styleTag = document.createElement('style');
        styleTag.innerHTML = `
            #pdf-archive-toast, .no-print, button, input[type="button"] { display: none !important; }
        `;
        document.head.appendChild(styleTag);

        // 3. レンダリング完了までほんの少し待機（フォント・画像崩れ防止）
        await new Promise(resolve => setTimeout(resolve, 500));

        toast.innerText = '📸 キャプチャ実行中...';

        const opt = {
            margin:       [10, 10, 10, 10], // 上右下左の余白(mm)
            filename:     `invoice_${customerCode}_${invoiceNo}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { 
                scale: 2,           // 高画質化
                useCORS: true, 
                logging: false,
                scrollX: 0,
                scrollY: 0,
                windowWidth: 1024   // レイアウト計算用ウィンドウ幅
            },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // 4. PDF生成
        const pdfBlob = await html2pdf().set(opt).from(element).output('blob');

        // 5. 元のスタイルと隠し設定を復元
        element.setAttribute('style', originalStyle);
        styleTag.remove();

        toast.innerText = '☁️ Cloudflare R2へ保存中...';
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
            toast.innerText = '✅ PDF綺麗に保存完了 (R2)';
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