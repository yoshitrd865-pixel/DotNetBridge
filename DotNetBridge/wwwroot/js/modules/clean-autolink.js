// wwwroot/js/modules/clean-autolink.js



export function initCleanAutoLink() {
    // 🛡️ 隠し iframe 内での重複実行を絶対に防止！
    if (window.self !== window.top) return;
    if (window.__cleanAutoLinkInitialized) return;
    
    // （以下、既存の処理...）

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
 * 裏ポップアップ（極小ウィンドウ）を開いて清掃一覧を描画させ、
 * CleanNumber を確実かつ爆速で抽出して自動クローズする関数
 */
async function fetchCleanNumberFromList(setUpCode) {
    return new Promise((resolve) => {
        try {
            console.log(`🚀 裏ポップアップを立ち上げて 顧客ID [${setUpCode}] の CleanNumber を検索します...`);

            // 画面の隅に極小サイズ（1x1px）でポップアップを開く
            const popup = window.open(
                `/listClean.asp`,
                'CleanNumberSearchPopup',
                'width=100,height=100,left=2000,top=2000,scrollbars=no,resizable=no'
            );

            if (!popup) {
                console.warn("⚠️ ポップアップがブロックされました。");
                resolve('');
                return;
            }

            let loadCount = 0;

            // ポップアップ側のロード監視
            const checkTimer = setInterval(async () => {
                try {
                    if (popup.closed) {
                        clearInterval(checkTimer);
                        resolve('');
                        return;
                    }

                    const pDoc = popup.document;
                    const pWin = popup;

                    if (pDoc && pDoc.readyState === 'complete') {
                        // 1. 初回読み込み時：検索条件（SetUpCode / 当月:0）をセットして検索実行
                        if (loadCount === 0) {
                            loadCount = 1;

                            const txtSearch = pDoc.getElementById('txtSearchWord') || pDoc.querySelector('input[type="text"]');
                            if (txtSearch) txtSearch.value = setUpCode;

                            const selDate = pDoc.getElementById('selDateRange');
                            if (selDate && selDate.value !== "0") {
                                selDate.value = "0"; // 当月
                                if (typeof pWin.changeDateRange === 'function') {
                                    pWin.changeDateRange();
                                    return; // リロード待ち
                                }
                            }

                            if (typeof pWin.readList === 'function') {
                                pWin.readList();
                            }
                        }

                        // 2. カード描画待ち ➔ CleanNumber 抽出
                        const html = pDoc.body ? pDoc.body.innerHTML : '';
                        const match = html.match(/CleanNumber=(\d+)/i) || html.match(/goTo\([^\)]*['"]?(\d+)['"]?[^\)]*\)/);

                        if (match && match[1]) {
                            const cleanNum = match[1];
                            console.log(`✨【成功】 ポップアップから CleanNumber 【 ${cleanNum} 】 を引っこ抜きました！`);
                            
                            clearInterval(checkTimer);
                            popup.close(); // 抽出完了したら即座に閉じる
                            resolve(cleanNum);
                        }
                    }
                } catch (e) {
                    // ドメイン遷移中の一時的なアクセスエラーは無視して監視を継続
                }
            }, 200);

            // 4秒経過しても取れない場合は安全のため強制クローズ
            setTimeout(() => {
                clearInterval(checkTimer);
                if (popup && !popup.closed) popup.close();
                resolve('');
            }, 4000);

        } catch (e) {
            console.error("❌ ポップアップ処理エラー:", e);
            resolve('');
        }
    });
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

                // 「引抜」「清掃」「実施」「1,2」などのキーワードに幅広く反応させる
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

/**
 * 裏ポップアップを開き、カード描画完了を確実に待って CleanNumber を抽出する関数
 */
async function fetchCleanNumberFromList(setUpCode) {
    return new Promise((resolve) => {
        try {
            console.log(`🚀 裏ポップアップを起動: 顧客ID [${setUpCode}] を検索中...`);

            const popup = window.open(
                `/listClean.asp`,
                'CleanNumberSearchPopup',
                'width=100,height=100,left=2000,top=2000,scrollbars=no,resizable=no'
            );

            if (!popup) {
                console.warn("⚠️ ポップアップがブロックされました。");
                resolve('');
                return;
            }

            let isSearchTriggered = false;
            let checkCount = 0;

            const checkTimer = setInterval(() => {
                checkCount++;
                try {
                    if (popup.closed) {
                        clearInterval(checkTimer);
                        resolve('');
                        return;
                    }

                    const pDoc = popup.document;
                    const pWin = popup;

                    if (pDoc && pDoc.readyState === 'complete') {
                        // 1. 初回：検索条件をセットして検索実行
                        if (!isSearchTriggered) {
                            isSearchTriggered = true;

                            const txtSearch = pDoc.getElementById('txtSearchWord') || pDoc.querySelector('input[type="text"]');
                            if (txtSearch) txtSearch.value = setUpCode;

                            const selDate = pDoc.getElementById('selDateRange');
                            if (selDate) {
                                selDate.value = "0"; // 当月
                                if (typeof pWin.changeDateRange === 'function') {
                                    pWin.changeDateRange();
                                }
                            }

                            if (typeof pWin.readList === 'function') {
                                pWin.readList();
                            }
                        }

                        // 2. 毎サイクル(200ms毎) HTML内を検索
                        const html = pDoc.body ? pDoc.body.innerHTML : '';
                        const match = html.match(/CleanNumber=(\d+)/i) || 
                                    html.match(/goTo\([^\)]*['"]?(\d+)['"]?[^\)]*\)/) ||
                                    html.match(/menuClean\.asp\?CleanNumber=(\d+)/i);

                        if (match && match[1]) {
                            const cleanNum = match[1];
                            console.log(`✨【成功】 CleanNumber 【 ${cleanNum} 】 を抽出しました！`);
                            
                            clearInterval(checkTimer);
                            popup.close();
                            resolve(cleanNum);
                            return;
                        }
                    }
                } catch (e) {
                    // ページ遷移中の一時エラーは無視
                }

                // 25回（5秒間）探しても無ければ諦める
                if (checkCount > 25) {
                    console.warn("⚠️ CleanNumber の描画待ちがタイムアウトしました。");
                    clearInterval(checkTimer);
                    if (popup && !popup.closed) popup.close();
                    resolve('');
                }
            }, 200);

        } catch (e) {
            console.error("❌ ポップアップ処理エラー:", e);
            resolve('');
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