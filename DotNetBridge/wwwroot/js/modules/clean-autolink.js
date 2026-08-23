// wwwroot/js/modules/clean-autolink.js

export function initCleanAutoLink() {
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
    const selectEl = document.getElementById('RESULT_300_11');
    const inputEl = document.getElementById('NUMBER_300_12');

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

    initVolumePanel(selectEl, inputEl);
    setupDialogHook(setUpCode, inputEl);
}

/**
 * 🌟 テスト用ウエイト関数 (指定ミリ秒待機)
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 🌟 画面中央にリアルタイムステータスを表示するUI関数
 */
function showStatusToast(message, bgColor = '#0284c7') {
    let toast = document.getElementById('clean-autolink-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'clean-autolink-toast';
        toast.style.cssText = `
            position: fixed;
            top: 40%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 999999;
            padding: 16px 24px;
            background: ${bgColor};
            color: #ffffff;
            font-size: 15px;
            font-weight: bold;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 85%;
            pointer-events: none;
            transition: all 0.2s ease;
        `;
        document.body.appendChild(toast);
    }
    toast.style.background = bgColor;
    toast.innerHTML = message;
    toast.style.display = 'block';
}

function hideStatusToast() {
    const toast = document.getElementById('clean-autolink-toast');
    if (toast) toast.style.display = 'none';
}

/**
 * 隠し iframe で「未清掃」POST検索を実行し、指定された SetUpCode と一致する CleanNumber を抜く関数（DOM構造完全合致版）
 */
async function fetchCleanNumberFromList(setUpCode) {
    return new Promise((resolve) => {
        try {
            console.log(`🔍 バックグラウンドで 顧客ID [${setUpCode}] の「未清掃」枠を検索中...`);

            const old = document.getElementById('clean-autolink-iframe');
            if (old) old.remove();

            const iframe = document.createElement('iframe');
            iframe.id = 'clean-autolink-iframe';
            iframe.style.display = 'none';
            iframe.src = '/listClean.asp';
            document.body.appendChild(iframe);

            const searchRanges = ["0", "-1", "1"]; // 当月 ➔ 先月 ➔ 来月
            let rangeIndex = 0;
            let isWaitingForPost = false;
            let checkCount = 0;

            const checkTimer = setInterval(() => {
                checkCount++;
                try {
                    const iDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const iWin = iframe.contentWindow;

                    if (iDoc && (iDoc.readyState === 'complete' || iDoc.readyState === 'interactive')) {
                        const txtSearch = iDoc.getElementById('txtSearchWord') || iDoc.querySelector('input[type="text"]');
                        const selDate = iDoc.getElementById('selDateRange');
                        const selStatus = iDoc.getElementById('selSwitchCheck') || iDoc.querySelector('select[name="selSwitchCheck"]');

                        // 1. 検索条件のセットと実行
                        if (!isWaitingForPost && (txtSearch || selStatus)) {
                            isWaitingForPost = true;

                            // 「未清掃 (value="0")」を強制選択
                            if (selStatus) {
                                selStatus.value = '0';
                                if (typeof selStatus.onchange === 'function') selStatus.onchange();
                            }

                            if (selDate) selDate.value = searchRanges[rangeIndex];
                            if (txtSearch) txtSearch.value = setUpCode;

                            console.log(`🔎 一覧検索を実行中 (期間: ${searchRanges[rangeIndex]}, ID: ${setUpCode})...`);

                            if (typeof iWin.readList === 'function') {
                                iWin.readList();
                            } else {
                                const btnSearch = iDoc.querySelector('input[value*="検索"], button[onclick*="readList"]');
                                if (btnSearch) btnSearch.click();
                            }
                            return;
                        }

                        // 2. 実際の DOM (.taskItem) から CleanNumber=572 を抽出
                        if (isWaitingForPost && checkCount > 2) {
                            const taskItems = Array.from(iDoc.querySelectorAll('.taskItem'));

                            // 顧客ID (1917) を含むカード項目を特定
                            const targetItem = taskItems.find(item => {
                                const jksNumEl = item.querySelector('.jksNum');
                                const txt = jksNumEl ? jksNumEl.textContent : item.textContent;
                                return txt.includes(setUpCode);
                            });

                            if (targetItem) {
                                // href="menuClean.asp?CleanNumber=572" から番号を抽出
                                const linkEl = targetItem.querySelector('a.link-area, a[href*="CleanNumber"]');
                                const href = linkEl ? linkEl.getAttribute('href') : '';
                                const match = href.match(/CleanNumber=(\d+)/i);

                                if (match && match[1]) {
                                    const cleanNum = match[1];
                                    console.log(`✨【見つかりました！】 顧客ID [${setUpCode}] の CleanNumber 【 ${cleanNum} 】 を抽出完了！`);
                                    clearInterval(checkTimer);
                                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                    
                                    resolve({
                                        cleanNum: cleanNum,
                                        customerName: ''
                                    });
                                    return;
                                }
                            }

                            // 見つからない場合は期間を切り替えて再検索
                            if (checkCount % 15 === 0 && rangeIndex < searchRanges.length - 1) {
                                rangeIndex++;
                                isWaitingForPost = false;
                                console.warn(`⚠️ 範囲内にないため、次の検索範囲 (${searchRanges[rangeIndex]}) へ切り替えます...`);
                            }
                        }
                    }
                } catch (e) {
                    // スルー
                }

                if (checkCount > 45) {
                    console.warn(`⚠️ 顧客ID [${setUpCode}] の「未清掃」枠が見つかりませんでした。`);
                    clearInterval(checkTimer);
                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                    resolve(null);
                }
            }, 200);

        } catch (e) {
            console.error("❌ 一覧検索エラー:", e);
            resolve(null);
        }
    });
}

