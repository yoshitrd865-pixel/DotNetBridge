// wwwroot/js/modules/clean-autolink.js

export function initCleanAutoLink() {
    if (window.__cleanAutoLinkInitialized) return;

    const currentPath = window.location.pathname.toLowerCase();

    // 1. 点検登録完了画面（writeCheck.asp）での完了通知表示
    if (currentPath.includes("writecheck.asp")) {
        window.__cleanAutoLinkInitialized = true;
        renderCompletionNotice();
        return;
    }

    // 2. 点検入力画面（check.asp等）の処理
    const selectEl = document.getElementById('RESULT_300_11');
    const inputEl = document.getElementById('NUMBER_300_12');

    if (!selectEl || !inputEl) return;

    const params = new URLSearchParams(window.location.search);
    const setUpCode = params.get('SetUpCode') || document.querySelector('input[name="SetUpCode"]')?.value;

    if (!setUpCode) return;

    window.__cleanAutoLinkInitialized = true;

    // 不要になったテキストボックス要素を非表示化
    inputEl.style.display = 'none';

    // 1月〜12月 ボタンを配置
    createMonthPickerInline(inputEl);

    const setTargetMonth = (monthNum) => {
        inputEl.value = monthNum;
        updateMonthButtonsUI(monthNum);
    };

    selectEl.addEventListener('change', () => {
        const val = selectEl.value;
        if (val === '2,1') {
            const currentMonth = new Date().getMonth() + 1;
            let targetMonth = (currentMonth + 4) % 12;
            if (targetMonth === 0) targetMonth = 12;
            setTargetMonth(targetMonth);
            showInlinePanel();
        } else if (val === '1,1') {
            const currentMonth = new Date().getMonth() + 1;
            let targetMonth = (currentMonth + 1) % 12;
            if (targetMonth === 0) targetMonth = 12;
            setTargetMonth(targetMonth);
            showInlinePanel();
        } else {
            hideInlinePanel();
            inputEl.value = '';
            sessionStorage.removeItem('clean_autolink_target');
        }
    });

    if (selectEl.value === '2,1' || selectEl.value === '1,1') {
        if (inputEl.value) {
            setTargetMonth(parseInt(inputEl.value, 10));
        } else {
            const add = selectEl.value === '2,1' ? 4 : 1;
            const currentMonth = new Date().getMonth() + 1;
            let targetMonth = (currentMonth + add) % 12;
            if (targetMonth === 0) targetMonth = 12;
            setTargetMonth(targetMonth);
        }
        showInlinePanel();
    }

    setupDialogHook(setUpCode, inputEl);
}

function createMonthPickerInline(inputEl) {
    if (document.getElementById('clean-month-picker-inline')) return;

    const panel = document.createElement('div');
    panel.id = 'clean-month-picker-inline';
    panel.style.cssText = `
        margin: 6px 0 12px 0;
        padding: 8px;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        display: none;
    `;

    let buttonsHtml = '<div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px;">';

    for (let m = 1; m <= 12; m++) {
        buttonsHtml += `
            <button type="button" class="btn-clean-m" data-month="${m}" style="
                padding: 10px 0;
                background: #ffffff;
                border: 1px solid #cbd5e1;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                color: #334155;
                cursor: pointer;
                transition: all 0.15s ease;
            ">${m}月</button>
        `;
    }
    buttonsHtml += '</div>';
    panel.innerHTML = buttonsHtml;

    if (inputEl.nextSibling) {
        inputEl.parentNode.insertBefore(panel, inputEl.nextSibling);
    } else {
        inputEl.parentNode.appendChild(panel);
    }

    panel.querySelectorAll('.btn-clean-m').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const selectedMonth = parseInt(btn.getAttribute('data-month'), 10);
            inputEl.value = selectedMonth;
            updateMonthButtonsUI(selectedMonth);
        });
    });
}

function showInlinePanel() {
    const panel = document.getElementById('clean-month-picker-inline');
    if (panel) panel.style.display = 'block';
}

function hideInlinePanel() {
    const panel = document.getElementById('clean-month-picker-inline');
    if (panel) panel.style.display = 'none';
}

function updateMonthButtonsUI(activeMonth) {
    const panel = document.getElementById('clean-month-picker-inline');
    if (!panel) return;

    panel.querySelectorAll('.btn-clean-m').forEach(btn => {
        const m = parseInt(btn.getAttribute('data-month'), 10);
        if (m === activeMonth) {
            btn.style.background = '#0284c7';
            btn.style.color = '#ffffff';
            btn.style.borderColor = '#0284c7';
            btn.style.fontWeight = '700';
            btn.style.boxShadow = '0 2px 4px rgba(2,132,199,0.3)';
        } else {
            btn.style.background = '#ffffff';
            btn.style.color = '#334155';
            btn.style.borderColor = '#cbd5e1';
            btn.style.fontWeight = '600';
            btn.style.boxShadow = 'none';
        }
    });
}

/**
 * 🔍 清掃入力画面から、指定された担当者IDに対応する最新の selPerson (例: '2,6') を解析取得する
 */
