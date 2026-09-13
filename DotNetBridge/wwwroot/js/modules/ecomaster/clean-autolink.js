// wwwroot/js/modules/clean-autolink.js

export function initCleanAutoLink() {
    if (window.self !== window.top) return;
    if (window.__cleanAutoLinkInitialized) return;

    const currentPath = window.location.pathname.toLowerCase();

    // 1. 点検メニュー画面 ＆ 清掃メニュー画面での顧客名自動キャッチ
    if (currentPath.includes("menucheck.asp") || currentPath.includes("menuclean.asp")) {
        window.__cleanAutoLinkInitialized = true;
        captureCustomerNameFromMenu();
        return;
    }

    // 2. 点検登録完了画面での完了通知表示
    if (currentPath.includes("writecheck.asp")) {
        window.__cleanAutoLinkInitialized = true;
        renderCompletionNotice();
        return;
    }

    // 3. 点検入力画面の処理
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
 * 🌟 安全待機用ウェイト関数 (指定ミリ秒待機)
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 🌟 近未来風・スタイリッシュステータストーストを表示するUI関数
 */
function showStatusToast(title, subtext = '', type = 'loading') {
    let toast = document.getElementById('clean-autolink-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'clean-autolink-toast';
        toast.style.cssText = `
            position: fixed;
            top: 40%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.9);
            z-index: 999999;
            padding: 18px 24px;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.15) inset;
            text-align: center;
            min-width: 260px;
            max-width: 85%;
            pointer-events: none;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            opacity: 0;
            backdrop-filter: blur(10px);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        document.body.appendChild(toast);
    }

    if (!document.getElementById('autolink-spin-style')) {
        const style = document.createElement('style');
        style.id = 'autolink-spin-style';
        style.textContent = `@keyframes autolink-spin { to { transform: rotate(360deg); } }`;
        document.head.appendChild(style);
    }

    let bg = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
    let iconHtml = `<div style="width:24px;height:24px;border:3px solid rgba(255,255,255,0.2);border-top-color:#38bdf8;border-radius:50%;animation:autolink-spin 0.75s linear infinite;margin:0 auto 10px;"></div>`;

    if (type === 'success') {
        bg = 'linear-gradient(135deg, #064e3b 0%, #047857 100%)';
        iconHtml = `<div style="font-size:24px;margin-bottom:6px;">✨</div>`;
    } else if (type === 'warning') {
        bg = 'linear-gradient(135deg, #78350f 0%, #b45309 100%)';
        iconHtml = `<div style="font-size:24px;margin-bottom:6px;">⚠️</div>`;
    }

    toast.style.background = bg;
    toast.innerHTML = `
        ${iconHtml}
        <div style="color: #ffffff; font-size: 15px; font-weight: 700; letter-spacing: 0.02em;">${title}</div>
        ${subtext ? `<div style="color: rgba(255,255,255,0.8); font-size: 12px; margin-top: 4px; font-weight: 500;">${subtext}</div>` : ''}
    `;

    toast.style.display = 'block';
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translate(-50%, -50%) scale(1)';
    });
}

function hideStatusToast() {
    const toast = document.getElementById('clean-autolink-toast');
    if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -50%) scale(0.95)';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 250);
    }
}

/**
 * 🌟 menuCheck.asp（点検メニュー）および menuClean.asp（清掃メニュー）から顧客名を自動取得して保存する関数
 */
function captureCustomerNameFromMenu() {
    try {
        const centerDiv = document.querySelector('center div[style*="padding-top"]');
        if (centerDiv) {
            let name = centerDiv.childNodes[0]?.textContent || centerDiv.textContent || '';
            name = name.replace(/\s+/g, ' ').replace('様', '').trim();
            if (name) {
                sessionStorage.setItem('clean_autolink_customer_name', name);
                console.log(`👤 メニュー画面から顧客名を保存しました: 【 ${name} 】`);
            }
        }
    } catch (e) {
        console.error("❌ 顧客名取得エラー:", e);
    }
}

/**
 * 隠し iframe で「未清掃」POST検索を実行し、指定された SetUpCode と一致する CleanNumber と顧客名を抜く関数
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

                        if (!isWaitingForPost && (txtSearch || selStatus)) {
                            isWaitingForPost = true;

                            if (selStatus) {
                                selStatus.value = '0';
                                if (typeof selStatus.onchange === 'function') selStatus.onchange();
                            }

                            if (selDate) {
                                const options = Array.from(selDate.options);
                                const broadOpt = options.find(o => o.text.includes('以降') || o.text.includes('全') || o.text.includes('すべて')) || options[options.length - 1];
                                if (broadOpt) {
                                    selDate.value = broadOpt.value;
                                }
                                if (typeof selDate.onchange === 'function') selDate.onchange();
                            }

                            if (txtSearch) {
                                txtSearch.value = '';
                                txtSearch.value = setUpCode;
                            }

                            console.log(`🔎 一覧検索を実行中 (ID: ${setUpCode})...`);

                            if (typeof iWin.readList === 'function') {
                                iWin.readList();
                            } else {
                                const btnSearch = iDoc.querySelector('input[value*="検索"], button[onclick*="readList"]');
                                if (btnSearch) btnSearch.click();
                            }
                            return;
                        }

                        if (isWaitingForPost && checkCount > 2) {
                            const taskItems = Array.from(iDoc.querySelectorAll('.taskItem'));

                            const targetItem = taskItems.find(item => {
                                const jksNumEl = item.querySelector('.jksNum');
                                const txt = jksNumEl ? jksNumEl.textContent : item.textContent;
                                return txt.includes(setUpCode);
                            });

                            if (targetItem) {
                                const linkEl = targetItem.querySelector('a.link-area, a[href*="CleanNumber"]');
                                const href = linkEl ? linkEl.getAttribute('href') : '';
                                const match = href.match(/CleanNumber=(\d+)/i);

                                const jksEl = targetItem.querySelector('.jksNum');
                                let nameText = jksEl ? jksEl.textContent : targetItem.textContent;
                                nameText = nameText
                                    .replace(setUpCode, '')
                                    .replace(/\+付箋/g, '')
                                    .replace(/\d{4}\/\d{2}\/\d{2}/g, '')
                                    .replace(/\d{4}\/\d{2}/g, '')
                                    .replace(/\s+/g, ' ')
                                    .trim();

                                if (match && match[1]) {
                                    const cleanNum = match[1];
                                    console.log(`✨【見つかりました！】 顧客ID [${setUpCode}] (顧客名: ${nameText}) の CleanNumber 【 ${cleanNum} 】 を抽出完了！`);
                                    clearInterval(checkTimer);
                                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                    
                                    resolve({
                                        cleanNum: cleanNum,
                                        customerName: nameText
                                    });
                                    return;
                                }
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
 * 隠し iframe 内で「清掃入力画面 (clean.asp)」を開き、静かにフォーム送信を完走させる関数（ASP読み込み完了待機版）
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

                            const triggerSubmitAndWait = () => {
                                clearInterval(timer);
                                new Promise((res) => {
                                    iframe.onload = () => {
                                        console.log("🎯 ASPサーバーからの処理完了レスポンスを受信しました！");
                                        res();
                                    };

                                    if (yesBtn) {
                                        yesBtn.click();
                                    } else if (typeof iWin.submitForm_Yes === 'function') {
                                        iWin.submitForm_Yes();
                                    }
                                }).then(() => {
                                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                    resolve(true);
                                });
                            };

                            if (yesBtn || typeof iWin.submitForm_Yes === 'function') {
                                console.log("🎯 「はい」を実行し、ASPサーバーのPOST応答を待機します...");
                                triggerSubmitAndWait();
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
 * 🌟 清掃予定（cleanPlan.asp）を裏で自動POSTする関数（ASP読み込み完了待機版）
 */
async function triggerCleanPlanAutoSubmit(setUpCode, targetMonth) {
    return new Promise((resolve) => {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const checkNumber = urlParams.get('CheckNumber');
            const workMethodCode = urlParams.get('WorkMethodCode') || '1';
            const setUpHistoryCode = urlParams.get('SetUpHistoryCode') || '1';

            if (!checkNumber) return resolve(null);

            console.log(`🚀 裏で cleanPlan.asp の自動登録を開始... (SetUpCode: ${setUpCode}, 対象月: ${targetMonth}月)`);

            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = `/cleanPlan.asp?CheckNumber=${checkNumber}&WorkMethodCode=${workMethodCode}&SetUpCode=${setUpCode}&SetUpHistoryCode=${setUpHistoryCode}`;
            document.body.appendChild(iframe);

            let Step = 0;
            let checkCount = 0;
            let registeredDateStr = '';

            const checkTimer = setInterval(() => {
                checkCount++;
                try {
                    const iDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const iWin = iframe.contentWindow;

                    if (iDoc && (iDoc.readyState === 'complete' || iDoc.readyState === 'interactive')) {
                        
                        if (Step === 0) {
                            const selWorkDay = iDoc.getElementById('selWorkDay');
                            const txtWorkDate = iDoc.getElementById('txtWorkDate');

                            if (selWorkDay && txtWorkDate) {
                                Step = 1;
                                
                                selWorkDay.value = '2';
                                if (typeof selWorkDay.onchange === 'function') selWorkDay.onchange();

                                const now = new Date();
                                const currentYear = now.getFullYear();
                                const currentMonth = now.getMonth() + 1;
                                const targetM = parseInt(targetMonth, 10);
                                let targetYear = currentYear;

                                if (targetM < currentMonth) {
                                    targetYear = currentYear + 1;
                                } else if (targetM === currentMonth) {
                                    const isThisYear = confirm(`選択された [ ${targetM}月 ] は今月（${currentYear}年${targetM}月）の登録でよろしいですか？\n\n・[ OK ] ➔ 今月（${currentYear}年${targetM}月）\n・[ キャンセル ] ➔ 1年後（${currentYear + 1}年${targetM}月）`);
                                    if (!isThisYear) {
                                        targetYear = currentYear + 1;
                                    }
                                }

                                const formattedMonth = String(targetM).padStart(2, '0');
                                registeredDateStr = `${targetYear}/${formattedMonth}/01`;
                                txtWorkDate.value = registeredDateStr;
                                if (typeof txtWorkDate.onchange === 'function') txtWorkDate.onchange();

                                console.log(`📝 清掃予定を入力しました: 日付指定 ➔ ${txtWorkDate.value}`);

                                if (typeof iWin.submitForm === 'function') {
                                    iWin.submitForm();
                                } else {
                                    const regBtn = iDoc.querySelector('input[onclick*="submitForm"]');
                                    if (regBtn) regBtn.click();
                                }
                                return;
                            }
                        }

                        if (Step === 1) {
                            const yesBtn = iDoc.querySelector('input[onclick*="submitForm_Yes"]');
                            
                            const triggerPlanSubmitAndWait = () => {
                                Step = 2;
                                clearInterval(checkTimer);
                                new Promise((res) => {
                                    iframe.onload = () => {
                                        console.log("✅ 清掃予定の裏登録（ASPレスポンス）が正常完了しました！");
                                        res();
                                    };

                                    if (typeof iWin.submitForm_Yes === 'function') {
                                        iWin.submitForm_Yes();
                                    } else if (yesBtn) {
                                        yesBtn.click();
                                    }
                                }).then(() => {
                                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                    resolve({ success: true, targetDate: registeredDateStr });
                                });
                            };

                            if (typeof iWin.submitForm_Yes === 'function' || yesBtn) {
                                console.log("🎯 清掃予定の「はい」を実行し、ASPのPOST応答を待機します...");
                                triggerPlanSubmitAndWait();
                                return;
                            }
                        }
                    }
                } catch (e) {
                    // スルー
                }

                if (checkCount > 50) {
                    clearInterval(checkTimer);
                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                    console.warn("⚠️ 清掃予定の自動登録がタイムアウトしました。");
                    resolve(null);
                }
            }, 200);

        } catch (e) {
            console.error("❌ 送信エラー:", e);
            resolve(null);
        }
    });
}

/**
 * 🌟 listClean.asp の検索条件（日付範囲を「当月: value=0」、検索文字を空）へ戻す初期化関数
 */
async function resetListCleanToDefault() {
    return new Promise((resolve) => {
        try {
            console.log("🔄 listClean.asp の検索ステータスを「当月(value=0)」へ復元中...");

            const old = document.getElementById('clean-reset-iframe');
            if (old) old.remove();

            const iframe = document.createElement('iframe');
            iframe.id = 'clean-reset-iframe';
            iframe.style.display = 'none';
            iframe.src = '/listClean.asp';
            document.body.appendChild(iframe);

            let isResetDone = false;
            let checkCount = 0;

            const timer = setInterval(() => {
                checkCount++;
                try {
                    const iDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const iWin = iframe.contentWindow;

                    if (iDoc && (iDoc.readyState === 'complete' || iDoc.readyState === 'interactive')) {
                        const txtSearch = iDoc.getElementById('txtSearchWord') || iDoc.querySelector('input[type="text"]');
                        const selDate = iDoc.getElementById('selDateRange');

                        if (!isResetDone && (txtSearch || selDate)) {
                            isResetDone = true;

                            // 1. 日付を「当月(value="0")」へセット
                            if (selDate) {
                                selDate.value = '0';
                                if (typeof selDate.onchange === 'function') selDate.onchange();
                            }

                            // 2. 検索ワードをクリア
                            if (txtSearch) {
                                txtSearch.value = '';
                            }

                            // 3. 検索実行してASPセッション更新
                            if (typeof iWin.readList === 'function') {
                                iWin.readList();
                            } else {
                                const btnSearch = iDoc.querySelector('input[value*="検索"], button[onclick*="readList"]');
                                if (btnSearch) btnSearch.click();
                            }

                            // 4. レスポンス完了を待ってクリア終了
                            iframe.onload = () => {
                                clearInterval(timer);
                                if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                console.log("✨ listClean.asp のステータス初期化が完了しました！");
                                resolve(true);
                            };
                            return;
                        }
                    }
                } catch (e) {
                    // スルー
                }

                if (checkCount > 25) {
                    clearInterval(timer);
                    if (document.body.contains(iframe)) document.body.removeChild(iframe);
                    resolve(false);
                }
            }, 200);

        } catch (e) {
            console.error("❌ リセット処理エラー:", e);
            resolve(false);
        }
    });
}

// -------------------------------------------------------------
// 🔄 セレクトボックス連動によるUI相互クリア処理
// -------------------------------------------------------------
document.addEventListener('change', (e) => {
    const target = e.target;
    if (!target || target.tagName !== 'SELECT') return;

    const selectedText = target.options[target.selectedIndex]?.text || '';

    if (selectedText.includes('汚泥引抜清掃実施しました')) {
        document.querySelectorAll('.btn-clean-m, [data-month]').forEach(btn => {
            btn.classList.remove('active');
            btn.style.background = '';
            btn.style.color = '';
        });

        document.querySelectorAll('select').forEach(sel => {
            if (sel !== target && Array.from(sel.options).some(o => o.text.includes('次回点検時汚泥引き抜きが必要'))) {
                sel.selectedIndex = 0;
            }
        });
        console.log("🧹 実施が選ばれたため、予定（月）選択をリセットしました。");
    }

    if (selectedText.includes('次回点検時汚泥引き抜きが必要です')) {
        const inputVolume = document.getElementById('input-clean-volume');
        if (inputVolume) inputVolume.value = '';

        document.querySelectorAll('.btn-volume, [data-volume]').forEach(btn => {
            btn.classList.remove('active');
            btn.style.background = '';
            btn.style.color = '';
        });

        document.querySelectorAll('select').forEach(sel => {
            if (sel !== target && Array.from(sel.options).some(o => o.text.includes('汚泥引抜清掃実施しました'))) {
                sel.selectedIndex = 0;
            }
        });
        console.log("📅 予定が選ばれたため、実施（汚泥量）入力をリセットしました。");
    }
});

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

                        const storedCustomerName = sessionStorage.getItem('clean_autolink_customer_name') || '';

                        // -------------------------------------------------------------
                        // 🔍 1. 条件判定
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

                        const hasValidVolume = cleanVolume && !isNaN(parseFloat(cleanVolume)) && parseFloat(cleanVolume) > 0;

                        // -------------------------------------------------------------
                        // 🔀 2. 分岐処理（トースト表示 ＋ ASPリアルタイム応答待機）
                        // -------------------------------------------------------------
                        if (hasValidVolume) {
                            // 【ルート1：清掃実績の自動登録 (clean.asp)】
                            showStatusToast(`未清掃データを検索中...`, `顧客ID : ${setUpCode}`, 'loading');

                            const targetResult = await fetchCleanNumberFromList(setUpCode);

                            if (targetResult && targetResult.cleanNum) {
                                showStatusToast(`清掃実績を自動登録中...`, `汚泥量 : ${cleanVolume} ㎥`, 'loading');

                                const isSuccess = await processCleanRegistration(targetResult.cleanNum, cleanVolume);
                                if (isSuccess) {
                                    const noticeData = {
                                        cleanVolume: cleanVolume,
                                        setUpCode: setUpCode,
                                        customerName: targetResult.customerName || storedCustomerName
                                    };
                                    sessionStorage.setItem('clean_autolink_target', JSON.stringify(noticeData));

                                    // 🧹 登録成功後、listClean.asp の検索条件（当月: 0, ワードクリア）を復元
                                    showStatusToast(`検索ステータスをリセット中...`, `初期状態に戻しています`, 'loading');
                                    await resetListCleanToDefault();

                                    showStatusToast(`清掃実績の登録完了！`, `点検票を送信中...`, 'success');
                                    await sleep(250);
                                } else {
                                    sessionStorage.removeItem('clean_autolink_target');
                                }
                            } else {
                                sessionStorage.removeItem('clean_autolink_target');
                                hideStatusToast();
                                alert(`⚠️ 浄化槽番号 [${setUpCode}] の「未清掃」データが見つからなかったため、清掃実績の自動登録をスキップしました。\n（※点検登録のみ実行されます）`);
                            }

                        } else if (targetMonth && typeof triggerCleanPlanAutoSubmit === 'function') {
                            // 【ルート2：清掃予定の自動登録 (cleanPlan.asp)】
                            showStatusToast(`清掃予定を自動登録中...`, `次回希望 : ${targetMonth}月度`, 'loading');

                            const planResult = await triggerCleanPlanAutoSubmit(setUpCode, targetMonth);
                            if (planResult && planResult.success) {
                                const planNoticeData = { 
                                    setUpCode: setUpCode, 
                                    targetMonth: targetMonth,
                                    targetDate: planResult.targetDate || '',
                                    customerName: storedCustomerName
                                };
                                sessionStorage.setItem('clean_plan_autolink_target', JSON.stringify(planNoticeData));
                                showStatusToast(`清掃予定の作成完了！`, `点検票を送信中...`, 'success');
                                await sleep(250);
                            } else {
                                sessionStorage.removeItem('clean_plan_autolink_target');
                            }

                        } else {
                            // 【ルート3：通常点検】
                            sessionStorage.removeItem('clean_autolink_target');
                            sessionStorage.removeItem('clean_plan_autolink_target');
                        }

                        hideStatusToast();

                        // 📝 3. 本来の点検票書き込み処理を実行
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
 * 🌟 完了画面で自動登録成功カード（清掃予定 ＆ 清掃実施）を表示する関数
 */
function renderCompletionNotice() {
    try {
        const currentPath = window.location.pathname.toLowerCase();
        if (!currentPath.includes("writecheck.asp")) return;

        // 1. 清掃予定（送信側）のカード表示
        const rawPlanTarget = sessionStorage.getItem('clean_plan_autolink_target');
        if (rawPlanTarget) {
            const planData = JSON.parse(rawPlanTarget);
            sessionStorage.removeItem('clean_plan_autolink_target');

            const planBox = document.createElement('div');
            planBox.style.cssText = `
                margin: 15px auto;
                padding: 14px 18px;
                background: #eff6ff;
                border: 1px solid #93c5fd;
                border-radius: 12px;
                max-width: 90%;
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                text-align: center;
                font-family: sans-serif;
            `;

            const nameDisplay = planData.customerName ? `${planData.customerName} 様 ` : '';
            const dateDisplay = planData.targetDate ? planData.targetDate : `${planData.targetMonth}月度`;

            planBox.innerHTML = `
                <div style="color: #1e40af; font-weight: bold; font-size: 15px; margin-bottom: 6px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                    <span>📅</span> 清掃予定を自動登録しました
                </div>
                <div style="color: #1e3a8a; font-size: 13px; font-weight: 600; margin-bottom: 4px;">
                    ${nameDisplay}<span style="color: #475569; font-weight: normal;">(顧客ID: <strong>${planData.setUpCode || ''}</strong>)</span>
                </div>
                <div style="color: #0284c7; font-size: 13px; font-weight: bold; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #cbd5e1;">
                    予定日 : ${dateDisplay}
                </div>
            `;

            insertNoticeBox(planBox);
        }

        // 2. 清掃実施（回収側）のカード表示
        const rawTarget = sessionStorage.getItem('clean_autolink_target');
        if (rawTarget) {
            const data = JSON.parse(rawTarget);
            sessionStorage.removeItem('clean_autolink_target');

            const box = document.createElement('div');
            box.style.cssText = `
                margin: 15px auto;
                padding: 14px 18px;
                background: #f0fdf4;
                border: 1px solid #86efac;
                border-radius: 12px;
                max-width: 90%;
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                text-align: center;
                font-family: sans-serif;
            `;

            const nameDisplay = data.customerName ? `${data.customerName} 様 ` : '';

            box.innerHTML = `
                <div style="color: #166534; font-weight: bold; font-size: 15px; margin-bottom: 6px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                    <span>🧹</span> 清掃実施を自動登録しました
                </div>
                <div style="color: #14532d; font-size: 13px; font-weight: 600; margin-bottom: 4px;">
                    ${nameDisplay}<span style="color: #475569; font-weight: normal;">(顧客ID: <strong>${data.setUpCode || ''}</strong>)</span>
                </div>
                <div style="color: #15803d; font-size: 13px; font-weight: bold; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #cbd5e1;">
                    搬出汚泥量 : <span style="font-size: 16px; color: #16a34a;">${data.cleanVolume || ''} ㎥</span>
                </div>
            `;

            insertNoticeBox(box);
        }

    } catch (e) {
        console.error("完了通知表示エラー:", e);
    }
}

/**
 * 🌟 カード要素を画面内の最適な位置（id="divCondition" の直前など）へ確実に挿入するヘルパー関数
 */
function insertNoticeBox(boxElement) {
    let checkCount = 0;
    const timer = setInterval(() => {
        checkCount++;
        const divCondition = document.getElementById('divCondition');
        if (divCondition && divCondition.parentNode) {
            clearInterval(timer);
            divCondition.parentNode.insertBefore(boxElement, divCondition);
            return;
        }

        const fallbackPos = document.querySelector('center > div, .title, h1, h2');
        if (fallbackPos && fallbackPos.parentNode) {
            clearInterval(timer);
            fallbackPos.parentNode.insertBefore(boxElement, fallbackPos.nextSibling);
            return;
        }

        if (checkCount > 15) {
            clearInterval(timer);
            document.body.appendChild(boxElement);
        }
    }, 100);
}