/**
 * 隠し iframe 内で「清掃入力画面 (clean.asp)」を開き、静かにフォーム送信を完走させる関数
 */
async function processCleanRegistration(cleanNum, cleanVolume) {
    return new Promise((resolve) => {
        try {
            console.log(`🧹 裏画面で 清掃入力画面 (CleanNumber=${cleanNum}) の自動登録を実行中...`);

            const old = document.getElementById('clean-submit-iframe');
            if (old) old.remove();

            const iframe = document.createElement('iframe');
            iframe.id = 'clean-submit-iframe';
            iframe.style.display = 'none';
            iframe.src = `/clean.asp?CleanNumber=${cleanNum}&WorkMethodCode=1`;
            document.body.appendChild(iframe);

            let isFormSubmitted = false;
            let checkCount = 0;

            const timer = setInterval(() => {
                checkCount++;
                try {
                    const iDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const iWin = iframe.contentWindow;

                    if (iDoc && iDoc.readyState === 'complete') {
                        if (!isFormSubmitted) {
                            const volInput1 = iDoc.querySelector('input[name="txtCarCleanQuantity_1_1"], #txtCarCleanQuantity_1_1');
                            const volInput2 = iDoc.querySelector('input[name="txtCarTakeOutQuantity_1_1"], #txtCarTakeOutQuantity_1_1');
                            const chkCar = iDoc.querySelector('input[name="chkCleanCarFlg_1_1"], #chkCleanCarFlg_1_1');

                            if (volInput1) volInput1.value = cleanVolume;
                            if (volInput2) volInput2.value = cleanVolume;
                            if (chkCar) chkCar.checked = true;

                            const regBtn = Array.from(iDoc.querySelectorAll('input, button, a')).find(
                                el => el.value === '登録' || el.textContent.includes('登録')
                            );

                            if (regBtn) {
                                isFormSubmitted = true;
                                console.log("📄 清掃入力画面の「登録」を自動クリックしました。ダイアログ監視中...");
                                regBtn.click();
                                return;
                            }
                        }

                        if (isFormSubmitted) {
                            const yesBtn = Array.from(iDoc.querySelectorAll('input[type="button"], button, a'))
                                .find(el => el.value === 'はい' || el.textContent.trim() === 'はい' || el.getAttribute('onclick')?.includes('submitForm_Yes'));

                            if (yesBtn) {
                                console.log("🎯 「はい」ボタンを裏で自動クリック！ 清掃登録完了！");
                                yesBtn.click();
                                clearInterval(timer);
                                setTimeout(() => {
                                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                    resolve(true);
                                }, 800);
                                return;
                            }

                            if (typeof iWin.submitForm_Yes === 'function') {
                                console.log("🎯 submitForm_Yes() を裏で実行して登録完了！");
                                iWin.submitForm_Yes();
                                clearInterval(timer);
                                setTimeout(() => {
                                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                    resolve(true);
                                }, 800);
                                return;
                            }
                        }
                    }
                } catch (e) {
                    // スルー
                }

                if (checkCount > 40) {
                    console.warn("⚠️ 自動登録処理タイムアウト");
                    clearInterval(timer);
                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                    resolve(false);
                }
            }, 200);

        } catch (e) {
            console.error("❌ 裏処理エラー:", e);
            resolve(false);
        }
    });
}

