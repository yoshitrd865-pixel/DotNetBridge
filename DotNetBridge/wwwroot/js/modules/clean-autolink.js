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
    const selectEl = document.getElementById('RESULT_300_11'); // 汚泥引き抜きの必要
    const inputEl = document.getElementById('NUMBER_300_12');   // 月保持用裏input

    if (!selectEl || !inputEl) return;

    const params = new URLSearchParams(window.location.search);
    const setUpCode = params.get('SetUpCode') || document.querySelector('input[name="SetUpCode"]')?.value;

    if (!setUpCode) return;

    window.__cleanAutoLinkInitialized = true;

    // テキストボックス隠し & 1月〜12月ボタンパネルの作成
    inputEl.style.display = 'none';
    createMonthPickerInline(inputEl);

    const setTargetMonth = (monthNum) => {
        inputEl.value = monthNum;
        updateMonthButtonsUI(monthNum);
    };

    // 🧹【回収ロジック】「汚泥引抜清掃実施」を検知したら「引き抜き必要」を自動クリア
    const checkAndClearSludgeNeed = () => {
        let isCleaned = false;

        [1, 2, 3].forEach(num => {
            const classSel = document.getElementById(`selRemarkClass${num}Code`);
            const detailSel = document.getElementById(`selRemark${num}Code`);

            if (detailSel && detailSel.selectedIndex >= 0) {
                const optText = detailSel.options[detailSel.selectedIndex]?.text || '';
                const isClassClean = classSel ? classSel.options[classSel.selectedIndex]?.text.includes('清掃連絡') : true;
                if (isClassClean && optText.includes('汚泥引抜清掃実施')) {
                    isCleaned = true;
                }
            }
        });

        if (isCleaned && selectEl.value !== '') {
            selectEl.value = '';
            inputEl.value = '';
            hideInlinePanel();
            sessionStorage.removeItem('clean_autolink_target');
        }
    };

    // 予定作成（送信側）ドロップダウンイベント
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

    // 初期化判定
    checkAndClearSludgeNeed();

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

    // 3. 汚泥量入力UIの動的セット＆リアルタイム監視スタート
    initVolumePanel();

    // 4. ダイアログ登録ボタンフック（予定裏送信 & 実績裏送信）
    setupDialogHook(setUpCode, inputEl);
}

/**
 * 汚泥量入力UIの生成と位置・条件制御
 */
function initVolumePanel() {
    document.querySelectorAll('#clean-volume-panel').forEach(el => el.remove());
    if (window.__volumeCheckTimer) clearInterval(window.__volumeCheckTimer);

    const panel = document.createElement('div');
    panel.id = 'clean-volume-panel';
    panel.style.cssText = `
        margin: 8px 0 12px 0;
        padding: 8px;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        display: none;
        box-sizing: border-box;
    `;

    panel.innerHTML = `
        <div style="font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 6px;">
            🧹 清掃汚泥量・搬出汚泥量 (㎥)
        </div>
        <div style="display: flex; align-items: flex-end; gap: 8px; width: 100%;">
            <div style="display: flex; gap: 4px; flex: 2.2;">
                <button type="button" class="btn-vol" data-vol="1" style="flex:1; padding:10px 0; background:#fff; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; font-weight:600; color:#334155; cursor:pointer; transition:all 0.15s ease;">1㎥</button>
                <button type="button" class="btn-vol" data-vol="2" style="flex:1; padding:10px 0; background:#fff; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; font-weight:600; color:#334155; cursor:pointer; transition:all 0.15s ease;">2㎥</button>
                <button type="button" class="btn-vol" data-vol="3" style="flex:1; padding:10px 0; background:#fff; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; font-weight:600; color:#334155; cursor:pointer; transition:all 0.15s ease;">3㎥</button>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; flex: 1.2;">
                <span style="font-size: 10px; font-weight: 700; color: #64748b; margin-bottom: 2px;">直接入力</span>
                <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                    <input type="text" id="input-clean-volume" class="inputitem" placeholder="他" 
                           onclick="if(typeof display10KeyPad === 'function') display10KeyPad(this);" 
                           style="width: 100%; min-width: 0; padding: 8px 2px; border: 1px solid #cbd5e1; border-radius: 6px; text-align: center; font-size: 14px; font-weight: 700; background: #fff; box-sizing: border-box; height: 39px;">
                    <span style="font-size: 13px; font-weight: 700; color: #334155; white-space: nowrap;">㎥</span>
                </div>
            </div>
        </div>
    `;

    const volumeInput = panel.querySelector('#input-clean-volume');
    const volBtns = panel.querySelectorAll('.btn-vol');

    volBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const val = btn.getAttribute('data-vol');
            if (volumeInput) volumeInput.value = val;

            volBtns.forEach(b => {
                b.style.background = '#ffffff';
                b.style.color = '#334155';
                b.style.borderColor = '#cbd5e1';
                b.style.fontWeight = '600';
                b.style.boxShadow = 'none';
            });
            btn.style.background = '#0284c7';
            btn.style.color = '#ffffff';
            btn.style.borderColor = '#0284c7';
            btn.style.fontWeight = '700';
            btn.style.boxShadow = '0 2px 4px rgba(2,132,199,0.3)';
        });
    });

    if (volumeInput) {
        volumeInput.addEventListener('focus', () => {
            volBtns.forEach(b => {
                b.style.background = '#ffffff';
                b.style.color = '#334155';
                b.style.borderColor = '#cbd5e1';
                b.style.fontWeight = '600';
                b.style.boxShadow = 'none';
            });
        });
    }

    const updatePanelStatus = () => {
        let activeSelect = null;

        [1, 2, 3].forEach(num => {
            const classSel = document.getElementById(`selRemarkClass${num}Code`);
            const detailSel = document.getElementById(`selRemark${num}Code`);

            if (detailSel && detailSel.selectedIndex >= 0) {
                const optText = detailSel.options[detailSel.selectedIndex]?.text.trim() || '';
                const isClassClean = classSel ? classSel.options[classSel.selectedIndex]?.text.includes('清掃連絡') : true;
                const isDetailMatch = optText.includes('汚泥引抜清掃実施');

                if (isClassClean && isDetailMatch) {
                    activeSelect = detailSel;
                }
            }
        });

        if (activeSelect) {
            const parentBlock = activeSelect.closest('div[id^="divRemark"]') || activeSelect.parentNode;
            if (parentBlock) {
                if (panel.parentNode !== parentBlock) {
                    parentBlock.appendChild(panel);
                }
                if (panel.style.display !== 'block') {
                    panel.style.display = 'block';
                    if (volumeInput && !volumeInput.value) {
                        const btn2 = panel.querySelector('[data-vol="2"]');
                        if (btn2) btn2.click(); // デフォルト2㎥
                    }
                }
            }
        } else {
            if (panel.style.display !== 'none') {
                panel.style.display = 'none';
                if (volumeInput) volumeInput.value = '';
            }
        }
    };

    window.__volumeCheckTimer = setInterval(updatePanelStatus, 200);
    updatePanelStatus();
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
                padding: 10px 0; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px;
                font-size: 13px; font-weight: 600; color: #334155; cursor: pointer; transition: all 0.15s ease;
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
    const p = document.getElementById('clean-month-picker-inline');
    if (p) p.style.display = 'block';
}