async function fetchLatestPersonValue(checkNumber, setUpCode, personId) {
    try {
        const cleanPlanUrl = `/cleanPlan.asp?CheckNumber=${checkNumber}&WorkMethodCode=1&SetUpCode=${setUpCode}&SetUpHistoryCode=2`;
        const res = await fetch(cleanPlanUrl);
        const htmlText = await res.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const selEl = doc.getElementById('selPerson');

        if (selEl) {
            // IDで始まるoptionを探す (例: "2," で始まる "2,6" を取得)
            const matchedOpt = Array.from(selEl.options).find(o => o.value.startsWith(`${personId},`));
            if (matchedOpt) {
                return matchedOpt.value;
            }
        }
    } catch (err) {
        console.error("清掃担当者プルダウン解析エラー:", err);
    }
    // 取得できなかった場合のフォールバック（例: '2,1'）
    return `${personId},1`;
}

/**
 * ダイアログの「はい」ボタンフック（最新の selPerson 値を自動補完して送信）
 */
function setupDialogHook(setUpCode, inputEl) {
    const regBtn = document.querySelector('input.btn-blue');
    if (!regBtn || regBtn.dataset.cleanHookSet) return;
    regBtn.dataset.cleanHookSet = "true";

    regBtn.addEventListener('click', () => {
        setTimeout(() => {
            const yesBtn = Array.from(document.querySelectorAll('input[type="button"]'))
                .find(el => el.value === 'はい' || el.getAttribute('onclick')?.includes('submitForm_Yes'));

            if (yesBtn && !yesBtn.dataset.cleanBound) {
                yesBtn.dataset.cleanBound = "true";

                yesBtn.addEventListener('click', async () => {
                    const targetMonthStr = inputEl ? inputEl.value.trim() : '';
                    if (!targetMonthStr) return;

                    const targetMonth = parseInt(targetMonthStr, 10);
                    if (isNaN(targetMonth)) return;

                    const d = new Date();
                    const currentMonth = d.getMonth() + 1;
                    let targetYear = d.getFullYear();
                    if (targetMonth < currentMonth) {
                        targetYear += 1;
                    }

                    const formattedMonth = String(targetMonth).padStart(2, '0');
                    const targetDate = `${targetYear}/${formattedMonth}/01`;

                    const params = new URLSearchParams(window.location.search);
                    const checkNumber = params.get('CheckNumber') || document.querySelector('input[name="CheckNumber"]')?.value || '';
                    const districtCode = document.querySelector('input[name="txtDistrictCode"]')?.value || '6,1';
                    const citiesCode = document.querySelector('input[name="txtCitiesCode"]')?.value || '2,1';

                    // 点検画面の担当者ID（例: '2'）
                    const personId = document.querySelector('input[name="txtPersonCode"]')?.value || '1';

                    // 🎯 自動で cleanPlan.asp のプルダウンから最新の '2,6' などを解析取得！
                    const selPersonValue = await fetchLatestPersonValue(checkNumber, setUpCode, personId);

                    const bodyData = new URLSearchParams();
                    bodyData.append('txtWorkDate', targetDate);
                    bodyData.append('ProcessDivisionCode', '2');
                    bodyData.append('ProcessDivisionHistoryCode', '1');
                    bodyData.append('txtDistrictCode', districtCode);
                    bodyData.append('txtCitiesCode', citiesCode);
                    
                    // 正しい形式（2,6 等）を送信
                    bodyData.append('selPerson', selPersonValue);

                    const targetUrl = `/writeCleanPlan.asp?CheckNumber=${checkNumber}&WorkMethodCode=1&SetUpCode=${setUpCode}&SetUpHistoryCode=2`;

                    try {
                        sessionStorage.setItem('clean_autolink_target', JSON.stringify({
                            month: targetMonth,
                            targetDate: targetDate
                        }));

                        await fetch(targetUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                            body: bodyData.toString()
                        });
                    } catch (err) {
                        console.error("清掃予定裏送信エラー:", err);
                    }
                });
            }
        }, 150);
    });
}

function renderCompletionNotice() {
    const savedDataStr = sessionStorage.getItem('clean_autolink_target');
    if (!savedDataStr) return;

    try {
        const savedData = JSON.parse(savedDataStr);
        sessionStorage.removeItem('clean_autolink_target');

        const noticeCard = document.createElement('div');
        noticeCard.id = 'clean-completion-card';
        noticeCard.style.cssText = `
            margin: 15px auto;
            padding: 10px 16px;
            background: #f0fdf4;
            border: 1px solid #86efac;
            color: #15803d;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 700;
            text-align: center;
            display: inline-block;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
        `;
        noticeCard.innerHTML = `🧹 清掃予定（${savedData.month}月1日）を自動登録しました`;

        const centerEl = document.querySelector('center');
        if (centerEl) {
            const targetDiv = centerEl.querySelector('div') || centerEl;
            const conditionDiv = document.getElementById('divCondition');
            if (conditionDiv) {
                targetDiv.insertBefore(noticeCard, conditionDiv);
            } else {
                targetDiv.appendChild(noticeCard);
            }
        } else {
            document.body.prepend(noticeCard);
        }
    } catch (e) {
        console.error("完了通知表示エラー:", e);
    }
}