/**
 * 🌟 清掃予定（cleanPlan.asp）を裏で自動POSTする関数（DOM完全対応・確定版）
 */
async function triggerCleanPlanAutoSubmit(setUpCode, targetMonth) {
    return new Promise((resolve) => {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const checkNumber = urlParams.get('CheckNumber');
            const workMethodCode = urlParams.get('WorkMethodCode') || '1';
            const setUpHistoryCode = urlParams.get('SetUpHistoryCode') || '1';

            if (!checkNumber) return resolve(false);

            console.log(`🚀 裏で cleanPlan.asp の自動登録を開始... (SetUpCode: ${setUpCode}, 対象月: ${targetMonth}月)`);

            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = `/cleanPlan.asp?CheckNumber=${checkNumber}&WorkMethodCode=${workMethodCode}&SetUpCode=${setUpCode}&SetUpHistoryCode=${setUpHistoryCode}`;
            document.body.appendChild(iframe);

            let Step = 0; // 0:未処理, 1:フォーム入力&登録押し, 2:「はい」押し完了
            let checkCount = 0;

            const checkTimer = setInterval(() => {
                checkCount++;
                try {
                    const iDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const iWin = iframe.contentWindow;

                    if (iDoc && (iDoc.readyState === 'complete' || iDoc.readyState === 'interactive')) {
                        
                        // -------------------------------------------------------------
                        // 【ステップ1】 フォームの入力と「登録」ボタン押下
                        // -------------------------------------------------------------
                        if (Step === 0) {
                            const selWorkDay = iDoc.getElementById('selWorkDay');
                            const txtWorkDate = iDoc.getElementById('txtWorkDate');

                            if (selWorkDay && txtWorkDate) {
                                Step = 1;
                                
                                // 1. 「日付指定 (value='2')」に変更
                                selWorkDay.value = '2';
                                if (typeof selWorkDay.onchange === 'function') selWorkDay.onchange();

                                // 2. 日付文字列を作成して注入 (例: 2026/09/01)
                                const currentYear = new Date().getFullYear();
                                const formattedMonth = String(targetMonth).padStart(2, '0');
                                txtWorkDate.value = `${currentYear}/${formattedMonth}/01`;
                                if (typeof txtWorkDate.onchange === 'function') txtWorkDate.onchange();

                                console.log(`📝 清掃予定を入力しました: 日付指定 ➔ ${txtWorkDate.value}`);

                                // 3. 「登録」の実行（確認ダイアログの表示）
                                if (typeof iWin.submitForm === 'function') {
                                    iWin.submitForm();
                                } else {
                                    const regBtn = iDoc.querySelector('input[onclick*="submitForm"]');
                                    if (regBtn) regBtn.click();
                                }
                                return;
                            }
                        }

                        // -------------------------------------------------------------
                        // 【ステップ2】 確認ダイアログの「はい」を押して最終送信
                        // -------------------------------------------------------------
                        if (Step === 1) {
                            // 関数直接実行か、「はい」ボタンクリックを試みる
                            if (typeof iWin.submitForm_Yes === 'function') {
                                Step = 2;
                                console.log("🎯 裏画面の submitForm_Yes() を実行して最終登録！");
                                iWin.submitForm_Yes();
                            } else {
                                const yesBtn = iDoc.querySelector('input[onclick*="submitForm_Yes"]');
                                if (yesBtn) {
                                    Step = 2;
                                    console.log("🎯 裏画面の「はい」ボタンをクリックして最終登録！");
                                    yesBtn.click();
                                }
                            }

                            if (Step === 2) {
                                clearInterval(checkTimer);
                                console.log("✅ 清掃予定の裏登録が正常完了しました！");
                                setTimeout(() => {
                                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                    resolve(true);
                                }, 1200);
                                return;
                            }
                        }
                    }
                } catch (e) {
                    // スルー
                }

                // 10秒タイムアウト保護
                if (checkCount > 50) {
                    clearInterval(checkTimer);
                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                    console.warn("⚠️ 清掃予定の自動登録がタイムアウトしました。");
                    resolve(false);
                }
            }, 200);

        } catch (e) {
            console.error("❌ 送信エラー:", e);
            resolve(false);
        }
    });
}