function hideInlinePanel() {
    const p = document.getElementById('clean-month-picker-inline');
    if (p) p.style.display = 'none';
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
 * ダイアログの「はい」押下時の二方向裏送信フック
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
                    const params = new URLSearchParams(window.location.search);
                    const checkNumber = params.get('CheckNumber') || document.querySelector('input[name="CheckNumber"]')?.value || '';
                    const districtCode = document.querySelector('input[name="txtDistrictCode"]')?.value || '6,1';
                    const citiesCode = document.querySelector('input[name="txtCitiesCode"]')?.value || '2,1';
                    const personCode = document.querySelector('input[name="txtPersonCode"]')?.value || '1';

                    // 1️⃣ 【清掃予定の裏送信】（引き抜きが必要な月が選択されている場合）
                    const targetMonthStr = inputEl ? inputEl.value.trim() : '';
                    if (targetMonthStr) {
                        const targetMonth = parseInt(targetMonthStr, 10);
                        if (!isNaN(targetMonth)) {
                            const d = new Date();
                            const currentMonth = d.getMonth() + 1;
                            let targetYear = d.getFullYear();
                            if (targetMonth < currentMonth) targetYear += 1;

                            const formattedMonth = String(targetMonth).padStart(2, '0');
                            const targetDate = `${targetYear}/${formattedMonth}/01`;

                            const bodyData = new URLSearchParams();
                            bodyData.append('txtWorkDate', targetDate);
                            bodyData.append('ProcessDivisionCode', '2');
                            bodyData.append('ProcessDivisionHistoryCode', '1');
                            bodyData.append('txtDistrictCode', districtCode);
                            bodyData.append('txtCitiesCode', citiesCode);
                            bodyData.append('selPerson', personCode);

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
                        }
                    }

                    // 2️⃣ 【清掃実績（汚泥量）の裏送信】（汚泥引抜清掃実施が選択され、㎥数が入力されている場合）
                    const volumeInput = document.getElementById('input-clean-volume');
                    const cleanVolume = volumeInput ? volumeInput.value.trim() : '';

                    if (cleanVolume) {
                        const cleanResultBody = new URLSearchParams();
                        cleanResultBody.append('chkCleanCarFlg_1_1', '1'); // バキューム車使用フラグ
                        cleanResultBody.append('txtCarCleanQuantity_1_1', cleanVolume); // 清掃汚泥量(m3)
                        cleanResultBody.append('txtCarTakeOutQuantity_1_1', cleanVolume); // 搬出汚泥量(m3)
                        cleanResultBody.append('selPerson', personCode);

                        // 清掃実績登録用API
                        const cleanResultUrl = `/writeClean.asp?CheckNumber=${checkNumber}&WorkMethodCode=1&SetUpCode=${setUpCode}&SetUpHistoryCode=2`;

                        try {
                            await fetch(cleanResultUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                                body: cleanResultBody.toString()
                            });
                            console.log(`✅ 清掃実績（バキューム車使用 / 汚泥量 ${cleanVolume}㎥）を自動裏送信しました！`);
                        } catch (err) {
                            console.error("清掃実績裏送信エラー:", err);
                        }
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