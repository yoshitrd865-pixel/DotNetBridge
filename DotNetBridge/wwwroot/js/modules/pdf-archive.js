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
    const toast = showStatus('📄 PDF化処理を開始...', '#2980b9');

    try {
        await loadHtml2Pdf();
        toast.innerText = '📸 描画クローン領域を生成中...';

        // 1. 画面の元となるHTMLを取得（bodyまたはメイン要素）
        const targetElement = document.body;
        
        // 2. 撮影専用のクローンDOM要素を作成（画面外に固定配置）
        const clone = targetElement.cloneNode(true);

        // 3. クローン側から不要な要素（付箋ボタン、トースト、その他ボタン類）を物理除去
        const unwantedSelectors = [
            '#pdf-archive-toast',
            'button',
            'input[type="button"]',
            'input[type="submit"]',
            '.no-print'
        ];
        
        unwantedSelectors.forEach(selector => {
            clone.querySelectorAll(selector).forEach(el => el.remove());
        });

        // 画面上のテキスト「+ このお客様に付箋を貼る」が含まれる要素を検索して削除
        clone.querySelectorAll('*').forEach(el => {
            if (el.children.length === 0 && el.textContent.includes('付箋を貼る')) {
                el.parentElement ? el.parentElement.remove() : el.remove();
            }
        });

        // 4. クローン専用のラッパーコンテナを生成（固定幅 A4 210mm 相当）
        const container = document.createElement('div');
        container.style.cssText = `
            position: absolute;
            left: -9999px;
            top: 0;
            width: 800px;
            background: #ffffff;
            color: #000000;
            padding: 20px;
            box-sizing: border-box;
        `;
        container.appendChild(clone);
        document.body.appendChild(container);

        // フォントや要素の評価待ち
        await new Promise(resolve => setTimeout(resolve, 300));

        toast.innerText = '📸 高解像度キャプチャ実行中...';

        // 5. PDF生成オプション設定
        const opt = {
            margin:       [5, 5, 5, 5],
            filename:     `invoice_${customerCode}_${invoiceNo}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { 
                scale: 2,
                useCORS: true,
                logging: false,
                width: 800,
                windowWidth: 800
            },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // PDFのバイナリ生成
        const pdfBlob = await html2pdf().set(opt).from(container).output('blob');

        // 使用した一時クローン領域の破棄
        container.remove();

        toast.innerText = '☁️ Cloudflare R2へ保存中...';
        toast.style.background = '#e67e22';

        // 6. API送信
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