function setupDialogHook(setUpCode, inputEl) {
    const bindHook = () => {
        const regBtn = document.querySelector('input.btn-blue') || 
                       Array.from(document.querySelectorAll('input, button')).find(el => el.value === '登録' || el.textContent.trim() === '登録');

        if (!regBtn || regBtn.dataset.cleanHookSet) return;
        regBtn.dataset.cleanHookSet = "true";

        regBtn.addEventListener('click', () => {
            let checkCount = 0;
            const timer = setInterval(() => {
                checkCount++;
                const yesBtn = Array.from(document.querySelectorAll('input[type="button"], button')).find(el => 
                    el.value === 'はい' || el.textContent.trim() === 'はい' || (el.getAttribute('onclick') && el.getAttribute('onclick').includes('chkWrite'))
                );

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

                        // -------------------------------------------------------------
                        // 🔍 1. 条件判定（実績か？ 予定か？ 何もなし＝通常点検か？）
                        // -------------------------------------------------------------
                        const volumePanel = document.getElementById('clean-volume-panel');
                        const volumeInput = document.getElementById('input-clean-volume');
                        const isPanelVisible = volumePanel && volumePanel.style.display !== 'none';
                        const cleanVolume = (isPanelVisible && volumeInput) ? volumeInput.value.trim() : '';

                        const monthInput = document.getElementById('selCleanMonth') || document.querySelector('input[name="selCleanMonth"], select[name="selCleanMonth"]');
        
        let targetMonth = monthInput ? monthInput.value : '';
        if (!targetMonth) {
            const activeBtn = document.querySelector('.btn-clean-m[style*="rgb(2, 132, 199)"], .btn-clean-m[style*="#0284c7"]') 
                           || document.querySelector('#clean-month-picker-inline .btn-clean-m.active')
                           || document.querySelector('.btn-month.active');
            
            if (activeBtn) {
                targetMonth = activeBtn.getAttribute('data-month') || activeBtn.textContent.replace('月', '').trim();
            }
        }

                        // -------------------------------------------------------------
                        // 🔀 2. 完全分離された分岐処理（ゆっくりテスト表示付き！）
                        // -------------------------------------------------------------
                        if (cleanVolume) {
                            // 【ルート1：清掃実績の自動登録 (clean.asp)】
                            showStatusToast(`🔍 [ステップ 1/3]<br>顧客ID [${setUpCode}] の未清掃データを検索中...`, '#0284c7');
                            await sleep(1500);

                            const noticeData = {};
                            const targetResult = await fetchCleanNumberFromList(setUpCode);

                            if (targetResult && targetResult.cleanNum) {
                                showStatusToast(`🧹 [ステップ 2/3]<br>清掃実績 (汚泥量 ${cleanVolume}㎥) を自動登録中...`, '#0284c7');
                                await sleep(1500);

                                const isSuccess = await processCleanRegistration(targetResult.cleanNum, cleanVolume);
                                if (isSuccess) {
                                    noticeData.cleanVolume = cleanVolume;
                                    noticeData.setUpCode = setUpCode;
                                    noticeData.cleanNum = targetResult.cleanNum;
                                    noticeData.customerName = targetResult.customerName || '';
                                    sessionStorage.setItem('clean_autolink_target', JSON.stringify(noticeData));

                                    showStatusToast(`✅ [ステップ 3/3]<br>清掃実績の登録成功！点検票を送信中...`, '#16a34a');
                                    await sleep(1200);
                                } else {
                                    sessionStorage.removeItem('clean_autolink_target');
                                }
                            } else {
                                sessionStorage.removeItem('clean_autolink_target');
                                showStatusToast(`⚠️ 未清掃枠が見つからなかったためスキップします`, '#eab308');
                                await sleep(1500);
                                alert(`⚠️ 浄化槽番号 [${setUpCode}] の「未清掃」データが見つからなかったため、清掃実績の自動登録をスキップしました。\n（※点検登録のみ実行されます）`);
                            }

                        } else if (targetMonth && typeof triggerCleanPlanAutoSubmit === 'function') {
                            // 【ルート2：清掃予定の自動登録 (cleanPlan.asp)】
                            showStatusToast(`📅 [ステップ 1/2]<br>次回清掃時期 (${targetMonth}月) の予約を自動登録中...`, '#0284c7');
                            await sleep(1500);

                            const isPlanSuccess = await triggerCleanPlanAutoSubmit(setUpCode, targetMonth);
                            if (isPlanSuccess) {
                                const planNoticeData = { setUpCode: setUpCode, targetMonth: targetMonth };
                                sessionStorage.setItem('clean_plan_autolink_target', JSON.stringify(planNoticeData));

                                showStatusToast(`✅ [ステップ 2/2]<br>清掃予定の作成成功！点検票を送信中...`, '#16a34a');
                                await sleep(1200);
                            } else {
                                sessionStorage.removeItem('clean_plan_autolink_target');
                            }

                        } else {
                            // 【ルート3：通常点検（裏処理一切なし！）】
                            showStatusToast(`📝 [通常点検]<br>清掃連動なし。点検票のみ送信します...`, '#64748b');
                            await sleep(1000);
                            sessionStorage.removeItem('clean_autolink_target');
                            sessionStorage.removeItem('clean_plan_autolink_target');
                        }

                        hideStatusToast();

                        // -------------------------------------------------------------
                        // 📝 3. 本来の点検票書き込み処理を実行
                        // -------------------------------------------------------------
                        if (originalOnClickStr) {
                            try {
                                new Function(originalOnClickStr)();
                            } catch (err) {
                                const form = document.querySelector('form');
                                if (form && typeof form.submit === 'function') form.submit();
                            }
                        } else {
                            const form = document.querySelector('form');
                            if (form && typeof form.submit === 'function') form.submit();
                        }
                    });
                }

                if (checkCount > 30) clearInterval(timer);
            }, 100);
        });
    };

    bindHook();
    setInterval(bindHook, 500);
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
        <div style="display: flex; align-items: flex-end; gap: 6px; width: 100%;">
            <div style="display: flex; gap: 4px; flex: 3;">
                <button type="button" class="btn-vol" data-vol="1" style="flex:1; padding:10px 0; background:#fff; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; font-weight:600; color:#334155; cursor:pointer; transition:all 0.15s ease;">1㎥</button>
                <button type="button" class="btn-vol" data-vol="1.5" style="flex:1.2; padding:10px 0; background:#fff; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; font-weight:600; color:#334155; cursor:pointer; transition:all 0.15s ease;">1.5㎥</button>
                <button type="button" class="btn-vol" data-vol="2" style="flex:1; padding:10px 0; background:#fff; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; font-weight:600; color:#334155; cursor:pointer; transition:all 0.15s ease;">2㎥</button>
                <button type="button" class="btn-vol" data-vol="3" style="flex:1; padding:10px 0; background:#fff; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; font-weight:600; color:#334155; cursor:pointer; transition:all 0.15s ease;">3㎥</button>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; flex: 1.2;">
                <span style="font-size: 10px; font-weight: 700; color: #64748b; margin-bottom: 2px;">直接入力</span>
                <div style="display: flex; align-items: center; gap: 2px; width: 100%;">
                    <input type="text" id="input-clean-volume" class="inputitem" placeholder="他" 
                           onclick="if(typeof display10KeyPad === 'function') display10KeyPad(this);" 
                           style="width: 100%; min-width: 0; padding: 8px 2px; border: 1px solid #cbd5e1; border-radius: 6px; text-align: center; font-size: 14px; font-weight: 700; background: #fff; box-sizing: border-box; height: 39px;">
                    <span style="font-size: 12px; font-weight: 700; color: #334155; white-space: nowrap;">㎥</span>
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

    const setAllChamberCleanStatus = (targetType) => {
        const allSelects = Array.from(document.querySelectorAll('select'));
        
        allSelects.forEach(select => {
            const options = Array.from(select.options);
            const hasCleanOptions = options.some(o => o.text.trim() === '不要') && 
                                    options.some(o => o.text.trim() === '要') && 
                                    options.some(o => o.text.trim() === '実施');

            if (hasCleanOptions) {
                const parentText = select.closest('td, div, tr')?.textContent || '';
                if (parentText.includes('清掃')) {
                    let targetOpt = null;
                    if (targetType === '実施') {
                        targetOpt = options.find(o => o.text.trim() === '実施');
                    } else if (targetType === '要') {
                        targetOpt = options.find(o => o.text.trim() === '要');
                    } else if (targetType === '不要') {
                        targetOpt = options.find(o => o.text.trim() === '不要');
                    }

                    if (targetOpt && select.value !== targetOpt.value) {
                        select.value = targetOpt.value;
                        if (typeof select.onchange === 'function') select.onchange();
                        console.log(`🧹 [自動連動] 槽の清掃項目 (${select.id || select.name}) を 「${targetType}」 に変更しました。`);
                    }
                }
            }
        });
    };

    let lastStatusState = '';

    const updatePanelStatus = () => {
        let activeSelect = null;
        let isNeedClean = false;

        const allSelects = Array.from(document.querySelectorAll('select'));

        allSelects.forEach(sel => {
            if (sel.selectedIndex >= 0) {
                const optText = sel.options[sel.selectedIndex]?.text.trim() || '';
                const val = sel.value || '';

                const isDetailMatch = (optText.includes('引抜') || optText.includes('清掃')) && 
                                      (optText.includes('実施') || optText.includes('全量') || val === '1,2') &&
                                      !optText.includes('次回') && !optText.includes('必要') && !optText.includes('至急');

                if (isDetailMatch) {
                    activeSelect = sel;
                }

                if (optText.includes('引き抜きが必要') || optText.includes('引抜が必要') || optText.includes('清掃が必要')) {
                    isNeedClean = true;
                }
            }
        });

        let currentStatusState = '不要';
        if (activeSelect) {
            currentStatusState = '実施';
        } else if (isNeedClean) {
            currentStatusState = '要';
        }

        if (lastStatusState !== currentStatusState) {
            setAllChamberCleanStatus(currentStatusState);
            lastStatusState = currentStatusState;
        }

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
                        if (btn2) btn2.click();
                    }
                }
            }
        } else {
            if (panel.style.display !== 'none') {
                panel.style.display = 'none';
                if (volumeInput) volumeInput.value = '';
                volBtns.forEach(b => {
                    b.style.background = '#ffffff';
                    b.style.color = '#334155';
                    b.style.borderColor = '#cbd5e1';
                    b.style.fontWeight = '600';
                    b.style.boxShadow = 'none';
                });
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
 * 🌟 完了画面で自動登録成功カード（清掃実績 ＆ 清掃予定）を表示する関数
 */
function renderCompletionNotice() {
    try {
        const checkNumEl = document.body;
        if (!checkNumEl) return;

        // 1. 清掃実績（回収側）のカード表示チェック
        const rawTarget = sessionStorage.getItem('clean_autolink_target');
        if (rawTarget) {
            const data = JSON.parse(rawTarget);
            sessionStorage.removeItem('clean_autolink_target');

            const box = document.createElement('div');
            box.style.cssText = `
                margin: 15px auto;
                padding: 12px 16px;
                background: #f0fdf4;
                border: 1px solid #86efac;
                border-radius: 10px;
                max-width: 90%;
                box-shadow: 0 2px 5px rgba(0,0,0,0.05);
                text-align: center;
                font-family: sans-serif;
            `;
            box.innerHTML = `
                <div style="color: #166534; font-weight: bold; font-size: 14px; margin-bottom: 4px;">
                    🧹 清掃実績を自動登録しました
                </div>
                <div style="color: #15803d; font-size: 12px;">
                    浄化槽 : <strong>${data.setUpCode || ''}</strong> ${data.customerName ? `(${data.customerName})` : ''}
                </div>
                <div style="color: #64748b; font-size: 11px; margin-top: 4px;">
                    清掃予約 : <span style="color:#0284c7; font-weight:bold;">No.${data.cleanNum || ''}</span> ｜ 汚泥量 : <strong>${data.cleanVolume || ''}㎥</strong>
                </div>
            `;

            const targetPos = document.querySelector('.title, h1, h2, div[style*="font-size"]') || document.body.firstChild;
            if (targetPos && targetPos.parentNode) {
                targetPos.parentNode.insertBefore(box, targetPos.nextSibling);
            }
        }

        // 2. 清掃予定（送信側）のカード表示チェック
        const rawPlanTarget = sessionStorage.getItem('clean_plan_autolink_target');
        if (rawPlanTarget) {
            const planData = JSON.parse(rawPlanTarget);
            sessionStorage.removeItem('clean_plan_autolink_target');

            const planBox = document.createElement('div');
            planBox.style.cssText = `
                margin: 10px auto;
                padding: 12px 16px;
                background: #eff6ff;
                border: 1px solid #93c5fd;
                border-radius: 10px;
                max-width: 90%;
                box-shadow: 0 2px 5px rgba(0,0,0,0.05);
                text-align: center;
                font-family: sans-serif;
            `;
            planBox.innerHTML = `
                <div style="color: #1e40af; font-weight: bold; font-size: 14px; margin-bottom: 4px;">
                    📅 清掃予定を自動登録しました！
                </div>
                <div style="color: #1d4ed8; font-size: 12px;">
                    浄化槽 : <strong>${planData.setUpCode || ''}</strong> ｜ 次回清掃時期 : <strong style="color:#0284c7;">${planData.targetMonth || ''}月</strong>
                </div>
            `;

            const targetPos = document.querySelector('.title, h1, h2, div[style*="font-size"]') || document.body.firstChild;
            if (targetPos && targetPos.parentNode) {
                targetPos.parentNode.insertBefore(planBox, targetPos.nextSibling);
            }
        }

    } catch (e) {
        console.error("完了通知表示エラー:", e);
    }
}