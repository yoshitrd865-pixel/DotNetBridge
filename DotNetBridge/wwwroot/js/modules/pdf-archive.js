// wwwroot/js/modules/pdf-archive.js

/**
 * 画面左下に処理状況メッセージ（トーストUI）を表示する関数
 */
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

// 完成した画面HTMLを一時保持するモジュール変数
let capturedHtmlString = null;

/**
 * 画面が完成した瞬間にDOMのスナップショット（クローン）を作成・整形する関数
 */
export function captureCurrentPageDom() {
    try {
        // 現在のDOMツリー全体のディープクローンを作成
        const docClone = document.documentElement.cloneNode(true);

        // 1. 不要なscriptタグを除去してPuppeteerでの再実行エラーを防止
        docClone.querySelectorAll('script').forEach(s => s.remove());

        // 2. モーダル・トーストなど純粋な拡張UI要素のみをピンポイント除去
        // （画面上の業務データテーブル群には一切触れない）
        const removeSelectors = [
            '#tfk-fusen-modal', 
            '#tfk-remove-modal', 
            '#tfk-my-fusen-modal',
            '#pdf-archive-toast',
            '#tfk-my-fusen-float-btn'
        ];
        removeSelectors.forEach(selector => {
            docClone.querySelectorAll(selector).forEach(el => el.remove());
        });

        // 3. HHC_Payの動的ステータストースト要素の除去
        docClone.querySelectorAll('div').forEach(el => {
            if (el.innerText && (el.innerText.includes('HHC_Pay: QR生成完了') || el.innerText.includes('HHC_Pay: 画面を監視中'))) {
                el.remove();
            }
        });

        // 4. 請求書側の角印（社印）の強制表示設定
        const sealSales = docClone.querySelector('#divSealSales') || docClone.querySelector('[id*="SealSales"]');
        if (sealSales) {
            sealSales.style.display = 'block';
            sealSales.style.visibility = 'visible';
            sealSales.style.opacity = '1';
        }

        // 5. 画像のBase64埋め込み化（QRコードやロゴ画像の読み込み漏れを防止）
        const originalImages = document.querySelectorAll('img');
        const clonedImages = docClone.querySelectorAll('img');
        clonedImages.forEach((clonedImg, index) => {
            const origImg = originalImages[index];
            if (origImg && origImg.complete && origImg.naturalWidth !== 0) {
                clonedImg.src = getBase64Image(origImg);
            }
        });

        // 6. 相対パス画像の崩れ防止用 Absolute URL 補正
        const base = document.createElement('base');
        base.href = window.location.origin + '/';
        docClone.querySelector('head').insertBefore(base, docClone.querySelector('head').firstChild);

        // クレンジング済みHTMLを文字列としてキャプチャ保持
        capturedHtmlString = docClone.outerHTML;
    } catch (e) {
        console.error('[PdfArchive Capture Error]', e);
    }
}

/**
 * バックグラウンドでC# API (/api/PdfArchive/upload) へキャプチャHTMLを送信しR2保存を実行する関数
 */
export async function archivePdfInBackground(invoiceNo, customerCode) {
    if (!capturedHtmlString) {
        captureCurrentPageDom();
    }

    const toast = showPdfArchiveStatus('⚡ R2へ自動保存中...', '#2980b9');

    fetch('/api/PdfArchive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            html: capturedHtmlString,
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
}

/**
 * 印刷イベント (beforeprint) にフックして自動保存を起動するセットアップ関数
 */
export function setupAutoArchiveOnPrint(invoiceNo, customerCode) {
    window.addEventListener('beforeprint', () => {
        archivePdfInBackground(invoiceNo, customerCode);
    });
}