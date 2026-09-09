// wwwroot/js/modules/stripe-pay.js

export async function initStripePay() {
    // 既にQRエリアが存在すれば実行しない
    if (document.getElementById('tfk-paygate-qr-area')) return;

    // 「今回請求額」がDOMに現れていない場合は処理を行わない
    if (!document.body.innerText.includes('今回請求額')) return;

    // 元の window.print を退避し、一時的に無効化して元画面側のフライング起動を防ぐ
    const originalPrint = window.print;
    window.print = function() {};

    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'position:fixed; bottom:10px; left:10px; background:rgba(0,0,0,0.8); color:#fff; padding:8px 12px; border-radius:8px; font-size:12px; z-index:999999; font-weight:bold; box-shadow:0 2px 5px rgba(0,0,0,0.3);';
    statusDiv.innerText = '💳 HHC_Pay: 画面を監視中...';
    document.body.appendChild(statusDiv);

    // DOMから読み取って書き換えるため let のままで正解
    let amount = 0;
    let customerName = "お客様";
    let customerCode = "未指定";
    let invoiceNo = "未指定";
    let itemDescription = "浄化槽維持管理費";

    const allElements = document.querySelectorAll('th, td, div, span, b, p');

    // 1. 金額取得
    for (let el of allElements) {
        if (el.textContent.trim() === '今回請求額') {
            if (el.parentElement && el.parentElement.nextElementSibling) {
                const numStr = el.parentElement.nextElementSibling.textContent.replace(/[^0-9]/g, '');
                if (numStr) amount = parseInt(numStr, 10);
            }
            break;
        }
    }

    // 2. 宛名取得
    for (let el of allElements) {
        const text = el.textContent.trim();
        if (text.includes('様') && text.length < 30 && !text.includes('設置先')) {
            customerName = text;
            break;
        }
    }

    // 3. 顧客コード＆伝票番号の抽出
    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get("SetUpCode") && urlParams.get("SetUpCode") !== "") {
        customerCode = urlParams.get("SetUpCode");
    } else {
        allElements.forEach(el => {
            const text = el.textContent.trim();
            if (/お客様番号|顧客コード|請求先コード/.test(text)) {
                const codeMatch = text.match(/\d+/);
                if (codeMatch) customerCode = codeMatch[0];
            }
        });
    }

    if (urlParams.get("SalesSlipNumber") && urlParams.get("SalesSlipNumber") !== "") {
        invoiceNo = urlParams.get("SalesSlipNumber");
    } else if (urlParams.get("CheckNumber") && urlParams.get("CheckNumber") !== "") {
        invoiceNo = urlParams.get("CheckNumber");
    } else if (urlParams.get("CleanNumber") && urlParams.get("CleanNumber") !== "") {
        invoiceNo = urlParams.get("CleanNumber");
    } else {
        allElements.forEach(el => {
            const text = el.textContent.trim();
            if (/伝票番号|売上番号|請求番号/.test(text)) {
                const invMatch = text.match(/\d+/);
                if (invMatch) invoiceNo = invMatch[0];
            }
        });
    }

    // 4. 明細項目名の自動抽出
    const detailCells = document.querySelectorAll('td.detail, td[class*="detail"]');
    for (let cell of detailCells) {
        const text = cell.textContent.trim();
        if (
            text !== "" &&
            text !== "消費税" &&
            !text.includes('設置先') &&
            !/^\d{4}\/\d{2}\/\d{2}$/.test(text) &&
            !/^[0-9,]+$/.test(text)
        ) {
            itemDescription = text;
            break;
        }
    }

    if (amount <= 0) {
        statusDiv.innerText = '⚠️ エラー: 金額読み取り失敗';
        statusDiv.style.background = '#c0392b';
        window.print = originalPrint; // 元に戻す
        return;
    }

    statusDiv.innerText = `💳 HHC_Pay: QRコード生成中...`;

    const qrContainer = document.createElement('div');
    qrContainer.id = 'tfk-paygate-qr-area';
    qrContainer.style.cssText = 'margin-top: 30px; padding: 20px; border: 2px dashed #F39C12; text-align: center; background: #fff; border-radius: 8px; width: 95%; margin-left: auto; margin-right: auto; page-break-inside: avoid;';

    const tblSales = document.getElementById('tblSales') || document.querySelector('table');
    if (tblSales) {
        tblSales.parentNode.insertBefore(qrContainer, tblSales.nextSibling);
    } else {
        document.body.appendChild(qrContainer);
    }

    // ─── 変更点：リダイレクト用 API の URL を組み立てて QR コード化 ───
    const redirectUrl = `${window.location.origin}/api/StripePayment/redirect-checkout`
        + `?amount=${amount}`
        + `&customer_code=${encodeURIComponent(customerCode)}`
        + `&customer_name=${encodeURIComponent(customerName)}`
        + `&invoice_no=${encodeURIComponent(invoiceNo)}`
        + `&item_description=${encodeURIComponent(itemDescription)}`;

    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(redirectUrl)}`;

    qrContainer.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; gap:25px; padding:10px;">
            <div><img id="stripe-qr-image-element" src="${qrImageUrl}" style="width:130px; height:130px;"></div>
            <div style="text-align: left;">
                <h3 style="margin:0 0 6px 0; color:#E67E22; font-size:16px;">📱 スマホでお支払い（クレカ・PayPay・コンビニ）</h3>
                <p style="margin:0; font-size:13px; color:#333; line-height:1.5;">
                    QRコードをスマホのカメラで読み取ると、お支払い画面が開きます。<br>
                    <strong style="color:#c0392b; font-size:17px; display:inline-block; margin-top:4px;">ご請求金額: ${amount.toLocaleString()} 円</strong>
                </p>
            </div>
        </div>
    `;

    statusDiv.innerText = '✅ HHC_Pay: QR生成完了！';
    statusDiv.style.background = '#27ae60';

    // QRコード画像の読み込み完了を待って印刷ダイアログを開く
    const qrImgEl = document.getElementById('stripe-qr-image-element');
    if (qrImgEl && !qrImgEl.complete) {
        await new Promise((resolve) => {
            qrImgEl.onload = resolve;
            qrImgEl.onerror = resolve;
        });
    }

    statusDiv.remove();

    // 元の print 関数を復元して実行
    window.print = originalPrint;
    window.print();
}