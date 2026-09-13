// wwwroot/js/modules/ecopro/keshikomi-auto.js

/**
 * 画面左上へのステータス看板表示
 */
function updateStatusBanner(text, color = '#27ae60') {
    try {
        const targetWindow = window.top || window;
        const targetDoc = targetWindow.document;

        let notice = targetDoc.getElementById('robot-status-banner');
        if (!notice) {
            notice = targetDoc.createElement('div');
            notice.id = 'robot-status-banner';
            targetDoc.body.appendChild(notice);
        }
        notice.style.cssText = `position:fixed; top:10px; left:10px; background:${color}; color:white; padding:10px 18px; border-radius:6px; z-index:9999999; font-weight:bold; font-size:14px; box-shadow:0 4px 12px rgba(0,0,0,0.25); transition: all 0.3s ease;`;
        notice.innerText = text;
    } catch (e) {
        console.error('[消込アシスト] 看板表示エラー:', e);
    }
}

/**
 * 多層 iframe を深さ優先で再帰探索する関数
 */
function deepFindElement(currentDoc, selector) {
    try {
        const el = currentDoc.querySelector(selector);
        if (el) return { element: el, doc: currentDoc };

        const iframes = currentDoc.querySelectorAll('iframe');
        for (let i = 0; i < iframes.length; i++) {
            const frameDoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
            const res = deepFindElement(frameDoc, selector);
            if (res) return res;
        }
    } catch (e) {}
    return null;
}

export async function initKeshikomiAuto() {
    const urlParams = new URLSearchParams(window.top.location.search);
    const customerCode = urlParams.get('customer_code');
    const targetInvoice = urlParams.get('target_invoice');
    const isAllMode = urlParams.get('mode') === 'all';

    if (!customerCode) return;

    updateStatusBanner(`🔍 消込アシスト：顧客コード [${customerCode}] の未消込データを取得中...`, '#2980b9');

    // 1. Render API から Stripe 決済済みの未消込ログを取得
    let logs = [];
    try {
        const res = await fetch(`/api/StripePayment/unpaid-logs?customer_code=${encodeURIComponent(customerCode)}`);
        if (res.ok) {
            logs = await res.json();
        }
    } catch (e) {
        updateStatusBanner('⚠️ 消込アシスト：未消込データの取得に失敗しました', '#c0392b');
        return;
    }

    if (!logs || logs.length === 0) {
        updateStatusBanner(`🟢 消込アシスト：顧客 [${customerCode}] に未消込のStripe決済はありません`, '#27ae60');
        return;
    }

    // 2. 検索窓入力＆顧客データの自動展開
    setTimeout(() => {
        const searchResult = deepFindElement(document, '#SrchWord_txt') || deepFindElement(document, 'input[name="SrchWord_txt"]');
        if (searchResult) {
            const myInput = searchResult.element;
            if (myInput.value !== String(customerCode)) {
                myInput.value = customerCode;
                myInput.dispatchEvent(new Event('input', { bubbles: true }));
                myInput.dispatchEvent(new Event('change', { bubbles: true }));

                const parentForm = myInput.closest('form') || myInput.closest('div') || searchResult.doc.body;
                const myBtn = parentForm.querySelector('input[type="button"], button, input[type="submit"], .btn, [class*="search"]');
                if (myBtn) myBtn.click();
            }
        }
    }, 800);

    // 3. 入金フォーム（SearchReceipt.asp内）への自動セット
    setTimeout(() => {
        const inputMarker = deepFindElement(document, 'input[name*="SalesSlipNum_txt"]') || deepFindElement(document, '.autoInput');
        if (!inputMarker) return;

        let filledCount = 0;
        const now = new Date();
        const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
        const hourStr = String(now.getHours()).padStart(2, '0');
        const minStr = String(now.getMinutes()).padStart(2, '0');

        logs.forEach(log => {
            if (!isAllMode && targetInvoice && log.invoiceNo !== targetInvoice) return;

            let targetTr = null;
            let targetDoc = document;

            function findTr(currentDoc) {
                try {
                    const slipInputs = currentDoc.querySelectorAll('input[name*="SalesSlipNum_txt"], .autoInput');
                    for (let input of slipInputs) {
                        if (input.value?.trim() === String(log.invoiceNo)) {
                            targetTr = input.closest('tr');
                            targetDoc = currentDoc;
                            return true;
                        }
                    }
                    const iframes = currentDoc.querySelectorAll('iframe');
                    for (let i = 0; i < iframes.length; i++) {
                        const frameDoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
                        if (findTr(frameDoc)) return true;
                    }
                } catch (e) {}
                return false;
            }

            findTr(document);

            if (targetTr) {
                const dateInput = targetDoc.querySelector('input[name="ReceiptDate_txt"]') || targetDoc.querySelector('#ReceiptDate_txt');
                if (dateInput) {
                    dateInput.value = dateStr;
                    dateInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                const hourSelect = targetDoc.querySelector('select[name="ReceiptHour_txt"]') || targetDoc.querySelector('#ReceiptHour_txt');
                const minSelect = targetDoc.querySelector('select[name="ReceiptMin_txt"]') || targetDoc.querySelector('#ReceiptMin_txt');
                if (hourSelect) hourSelect.value = hourStr;
                if (minSelect) minSelect.value = minStr;

                const rowSelect = targetTr.querySelector('select');
                if (rowSelect) {
                    Array.from(rowSelect.options).forEach((opt, idx) => {
                        if (opt.text.includes('銀行振込') || opt.text.includes('クレカ') || opt.text.includes('Stripe')) {
                            rowSelect.selectedIndex = idx;
                        }
                    });
                    rowSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }

                const amountInputs = Array.from(targetTr.querySelectorAll('input')).filter(i => i.type !== 'hidden' && !i.readOnly && !i.disabled);
                amountInputs.forEach(input => {
                    input.value = log.amount;
                    input.style.backgroundColor = '#e8f5e9';
                    input.style.fontWeight = 'bold';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                });

                filledCount++;
            }
        });

        if (filledCount > 0) {
            updateStatusBanner(`🎉 消込アシスト：${filledCount}件の伝票に金額を自動入力しました！内容を確認して【登録】を押してください`, '#27ae60');
        } else if (targetInvoice) {
            updateStatusBanner(`⚠️ 消込アシスト：指定の伝票 [${targetInvoice}] が画面上に見つかりません`, '#c0392b');
        }
    }, 2000);
}