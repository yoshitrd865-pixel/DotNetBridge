// wwwroot/js/modules/pdf-archive.js

// ★ 印刷プレビュー写り込み防止スタイルを自動注入（手作業でのCSS編集不要）
(function injectPrintStyle() {
    if (!document.getElementById('pdf-archive-print-style')) {
        const style = document.createElement('style');
        style.id = 'pdf-archive-print-style';
        style.textContent = '@media print { .no-print, #pdf-archive-toast { display: none !important; } }';
        document.head.appendChild(style);
    }
})();

/**
 * 画面左下に処理状況メッセージ（トーストUI）を表示する関数
 */
function showPdfArchiveStatus(message, bgColor = 'rgba(0,0,0,0.85)') {
    let toast = document.getElementById('pdf-archive-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'pdf-archive-toast';
        toast.className = 'no-print'; // 印刷除外用クラス
        toast.style.cssText = 'position:fixed; bottom:50px; left:10px; color:#fff; padding:10px 14px; border-radius:8px; font-size:12px; z-index:999999; font-weight:bold; box-shadow:0 4px 10px rgba(0,0,0,0.3); transition: all 0.3s ease; pointer-events:none;';
        document.body.appendChild(toast);
    }
    toast.style.background = bgColor;
    toast.innerText = message;
    return toast;
}

/**
 * <img> 要素の画像を Canvas 経由で Base64 DataURL に変換する関数
 */
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

/**
 * 請求書DOMから「設置先・日付・数字・消費税」を除外し、実際の請求項目のみを自動抽出
 */
export function extractItemDescription() {
    const items = [];
    const detailTds = document.querySelectorAll('td.detail.left.top, td.detail.left, td.detail');

    detailTds.forEach(td => {
        let text = td.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text) return;

        if (text.includes('設置先：') || text.includes('設置先:')) return;
        if (['消費税', '地方消費税', '小計', '合計', '内税合計', '外税合計', '明細項目'].includes(text)) return;
        if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) return;
        if (/^[\d,]+$/.test(text)) return;

        if (!items.includes(text)) {
            items.push(text);
        }
    });

    return items.length > 0 ? items.join(' / ') : '';
}

let capturedHtmlString = null;

/**
 * 画面が完成した瞬間にDOMのスナップショット（クローン）を作成・整形する関数
 */
export function captureCurrentPageDom() {
    try {
        const docClone = document.documentElement.cloneNode(true);

        // 本番DOMの全フォーム値をクローン側へ同期（ClaimCodeの消失防止）
        const origInputs = document.querySelectorAll('input, select, textarea');
        const clonedInputs = docClone.querySelectorAll('input, select, textarea');
        origInputs.forEach((orig, idx) => {
            if (clonedInputs[idx]) {
                if (orig.tagName === 'SELECT') {
                    const selectedOpt = orig.options[orig.selectedIndex];
                    if (selectedOpt) {
                        const clonedOpt = clonedInputs[idx].options[orig.selectedIndex];
                        if (clonedOpt) clonedOpt.setAttribute('selected', 'selected');
                    }
                } else if (orig.type === 'checkbox' || orig.type === 'radio') {
                    if (orig.checked) clonedInputs[idx].setAttribute('checked', 'checked');
                    else clonedInputs[idx].removeAttribute('checked');
                } else {
                    clonedInputs[idx].setAttribute('value', orig.value || '');
                }
            }
        });

        // 不要なscriptタグを除去
        docClone.querySelectorAll('script').forEach(s => s.remove());

        // クローン側からUI表示専用要素を除去
        const removeSelectors = [
            '#tfk-fusen-modal', 
            '#tfk-remove-modal', 
            '#tfk-my-fusen-modal',
            '#pdf-archive-toast',
            '.no-print',
            '#tfk-my-fusen-float-btn'
        ];
        removeSelectors.forEach(selector => {
            docClone.querySelectorAll(selector).forEach(el => el.remove());
        });

        // HHC_Payトースト除去
        docClone.querySelectorAll('div').forEach(el => {
            if (el.innerText && (el.innerText.includes('HHC_Pay: QR生成完了') || el.innerText.includes('HHC_Pay: 画面を監視中'))) {
                if (!el.querySelector('input')) {
                    el.remove();
                }
            }
        });

        // 角印表示設定
        const sealSales = docClone.querySelector('#divSealSales') || docClone.querySelector('[id*="SealSales"]');
        if (sealSales) {
            sealSales.style.display = 'block';
            sealSales.style.visibility = 'visible';
            sealSales.style.opacity = '1';
        }

        // 画像のBase64化
        const originalImages = document.querySelectorAll('img');
        const clonedImages = docClone.querySelectorAll('img');
        clonedImages.forEach((clonedImg, index) => {
            const origImg = originalImages[index];
            if (origImg && origImg.complete && origImg.naturalWidth !== 0) {
                clonedImg.src = getBase64Image(origImg);
            }
        });

        // Absolute URL補正
        const base = document.createElement('base');
        base.href = window.location.origin + '/';
        docClone.querySelector('head').insertBefore(base, docClone.querySelector('head').firstChild);

        capturedHtmlString = docClone.outerHTML;
    } catch (e) {
        console.error('[PdfArchive Capture Error]', e);
    }
}

/**
 * バックグラウンドでC# API (/api/PdfArchive/upload) へキャプチャHTMLを送信
 */
export async function archivePdfInBackground(params = {}) {
    if (typeof params === 'string') {
        params = {
            invoiceNo: arguments[0],
            customerCode: arguments[1]
        };
    }

    if (!capturedHtmlString) {
        captureCurrentPageDom();
    }

    const operatorName = params.issuedBy 
        || localStorage.getItem('hhc_operator_name') 
        || "未指定";

    const itemDesc = params.itemDescription || extractItemDescription();

    const toast = showPdfArchiveStatus('⚡ R2へ自動保存中...', '#2980b9');

    fetch('/api/PdfArchive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            html: capturedHtmlString,
            invoiceNo: params.invoiceNo || '',
            customerCode: params.customerCode || '',
            customerName: params.customerName || '',
            itemDescription: itemDesc,
            amount: params.amount || 0,
            issuedBy: operatorName
        })
    }).then(async res => {
        if (res.ok) {
            toast.innerText = '✅ R2への自動保存が完了しました';
            toast.style.background = '#27ae60';
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
        } else {
            throw new Error(await res.text());
        }
    }).catch(err => {
        console.error('[PdfArchive Error]', err);
        toast.innerText = `⚠️ R2保存失敗: ${err.message}`;
        toast.style.background = '#c0392b';
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 7000);
    });
}

/**
 * 印刷イベント (beforeprint) にフックして自動保存を起動
 */
export function setupAutoArchiveOnPrint(params) {
    window.addEventListener('beforeprint', () => {
        archivePdfInBackground(params);
    });
}