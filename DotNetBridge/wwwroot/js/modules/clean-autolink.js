// wwwroot/js/modules/clean-autolink.js

export function initCleanAutoLink() {
    // 🛡️ 隠し iframe / ポップアップ内での重複実行を絶対に防止！
    if (window.self !== window.top) return;
    if (window.__cleanAutoLinkInitialized) return;

    const currentPath = window.location.pathname.toLowerCase();

    // 1. 点検登録完了画面での完了通知表示
    if (currentPath.includes("writecheck.asp")) {
        window.__cleanAutoLinkInitialized = true;
        renderCompletionNotice();
        return;
    }

    // 2. 点検入力画面の処理
    const selectEl = document.getElementById('RESULT_300_11'); // 汚泥引き抜きの必要
    const inputEl = document.getElementById('NUMBER_300_12');   // 月保持用裏input

    if (!selectEl || !inputEl) return;

    const params = new URLSearchParams(window.location.search);
    const setUpCode = params.get('SetUpCode') || document.querySelector('input[name="SetUpCode"]')?.value;

    if (!setUpCode) return;

    window.__cleanAutoLinkInitialized = true;

    inputEl.style.display = 'none';
    createMonthPickerInline(inputEl);

    const setTargetMonth = (monthNum) => {
        inputEl.value = monthNum;
        updateMonthButtonsUI(monthNum);
    };

    const clearAllCleanRemarks = () => {
        [1, 2, 3].forEach(num => {
            const detailSel = document.getElementById(`selRemark${num}Code`);
            if (detailSel) {
                const optText = detailSel.options[detailSel.selectedIndex]?.text || '';
                const val = detailSel.value || '';
                if (val === '1,2' || (optText.includes('汚泥引抜') && optText.includes('実施'))) {
                    detailSel.value = '';
                }
            }
        });
    };

    // 🔄 相互制御：引き抜き必要（B）を選んだら清掃実施（A）をクリア
    selectEl.addEventListener('change', () => {
        const val = selectEl.value;
        if (val === '2,1' || val === '1,1') {
            clearAllCleanRemarks();

            const addMonth = val === '2,1' ? 4 : 1;
            const currentMonth = new Date().getMonth() + 1;
            let targetMonth = (currentMonth + addMonth) % 12;
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

    // 3. 汚泥量入力UI
    initVolumePanel(selectEl, inputEl);

    // 4. ダイアログ登録ボタンフック
    setupDialogHook(setUpCode, inputEl);
}

/**
 * 隠し iframe で「未清掃」POST検索を実行し、画面を開かずに CleanNumber を抜く完成版関数
 */
async function fetchCleanNumberFromList(setUpCode) {
    return new Promise((resolve) => {
        try {
            console.log(`🔍 バックグラウンドで 顧客ID [${setUpCode}] を「未清掃」検索中...`);

            const old = document.getElementById('clean-autolink-iframe');
            if (old) old.remove();

            const iframe = document.createElement('iframe');
            iframe.id = 'clean-autolink-iframe';
            iframe.style.display = 'none';
            iframe.src = '/listClean.asp';
            document.body.appendChild(iframe);

            let isPosted = false;
            let checkCount = 0;

            const checkTimer = setInterval(() => {
                checkCount++;
                try {
                    const iDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const iWin = iframe.contentWindow;

                    if (iDoc && iDoc.readyState === 'complete') {
                        const txtSearch = iDoc.getElementById('txtSearchWord') || iDoc.querySelector('input[type="text"]');
                        const selDate = iDoc.getElementById('selDateRange');
                        
                        const selects = Array.from(iDoc.querySelectorAll('select'));
                        const selStatus = selects.find(s => Array.from(s.options).some(o => o.text.includes('未清掃')));

                        // 1. 初回：未清掃・当月・顧客IDをセットして POST 送信
                        if (!isPosted && txtSearch && selDate && selStatus) {
                            isPosted = true;

                            const uncleanedOpt = Array.from(selStatus.options).find(o => o.text.includes('未清掃'));
                            if (uncleanedOpt) selStatus.value = uncleanedOpt.value;

                            selDate.value = "0"; // 当月
                            txtSearch.value = setUpCode;

                            if (typeof selStatus.onchange === 'function') selStatus.onchange();
                            if (typeof iWin.readList === 'function') iWin.readList();
                            return;
                        }

                        // 2. 検索結果画面から CleanNumber を抽出
                        if (isPosted) {
                            const card = iDoc.querySelector('.link-box, [onclick*="CleanNumber"], a[href*="CleanNumber"]');
                            
                            if (card) {
                                const targetAttr = card.getAttribute('onclick') || card.getAttribute('href') || '';
                                const match = targetAttr.match(/CleanNumber=(\d+)/i) || targetAttr.match(/goTo\([^\)]*['"]?(\d+)['"]?[^\)]*\)/);

                                if (match && match[1]) {
                                    const cleanNum = match[1];
                                    console.log(`✨【成功】 裏画面から CleanNumber 【 ${cleanNum} 】 を取得しました！`);
                                    clearInterval(checkTimer);
                                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                    resolve(cleanNum);
                                    return;
                                }
                            }
                        }
                    }
                } catch (e) {
                    // 読み込み中エラーはスルー
                }

                if (checkCount > 30) {
                    console.warn("⚠️ バックグラウンド検索タイムアウト");
                    clearInterval(checkTimer);
                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                    resolve('');
                }
            }, 200);

        } catch (e) {
            console.error("❌ バックグラウンド処理エラー:", e);
            resolve('');
        }
    });
}

/**
 * ダイアログの「はい」ボタンにフックを仕込む関数
 */
function setupDialogHook(setUpCode, inputEl) {
    const bindHook = () => {
        const regBtn = document.querySelector('input.btn-blue') || 
                       Array.from(document.querySelectorAll('input, button')).find(el => el.value === '登録' || el.textContent.includes('登録'));

        if (!regBtn || regBtn.dataset.cleanHookSet) return;
        regBtn.dataset.cleanHookSet = "true";

        regBtn.addEventListener('click', () => {
            let checkCount = 0;
            const timer = setInterval(() => {
                checkCount++;
                const yesBtn = Array.from(document.querySelectorAll('input[type="button"], button'))
                    .find(el => el.value === 'はい' || el.textContent.trim() === 'はい' || el.getAttribute('onclick')?.includes('submitForm_Yes'));

                if (yesBtn && !yesBtn.dataset.cleanBound) {
                    yesBtn.dataset.cleanBound = "true";
                    clearInterval(timer);

                    const originalOnClickStr = yesBtn.getAttribute('onclick') || '';
                    yesBtn.removeAttribute('onclick');

                    yesBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        yesBtn.disabled = true;
                        yesBtn.value = "処理中...";

                        console.log("🚀 【1. 清掃実績の書き込み】 ➔ 【2. 点検登録】 の順で連動処理を開始します...");

                        const params = new URLSearchParams(window.location.search);
                        const checkNumber = params.get('CheckNumber') || document.querySelector('input[name="CheckNumber"]')?.value || '';
                        const setUpHistoryCode = params.get('SetUpHistoryCode') || '2';
                        const personCode = document.querySelector('input[name="txtPersonCode"]')?.value || '1';

                        const noticeData = {};
                        
                        // 汚泥量の値を取得（入力枠 or 選択ボタン）
                        const volumeInput = document.getElementById('input-clean-volume');
                        let cleanVolume = volumeInput ? volumeInput.value.trim() : '';

                        if (!cleanVolume) {
                            const activeVolBtn = document.querySelector('.btn-vol[style*="background: rgb(2, 132, 199)"], .btn-vol[style*="background:#0284c7"]');
                            if (activeVolBtn) {
                                cleanVolume = activeVolBtn.getAttribute('data-vol') || '';
                            }
                        }

                        // 清掃実績の裏書き込み
                        if (cleanVolume) {
                            console.log(`🧹 検出された汚泥量: 【 ${cleanVolume}㎥ 】。CleanNumber 取得開始...`);
                            
                            const targetCleanNum = await fetchCleanNumberFromList(setUpCode);

                            if (targetCleanNum) {
                                console.log(`🎯 既存 CleanNumber【 ${targetCleanNum} 】へ汚泥量 [${cleanVolume}㎥] を送信中...`);
                                
                                const cleanResultBody = new URLSearchParams();
                                cleanResultBody.append('chkCleanCarFlg_1_1', '1');
                                cleanResultBody.append('txtCarCleanQuantity_1_1', cleanVolume);
                                cleanResultBody.append('txtCarTakeOutQuantity_1_1', cleanVolume);
                                cleanResultBody.append('selPerson', personCode);

                                const cleanResultUrl = `/writeClean.asp?CleanNumber=${targetCleanNum}&CheckNumber=${checkNumber}&WorkMethodCode=1&SetUpCode=${setUpCode}&SetUpHistoryCode=${setUpHistoryCode}`;

                                try {
                                    noticeData.cleanVolume = cleanVolume;
                                    await fetch(cleanResultUrl, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                                        body: cleanResultBody.toString()
                                    });
                                    console.log(`✅ 清掃実績（${cleanVolume}㎥）の書き込みが正常完了しました！`);
                                } catch (err) {
                                    console.error("❌ 清掃実績の書き込みエラー:", err);
                                }
                            } else {
                                console.warn("⚠️ 該当する既存の清掃枠 (CleanNumber) が見つかりませんでした。");
                            }
                        }

                        // 通知データを保存
                        if (Object.keys(noticeData).length > 0) {
                            sessionStorage.setItem('clean_autolink_target', JSON.stringify(noticeData));
                        }

                        // 保存のブラウザ定着待ち (100ms)
                        await new Promise(resolve => setTimeout(resolve, 100));

                        console.log("🏁 裏処理完了。本来の点検登録を実行します。");

                        if (typeof submitForm_Yes === 'function') {
                            submitForm_Yes();
                        } else if (originalOnClickStr) {
                            new Function(originalOnClickStr)();
                        } else {
                            const form = yesBtn.closest('form') || document.forms[0];
                            if (form) form.submit();
                        }
                    });
                }

                if (checkCount > 30) clearInterval(timer);
            }, 100);
        });
    };

    bindHook();
    const observer = new MutationObserver(bindHook);
    observer.observe(document.body, { childList: true, subtree: true });
}

function initVolumePanel(selectEl, inputEl) {
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

    let lastIsCleaned = false;

    const updatePanelStatus = () => {
        let activeSelect = null;

        [1, 2, 3].forEach(num => {
            const classSel = document.getElementById(`selRemarkClass${num}Code`);
            const detailSel = document.getElementById(`selRemark${num}Code`);

            if (detailSel && detailSel.selectedIndex >= 0) {
                const optText = detailSel.options[detailSel.selectedIndex]?.text.trim() || '';
                const val = detailSel.value || '';

                const isDetailMatch = optText.includes('引抜') || 
                                      optText.includes('清掃') || 
                                      optText.includes('実施') || 
                                      val === '1,2';

                if (isDetailMatch) {
                    activeSelect = detailSel;
                }
            }
        });

        if (activeSelect) {
            if (!lastIsCleaned && selectEl.value !== '') {
                selectEl.value = '';
                if (inputEl) inputEl.value = '';
                hideInlinePanel();
                sessionStorage.removeItem('clean_autolink_target');
            }
            lastIsCleaned = true;

            const parentBlock = activeSelect.closest('div[id^="divRemark"]') || activeSelect.parentNode;
            if (parentBlock) {
                if (panel.parentNode !== parentBlock) {
                    parentBlock.appendChild(panel);
                }
                if (panel.style.display !== 'block') {
                    panel.style.display = 'block';
                    if (volumeInput && !volumeInput.value) {
                        const btn2 = panel.querySelector('[data-vol="2"]');
                        if (btn2) btn2.click();
                    }
                }
            }
        } else {
            lastIsCleaned = false;
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

function renderCompletionNotice() {
    const savedDataStr = sessionStorage.getItem('clean_autolink_target');
    if (!savedDataStr) return;

    try {
        const savedData = JSON.parse(savedDataStr);
        sessionStorage.removeItem('clean_autolink_target');

        const container = document.createElement('div');
        container.style.cssText = `
            margin: 15px auto;
            text-align: center;
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: center;
        `;

        if (savedData.cleanVolume) {
            const resultCard = document.createElement('div');
            resultCard.style.cssText = `
                padding: 10px 18px;
                background: #f0fdf4;
                border: 1px solid #86efac;
                color: #15803d;
                border-radius: 10px;
                font-size: 14px;
                font-weight: 700;
                box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;
            resultCard.innerHTML = `🧹 清掃実績（${savedData.cleanVolume}㎥）を自動登録しました`;
            container.appendChild(resultCard);
        }

        if (savedData.month) {
            const planCard = document.createElement('div');
            planCard.style.cssText = `
                padding: 10px 18px;
                background: #f0f9ff;
                border: 1px solid #7dd3fc;
                color: #0369a1;
                border-radius: 10px;
                font-size: 14px;
                font-weight: 700;
                box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;
            planCard.innerHTML = `📅 清掃予定（${savedData.month}月1日）を自動登録しました`;
            container.appendChild(planCard);
        }

        const centerEl = document.querySelector('center');
        if (centerEl) {
            const targetDiv = centerEl.querySelector('div') || centerEl;
            const conditionDiv = document.getElementById('divCondition');
            if (conditionDiv) {
                targetDiv.insertBefore(container, conditionDiv);
            } else {
                targetDiv.appendChild(container);
            }
        } else {
            document.body.prepend(container);
        }
    } catch (e) {
        console.error("完了通知表示エラー:", e);
    }
}