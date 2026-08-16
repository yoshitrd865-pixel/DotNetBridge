/**
 * 物理カード再現・クラウド付箋くん (DotNetBridge 内製化モジュール v52.0)
 */

export function initFusenKun() {
    if (window.fusenKunStarted) return;
    window.fusenKunStarted = true;

    let host = window.location.hostname.replace(/^www\./, '');
    let pathParts = window.location.pathname.split('/').filter(p => p.length > 0);
    let companyPath = pathParts.length > 0 ? pathParts[0] : 'root';

    let cleanDomain = host + '_' + companyPath;
    
    // ★ 内製化した C# バックエンド API エンドポイント
    const API_URL = '/api/fusen?domain=' + cleanDomain;

    let fusenDataCache = { active: {}, history: [] };
    let isFetching = false;
    let currentTab = 'active';

    const isMobileMode = (typeof window.AndroidGPS !== 'undefined') || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.location.pathname.includes('mobile');
    const isPcMode = !isMobileMode;

    function isMobileDetailScreen() {
        const activePage = document.querySelector('.ui-page-active') || document.body;
        const hasDetailTabs = activePage.querySelector('.ui-navbar') || activePage.innerText.includes('基本情報') || activePage.innerText.includes('管理者情報');
        const hasForm = activePage.querySelector('form') || activePage.querySelectorAll('input[type="text"]').length >= 3;
        const hasListTitle = activePage.innerText.includes('点検一覧') || activePage.innerText.includes('設置先一覧') || activePage.innerText.includes('予定一覧') || activePage.innerText.includes('清掃一覧');

        if (hasListTitle && !hasDetailTabs) {
            return false;
        }
        return hasDetailTabs || hasForm;
    }

    function getCustomerAndLocationInfo(targetId) {
        let name = '';
        let city = '';
        const activePage = document.querySelector('.ui-page-active') || document.body;
        const fullText = activePage.innerText || '';

        const invalidNames = ['＋', '付箋', '貼る', 'このお客様', '編集', '削除', 'キャンセル', '保存', '点検', '基本情報', '管理者情報', '請求先情報', '点検メニュー'];
        const isValidName = (txt) => {
            if (!txt) return false;
            for (let word of invalidNames) {
                if (txt.includes(word)) return false;
            }
            return txt.length >= 1 && txt.length < 30;
        };

        const centerDivs = activePage.querySelectorAll('center > div, div.pagetitle + center div');
        for (let div of centerDivs) {
            let rawTxt = (div.innerText || div.textContent || '').split('\n')[0].replace(/"/g, '').trim();
            if (isValidName(rawTxt)) {
                name = rawTxt;
                break;
            }
        }

        if (!name) {
            const taskItems = activePage.querySelectorAll('.taskItem, li, tr');
            for (let item of taskItems) {
                const jksEl = item.querySelector('.jksNum');
                const nameEl = item.querySelector('.Name, .jksName, .name');
                const addrEl = item.querySelector('.address');

                let itemId = '';
                if (jksEl) {
                    const match = jksEl.innerText.trim().match(/^([0-9]{1,8})/);
                    if (match) itemId = match[1];
                }

                if ((targetId && itemId === targetId) || (!targetId && nameEl)) {
                    if (nameEl) {
                        let cleanTxt = nameEl.innerText.replace(/＋付箋/g, '').trim();
                        if (isValidName(cleanTxt)) name = cleanTxt;
                    }
                    if (addrEl) {
                        const addrTxt = addrEl.innerText.trim();
                        const cityMatch = addrTxt.match(/(富士吉田市|都留市|大月市|上野原市|甲府市|甲斐市|笛吹市|山梨市|甲州市|中央市|富士河口湖町|忍野村|山中湖村|鳴沢村|西桂町|身延町|市川三郷町|昭和町)/);
                        if (cityMatch) city = cityMatch[1];
                    }
                    if (name) break;
                }
            }
        }

        if (!name) {
            const nameEls = activePage.querySelectorAll('.Name, .jksName, .customerName, .name');
            for (let el of nameEls) {
                const txt = el.innerText.replace(/＋付箋/g, '').trim();
                if (isValidName(txt)) {
                    name = txt;
                    break;
                }
            }
        }

        if (!city) {
            const cityMatch = fullText.match(/(富士吉田市|都留市|大月市|上野原市|甲府市|甲斐市|笛吹市|山梨市|甲州市|中央市|富士河口湖町|忍野村|山中湖村|鳴沢村|西桂町|身延町|市川三郷町|昭和町)/);
            if (cityMatch) city = cityMatch[1];
        }

        return { name: name, city: city };
    }

    function getVisibleCustomerList() {
        const activePage = document.querySelector('.ui-page-active') || document.body;
        const results = [];
        const seenIds = new Set();

        if (isPcMode) {
            const rows = document.querySelectorAll('tr');
            rows.forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if (tds.length === 0) return;
                const match = tds[0].innerText.trim().match(/^([0-9]{1,8})/);
                if (match && !tr.innerText.includes('売上') && !tr.innerText.includes('浄化槽設置先名')) {
                    const id = match[1];
                    if (!seenIds.has(id)) {
                        seenIds.add(id);
                        const nameDiv = tds.length > 1 ? tds[1].querySelector('div.name, .name, a, b') : null;
                        results.push({
                            id: id,
                            name: nameDiv ? nameDiv.innerText.replace(/＋付箋/g, '').trim() : id,
                            city: ''
                        });
                    }
                }
            });
        } else {
            const links = activePage.querySelectorAll('a, li, .taskItem, tr');
            links.forEach(link => {
                const href = link.getAttribute('href') || '';
                let container = link.closest('li') || link.closest('.taskItem') || link.closest('tr') || link.parentNode;
                if (!container) return;

                let id = null;
                const jksNumEl = container.querySelector('.jksNum, .code, .number');
                if (jksNumEl) {
                    const numMatch = jksNumEl.innerText.trim().match(/^([0-9]{1,8})/);
                    if (numMatch) id = numMatch[1];
                }
                if (!id) {
                    const match = href.match(/(?:ContractNumber|SetUpCode|id|code)=([0-9]{1,8})/i);
                    if (match) id = match[1];
                }

                if (id && !seenIds.has(id)) {
                    seenIds.add(id);
                    const nameEl = container.querySelector('.Name, .jksName, .name, .customerName');
                    results.push({
                        id: id,
                        name: nameEl ? nameEl.innerText.replace(/＋付箋/g, '').trim() : id,
                        city: ''
                    });
                }
            });
        }
        return results;
    }

    async function fetchFusenData() {
        if (isFetching) return;
        isFetching = true;
        try {
            const res = await fetch(API_URL + (API_URL.includes('?') ? '&' : '?') + 't=' + new Date().getTime());
            if (res.ok) {
                const data = await res.json();

                if (data.active === undefined && data.history === undefined) {
                    fusenDataCache = { active: data || {}, history: [] };
                } else {
                    fusenDataCache = {
                        active: data.active || {},
                        history: data.history || []
                    };
                }

                for (let key in fusenDataCache.active) {
                    if (!Array.isArray(fusenDataCache.active[key])) {
                        fusenDataCache.active[key] = [fusenDataCache.active[key]];
                    }
                }

                if (isMobileMode) {
                    renderFusenOnListMobile();
                    renderFusenOnMainMobile();
                } else if (isPcMode) {
                    renderFusenOnEcoproList();
                    renderFusenOnEcoproMain();
                }
                renderMyFusenButton();
            }
        } catch (e) {
            console.error('[FusenKun] 付箋データの取得に失敗しました', e);
        } finally {
            isFetching = false;
        }
    }

    async function saveFusenData() {
        try {
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fusenDataCache)
            });
        } catch (e) {
            alert('付箋の保存に失敗しました。');
        }
    }

    function getFormattedDate() {
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${mm}/${dd} ${h}:${m}`;
    }

    function triggerNativeShare(shareText) {
        if (window.AndroidNativeShare && window.AndroidNativeShare.shareText) {
            window.AndroidNativeShare.shareText(shareText);
        } else if (navigator.share) {
            navigator.share({
                title: '付箋内容共有',
                text: shareText
            }).catch(() => {});
        } else {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(shareText);
                alert('共有用テキストをコピーしました！');
            }
        }
    }

    function createRemoveModal() {
        if (document.getElementById('tfk-remove-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'tfk-remove-modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:99999999; display:none; justify-content:center; align-items:center;';
        modal.addEventListener('touchstart', (e) => e.stopPropagation(), {passive: false});
        modal.addEventListener('click', (e) => e.stopPropagation());

        const box = document.createElement('div');
        box.style.cssText = 'background:#fff; width:94%; max-width:440px; padding:22px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.35); font-family:sans-serif; position:relative; box-sizing:border-box;';

        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:2px solid #E74C3C; padding-bottom:8px;';

        const title = document.createElement('div');
        title.innerText = '🗑️ 付箋の対応完了';
        title.style.cssText = 'font-weight:bold; font-size:17px; color:#2C3E50;';

        const topShareBtn = document.createElement('button');
        topShareBtn.innerHTML = '🔗 共有';
        topShareBtn.style.cssText = 'padding:6px 14px; border:1px solid #007AFF; background:#E5F1FF; color:#007AFF; border-radius:18px; font-size:13px; font-weight:bold; cursor:pointer;';

        headerRow.appendChild(title);
        headerRow.appendChild(topShareBtn);

        const notePreviewBox = document.createElement('div');
        notePreviewBox.id = 'tfk-remove-preview-box';
        notePreviewBox.style.cssText = 'background:#FEF9E7; border:1px solid #F39C12; border-radius:8px; padding:10px 12px; margin-bottom:14px; font-size:14px; font-weight:bold; color:#D35400; word-break:break-all; max-height:100px; overflow-y:auto;';

        const removerRow = document.createElement('div');
        removerRow.style.cssText = 'display:flex; align-items:center; margin-bottom:12px; gap:8px;';
        removerRow.innerHTML = `<span style="font-size:14px; font-weight:bold; color:#475569;">👷 対応者:</span>`;
        const removerInput = document.createElement('input');
        removerInput.type = 'text';
        removerInput.style.cssText = 'flex:1; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:14px; font-weight:bold;';
        removerRow.appendChild(removerInput);

        const quickLabel = document.createElement('div');
        quickLabel.innerText = '👇 ワンタッチ選択（複数選択可・再タップで解除）:';
        quickLabel.style.cssText = 'font-size:12px; font-weight:bold; color:#64748B; margin-bottom:8px;';

        const quickBtnContainer = document.createElement('div');
        quickBtnContainer.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;';

        const presets = ['📞 電話済み', '🔧 現場対応済み', '💬 説明済み', '📅 日程調整済み', '❌ キャンセル'];
        let selectedPresets = [];

        const renderPresetButtons = () => {
            quickBtnContainer.innerHTML = '';
            presets.forEach(text => {
                const btn = document.createElement('button');
                btn.innerText = text;
                const isSelected = selectedPresets.includes(text);

                btn.style.cssText = isSelected
                    ? 'padding:7px 12px; font-size:12px; background:#3498DB; border:1px solid #2980B9; border-radius:16px; cursor:pointer; font-weight:bold; color:#fff;'
                    : 'padding:7px 12px; font-size:12px; background:#F1F5F9; border:1px solid #CBD5E1; border-radius:16px; cursor:pointer; font-weight:bold; color:#334155;';

                btn.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (isSelected) {
                        selectedPresets = selectedPresets.filter(p => p !== text);
                    } else {
                        selectedPresets.push(text);
                    }
                    renderPresetButtons();
                };
                quickBtnContainer.appendChild(btn);
            });
        };

        const memoInput = document.createElement('input');
        memoInput.type = 'text';
        memoInput.placeholder = '✍️ 補足メモ（任意）';
        memoInput.style.cssText = 'width:100%; padding:10px; border:1px solid #ccc; border-radius:8px; font-size:13px; margin-bottom:18px; box-sizing:border-box;';

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; justify-content:space-between; gap:10px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = 'キャンセル';
        cancelBtn.style.cssText = 'flex:1; padding:12px; border:none; background:#E2E8F0; color:#475569; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer;';
        cancelBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            modal.style.display = 'none';
        };

        const submitBtn = document.createElement('button');
        submitBtn.innerText = '剥がす（対応完了）';
        submitBtn.style.cssText = 'flex:1.5; padding:12px; border:none; background:#E74C3C; color:#fff; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer; box-shadow:0 3px 8px rgba(0,0,0,0.15);';

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(submitBtn);

        box.appendChild(headerRow);
        box.appendChild(notePreviewBox);
        box.appendChild(removerRow);
        box.appendChild(quickLabel);
        box.appendChild(quickBtnContainer);
        box.appendChild(memoInput);
        box.appendChild(btnRow);
        modal.appendChild(box);
        document.body.appendChild(modal);

        window.openRemoveModal = (targetId, editIndex) => {
            if (!targetId || editIndex === undefined || !fusenDataCache.active[targetId] || !fusenDataCache.active[targetId][editIndex]) return;

            const targetNote = fusenDataCache.active[targetId][editIndex];
            notePreviewBox.innerHTML = `<span style="font-size:11px; color:#888; display:block; margin-bottom:3px;">💬 貼られていたメモ (記入者: ${targetNote.author || '不明'})</span>「${targetNote.text}」`;

            removerInput.value = localStorage.getItem('tfk_fusen_author') || '';
            memoInput.value = '';
            selectedPresets = [];
            renderPresetButtons();

            topShareBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                let presetText = selectedPresets.join(' / ');
                let memo = memoInput.value.trim() ? ` (${memoInput.value.trim()})` : '';
                let textToShare = `【対応完了報告】\nお客様: ${targetNote.customerName || targetId}\n元のメモ: ${targetNote.text}\n対応者: ${removerInput.value.trim() || '不明'}\n結果: ${presetText}${memo}`;
                triggerNativeShare(textToShare);
            };

            submitBtn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                submitBtn.innerText = '処理中...';
                submitBtn.disabled = true;

                const remover = removerInput.value.trim() || '不明';
                if (removerInput.value.trim()) localStorage.setItem('tfk_fusen_author', remover);

                let presetText = selectedPresets.join(' / ');
                let finalMemo = presetText;

                if (memoInput.value.trim()) {
                    finalMemo = finalMemo ? `${finalMemo} (${memoInput.value.trim()})` : memoInput.value.trim();
                }
                if (!finalMemo) finalMemo = '対応完了';

                const historyItem = {
                    id: 'hist_' + new Date().getTime() + '_' + Math.floor(Math.random()*1000),
                    targetId: targetId,
                    customerName: targetNote.customerName || '',
                    locationCity: targetNote.locationCity || '',
                    originalText: targetNote.text,
                    author: targetNote.author || '不明',
                    createdDate: targetNote.date || '',
                    remover: remover,
                    removedDate: getFormattedDate(),
                    removedMemo: finalMemo,
                    color: targetNote.color,
                    border: targetNote.border
                };

                fusenDataCache.history.unshift(historyItem);
                if (fusenDataCache.history.length > 50) {
                    fusenDataCache.history = fusenDataCache.history.slice(0, 50);
                }

                const updatedNotes = fusenDataCache.active[targetId].filter((_, idx) => idx !== editIndex);
                if (updatedNotes.length === 0) delete fusenDataCache.active[targetId];
                else fusenDataCache.active[targetId] = updatedNotes;

                await saveFusenData();

                modal.style.display = 'none';
                submitBtn.disabled = false;
                submitBtn.innerText = '剥がす（対応完了）';

                if(isMobileMode) window.location.reload(); else fetchFusenData();
            };

            modal.style.display = 'flex';
        };
    }

    function createModal() {
        if (document.getElementById('tfk-fusen-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'tfk-fusen-modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999999; display:none; justify-content:center; align-items:center;';
        modal.addEventListener('touchstart', (e) => e.stopPropagation(), {passive: false});
        modal.addEventListener('click', (e) => e.stopPropagation());

        const box = document.createElement('div');
        box.style.cssText = 'background:#fff; width:92%; max-width:420px; padding:22px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.35); position:relative; box-sizing:border-box;';

        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;';

        const title = document.createElement('div');
        title.innerText = '📝 付箋を貼る';
        title.style.cssText = 'font-weight:bold; font-size:18px; color:#333;';

        const topShareBtn = document.createElement('button');
        topShareBtn.innerHTML = '🔗 共有';
        topShareBtn.style.cssText = 'padding:6px 14px; border:1px solid #007AFF; background:#E5F1FF; color:#007AFF; border-radius:18px; font-size:13px; font-weight:bold; cursor:pointer;';

        headerRow.appendChild(title);
        headerRow.appendChild(topShareBtn);

        const textarea = document.createElement('textarea');
        textarea.placeholder = '例：8月清掃、次回更新時に電話...';
        textarea.style.cssText = 'width:100%; height:90px; padding:12px; border:1px solid #ccc; border-radius:8px; font-size:15px; margin-bottom:10px; box-sizing:border-box; resize:none; font-family:sans-serif;';

        const cleanMonthRow = document.createElement('div');
        cleanMonthRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:14px; flex-wrap:wrap;';

        const calcNext4Month = () => {
            const currentMonth = new Date().getMonth() + 1;
            let nextM = (currentMonth + 4) % 12;
            return nextM === 0 ? 12 : nextM;
        };

        const target4Month = calcNext4Month();

        const quick4MonthBtn = document.createElement('button');
        quick4MonthBtn.innerText = `⚡ 次回清掃（${target4Month}月）`;
        quick4MonthBtn.style.cssText = 'padding:7px 14px; font-size:13px; font-weight:bold; background:#E8F8EC; color:#00B33C; border:1px solid #00B33C; border-radius:18px; cursor:pointer;';
        quick4MonthBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            const textToInsert = `次回清掃（${target4Month}月）`;
            textarea.value = textarea.value.trim() ? `${textarea.value.trim()} ${textToInsert}` : textToInsert;
            textarea.focus();
        };

        const monthSelect = document.createElement('select');
        monthSelect.style.cssText = 'padding:6px 10px; font-size:13px; font-weight:bold; border:1px solid #CBD5E1; border-radius:8px; background:#F8FAFC; color:#334155; cursor:pointer;';

        let defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.innerText = '📅 他の月を選択 ▾';
        monthSelect.appendChild(defaultOpt);

        for (let m = 1; m <= 12; m++) {
            let opt = document.createElement('option');
            opt.value = `${m}月`;
            opt.innerText = `${m}月清掃`;
            monthSelect.appendChild(opt);
        }

        monthSelect.onchange = (e) => {
            if (monthSelect.value) {
                const textToInsert = `次回清掃（${monthSelect.value}）`;
                textarea.value = textarea.value.trim() ? `${textarea.value.trim()} ${textToInsert}` : textToInsert;
                monthSelect.value = '';
                textarea.focus();
            }
        };

        cleanMonthRow.appendChild(quick4MonthBtn);
        cleanMonthRow.appendChild(monthSelect);

        const authorRow = document.createElement('div');
        authorRow.style.cssText = 'display:flex; align-items:center; margin-bottom:12px; gap:8px;';
        const authorLabel = document.createElement('span');
        authorLabel.innerText = '👤 記入者:';
        authorLabel.style.cssText = 'font-size:13px; color:#64748B; white-space:nowrap; font-weight:bold;';
        const authorInput = document.createElement('input');
        authorInput.type = 'text';
        authorInput.placeholder = '名前';
        authorInput.style.cssText = 'flex:1; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:14px;';
        authorInput.value = localStorage.getItem('tfk_fusen_author') || '';
        authorRow.appendChild(authorLabel);
        authorRow.appendChild(authorInput);

        const colorRow = document.createElement('div');
        colorRow.style.cssText = 'display:flex; justify-content:space-around; margin-bottom:18px;';

        const colors = [
            { id: 'yellow', code: '#fef08a', border: '#fde047' },
            { id: 'green', code: '#bbf7d0', border: '#86efac' },
            { id: 'pink', code: '#fbcfe8', border: '#f9a8d4' },
            { id: 'blue', code: '#bfdbfe', border: '#93c5fd' }
        ];

        let selectedColor = colors[0];

        colors.forEach(c => {
            const btn = document.createElement('div');
            btn.style.cssText = `width:36px; height:36px; border-radius:50%; background:${c.code}; border:2px solid ${c.border}; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:18px;`;
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                Array.from(colorRow.children).forEach(child => child.innerHTML = '');
                btn.innerHTML = '✓';
                selectedColor = c;
            };
            if (c.id === selectedColor.id) btn.innerHTML = '✓';
            colorRow.appendChild(btn);
        });

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; justify-content:space-between; gap:10px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = 'キャンセル';
        cancelBtn.style.cssText = 'flex:1; padding:12px; border:none; background:#e2e8f0; color:#475569; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer;';
        cancelBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            modal.style.display = 'none';
        };

        const saveBtn = document.createElement('button');
        saveBtn.innerText = '付箋を貼る';
        saveBtn.style.cssText = 'flex:1.5; padding:12px; border:none; background:#F39F12; color:#fff; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer; box-shadow:0 3px 8px rgba(0,0,0,0.15);';

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);

        box.appendChild(headerRow);
        box.appendChild(textarea);
        box.appendChild(cleanMonthRow);
        box.appendChild(authorRow);
        box.appendChild(colorRow);
        box.appendChild(btnRow);
        modal.appendChild(box);
        document.body.appendChild(modal);

        window.openFusenModal = (targetId) => {
            if (!targetId) {
                alert('顧客IDが取得できませんでした。一度画面を更新してください。');
                return;
            }

            textarea.value = '';
            authorInput.value = localStorage.getItem('tfk_fusen_author') || '';

            selectedColor = colors[0];
            Array.from(colorRow.children).forEach((child, idx) => {
                child.innerHTML = idx === 0 ? '✓' : '';
            });

            topShareBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                let info = getCustomerAndLocationInfo(targetId);
                let textToShare = `【付箋共有】\nお客様: ${info.name || targetId}\n内容: ${textarea.value.trim()}\n記入者: ${authorInput.value.trim() || '不明'}`;
                triggerNativeShare(textToShare);
            };

            saveBtn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                saveBtn.innerText = '保存中...';
                saveBtn.disabled = true;

                const text = textarea.value.trim();
                const author = authorInput.value.trim();

                if (author) localStorage.setItem('tfk_fusen_author', author);

                if (text !== '') {
                    if (!fusenDataCache.active[targetId]) fusenDataCache.active[targetId] = [];
                    const info = getCustomerAndLocationInfo(targetId);

                    const newNote = {
                        text: text,
                        color: selectedColor.code,
                        border: selectedColor.border,
                        author: author || '不明',
                        date: getFormattedDate(),
                        customerName: info.name || '',
                        locationCity: info.city || ''
                    };

                    fusenDataCache.active[targetId].push(newNote);
                    await saveFusenData();
                }

                modal.style.display = 'none';
                saveBtn.disabled = false;
                saveBtn.innerText = '付箋を貼る';

                if(isMobileMode) window.location.reload();
                else fetchFusenData();
            };

            modal.style.display = 'flex';
            textarea.focus();
        };
    }

    function createMyFusenListModal() {
        if (document.getElementById('tfk-my-fusen-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'tfk-my-fusen-modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999999; display:none; justify-content:center; align-items:center;';
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });

        const box = document.createElement('div');
        box.style.cssText = 'background:#fff; width:95%; max-width:480px; max-height:88vh; padding:20px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.35); display:flex; flex-direction:column; box-sizing:border-box;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:2px solid #F39C12; padding-bottom:8px;';

        const title = document.createElement('div');
        title.id = 'tfk-my-fusen-title';
        title.style.cssText = 'font-weight:bold; font-size:17px; color:#333;';

        const closeBtn = document.createElement('button');
        closeBtn.innerText = '✕';
        closeBtn.style.cssText = 'border:none; background:transparent; font-size:22px; font-weight:bold; cursor:pointer; color:#888;';
        closeBtn.onclick = () => modal.style.display = 'none';

        header.appendChild(title);
        header.appendChild(closeBtn);

        const tabContainer = document.createElement('div');
        tabContainer.style.cssText = 'display:flex; gap:8px; margin-bottom:10px; background:#F1F5F9; padding:4px; border-radius:10px;';

        const activeTabBtn = document.createElement('button');
        activeTabBtn.id = 'tfk-tab-active-btn';
        activeTabBtn.style.cssText = 'flex:1; padding:8px; font-size:13px; font-weight:bold; border:none; border-radius:8px; cursor:pointer; transition:all 0.2s;';

        const historyTabBtn = document.createElement('button');
        historyTabBtn.id = 'tfk-tab-history-btn';
        historyTabBtn.style.cssText = 'flex:1; padding:8px; font-size:13px; font-weight:bold; border:none; border-radius:8px; cursor:pointer; transition:all 0.2s;';

        tabContainer.appendChild(activeTabBtn);
        tabContainer.appendChild(historyTabBtn);

        const bulkActionBox = document.createElement('div');
        bulkActionBox.style.cssText = 'background:#F0F9FF; border:1px solid #BAE6FD; border-radius:8px; padding:8px 12px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;';

        const bulkLabel = document.createElement('span');
        bulkLabel.id = 'tfk-bulk-label';
        bulkLabel.style.cssText = 'font-size:12px; font-weight:bold; color:#0369A1;';

        const bulkBtn = document.createElement('button');
        bulkBtn.innerText = '⚡ 一括で付箋を貼る';
        bulkBtn.style.cssText = 'padding:6px 12px; font-size:11px; font-weight:bold; background:#0284C7; color:#fff; border:none; border-radius:14px; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.1);';

        bulkBtn.onclick = async (e) => {
            e.preventDefault(); e.stopPropagation();
            const visibleCustomers = getVisibleCustomerList();
            if (visibleCustomers.length === 0) {
                alert('現在画面に表示されているお客様が検出できませんでした。');
                return;
            }

            const currentAuthor = localStorage.getItem('tfk_fusen_author') || '不明';
            const memoText = prompt(`【表示中全員一括付箋】\n画面上の ${visibleCustomers.length} 名に一括で貼るメモ内容を入力してください:\n例: 8月清掃 / 次回清掃（12月）`, `次回清掃（12月）`);

            if (memoText && memoText.trim()) {
                if (!confirm(`画面上に表示されている ${visibleCustomers.length} 名の顧客へ「${memoText.trim()}」を貼ります。よろしいですか？`)) return;

                bulkBtn.disabled = true;
                bulkBtn.innerText = '処理中...';

                const createdDate = getFormattedDate();

                visibleCustomers.forEach(cust => {
                    if (!fusenDataCache.active[cust.id]) fusenDataCache.active[cust.id] = [];
                    fusenDataCache.active[cust.id].push({
                        text: memoText.trim(),
                        color: '#fef08a',
                        border: '#fde047',
                        author: currentAuthor,
                        date: createdDate,
                        customerName: cust.name || '',
                        locationCity: cust.city || ''
                    });
                });

                await saveFusenData();

                alert(`✅ 表示中の ${visibleCustomers.length} 名に付箋を一括で貼り付けました！`);
                modal.style.display = 'none';
                bulkBtn.disabled = false;
                bulkBtn.innerText = '⚡ 一括で付箋を貼る';

                if(isMobileMode) window.location.reload(); else fetchFusenData();
            }
        };

        bulkActionBox.appendChild(bulkLabel);
        bulkActionBox.appendChild(bulkBtn);

        const listContainer = document.createElement('div');
        listContainer.id = 'tfk-my-fusen-container';
        listContainer.style.cssText = 'flex:1; overflow-y:auto; padding:4px; display:flex; flex-direction:column; gap:12px;';

        box.appendChild(header);
        box.appendChild(tabContainer);
        box.appendChild(bulkActionBox);
        box.appendChild(listContainer);
        modal.appendChild(box);
        document.body.appendChild(modal);

        const renderTabContent = (author) => {
            listContainer.innerHTML = '';

            const visibleCusts = getVisibleCustomerList();
            bulkLabel.innerText = `👥 画面上の表示件数: ${visibleCusts.length} 件`;

            if (currentTab === 'active') {
                activeTabBtn.style.cssText = 'flex:1; padding:8px; font-size:13px; font-weight:bold; border:none; border-radius:8px; cursor:pointer; background:#FFF; color:#D35400; box-shadow:0 1px 4px rgba(0,0,0,0.12);';
                historyTabBtn.style.cssText = 'flex:1; padding:8px; font-size:13px; font-weight:bold; border:none; border-radius:8px; cursor:pointer; background:transparent; color:#64748B;';

                let count = 0;
                for (let targetId in fusenDataCache.active) {
                    const notes = fusenDataCache.active[targetId];
                    notes.forEach((note, index) => {
                        if (note.author === author) {
                            count++;
                            const itemCard = document.createElement('div');
                            itemCard.style.cssText = `background:${note.color}; border:1px solid ${note.border}; border-radius:10px; padding:14px; box-shadow:0 2px 5px rgba(0,0,0,0.08); display:flex; flex-direction:column; gap:8px;`;

                            let displayName = note.customerName || '';
                            if (displayName.includes('付箋') || displayName.includes('＋')) displayName = '';

                            let customerLabel = displayName
                                ? `<div style="font-size:15px; font-weight:bold; color:#1A202C;">🏢 ${displayName}<span style="font-size:12px; color:#D35400;">${note.locationCity ? ' ('+note.locationCity+')' : ''}</span></div>`
                                : `<div style="font-size:13px; font-weight:bold; color:#718096;">🏢 (お名前未登録)</div>`;

                            const topRow = document.createElement('div');
                            topRow.style.cssText = 'display:flex; justify-content:space-between; font-size:12px; color:#666; border-bottom:1px stroke rgba(0,0,0,0.1); padding-bottom:4px;';
                            topRow.innerHTML = `<span>🆔 ID: <b>${targetId}</b></span><span>🕒 ${note.date || ''}</span>`;

                            const bodyText = document.createElement('div');
                            bodyText.innerText = note.text;
                            bodyText.style.cssText = 'font-size:14px; font-weight:bold; color:#333; white-space:pre-wrap; word-break:break-all; margin-top:2px;';

                            const actionRow = document.createElement('div');
                            actionRow.style.cssText = 'display:flex; justify-content:flex-end; margin-top:4px;';

                            const editBtn = document.createElement('button');
                            editBtn.innerText = '🗑️ 対応完了（剥がす）';
                            editBtn.style.cssText = 'padding:6px 12px; font-size:12px; background:#fff; border:1px solid #ccc; border-radius:6px; cursor:pointer; font-weight:bold; color:#E74C3C;';
                            editBtn.onclick = (e) => {
                                e.preventDefault(); e.stopPropagation();
                                modal.style.display = 'none';
                                window.openRemoveModal(targetId, index);
                            };

                            actionRow.appendChild(editBtn);

                            const custDiv = document.createElement('div');
                            custDiv.innerHTML = customerLabel;
                            itemCard.appendChild(custDiv);
                            itemCard.appendChild(topRow);
                            itemCard.appendChild(bodyText);
                            itemCard.appendChild(actionRow);

                            listContainer.appendChild(itemCard);
                        }
                    });
                }

                if (count === 0) {
                    listContainer.innerHTML = `<div style="text-align:center; padding:30px; color:#888; font-size:14px;">「${author}」さんが現在貼っている付箋はありません。</div>`;
                }

            } else {
                historyTabBtn.style.cssText = 'flex:1; padding:8px; font-size:13px; font-weight:bold; border:none; border-radius:8px; cursor:pointer; background:#FFF; color:#2980B9; box-shadow:0 1px 4px rgba(0,0,0,0.12);';
                activeTabBtn.style.cssText = 'flex:1; padding:8px; font-size:13px; font-weight:bold; border:none; border-radius:8px; cursor:pointer; background:transparent; color:#64748B;';

                let count = 0;
                const historyList = fusenDataCache.history || [];

                historyList.forEach((item, index) => {
                    if (item.remover === author || item.author === author) {
                        count++;
                        const itemCard = document.createElement('div');
                        itemCard.style.cssText = `background:#F8FAFC; border:1px solid #CBD5E1; border-radius:10px; padding:14px; box-shadow:0 2px 4px rgba(0,0,0,0.05); display:flex; flex-direction:column; gap:8px;`;

                        let displayName = item.customerName || '';
                        if (displayName.includes('付箋') || displayName.includes('＋')) displayName = '';

                        let customerLabel = displayName
                            ? `<div style="font-size:15px; font-weight:bold; color:#334155;">🏢 ${displayName}<span style="font-size:12px; color:#64748B;">${item.locationCity ? ' ('+item.locationCity+')' : ''}</span></div>`
                            : `<div style="font-size:13px; font-weight:bold; color:#94A3B8;">🏢 (お名前未登録)</div>`;

                        const topRow = document.createElement('div');
                        topRow.style.cssText = 'display:flex; justify-content:space-between; font-size:12px; color:#64748B; border-bottom:1px solid #E2E8F0; padding-bottom:4px;';
                        topRow.innerHTML = `<span>🆔 ID: <b>${item.targetId}</b></span><span>🕒 完了: ${item.removedDate || ''}</span>`;

                        const origNoteBox = document.createElement('div');
                        origNoteBox.style.cssText = 'background:#FFF; border:1px dashed #CBD5E1; border-radius:6px; padding:8px 10px; font-size:13px; color:#475569; word-break:break-all;';
                        origNoteBox.innerHTML = `<span style="font-size:11px; color:#94A3B8; display:block; margin-bottom:2px;">💬 元のメモ (記入者: ${item.author})</span>${item.originalText}`;

                        const resultBox = document.createElement('div');
                        resultBox.style.cssText = 'background:#E0F2FE; border:1px solid #BAE6FD; border-radius:6px; padding:8px 10px; font-size:13px; font-weight:bold; color:#0369A1; word-break:break-all;';
                        resultBox.innerHTML = `<span style="font-size:11px; color:#0284C7; display:block; margin-bottom:2px;">👷 対応者: ${item.remover}</span>📝 結果: ${item.removedMemo || '対応完了'}`;

                        const actionRow = document.createElement('div');
                        actionRow.style.cssText = 'display:flex; justify-content:flex-end; margin-top:2px;';

                        const deleteHistBtn = document.createElement('button');
                        deleteHistBtn.innerText = '🗑️ 履歴を削除';
                        deleteHistBtn.style.cssText = 'padding:5px 10px; font-size:11px; background:#FEF2F2; border:1px solid #FCA5A5; border-radius:6px; cursor:pointer; font-weight:bold; color:#DC2626;';

                        deleteHistBtn.onclick = async (e) => {
                            e.preventDefault(); e.stopPropagation();
                            if (confirm(`この履歴（${displayName || item.targetId}）を削除してもよろしいですか？`)) {
                                fusenDataCache.history.splice(index, 1);
                                await saveFusenData();
                                window.openMyFusenListModal();
                            }
                        };

                        actionRow.appendChild(deleteHistBtn);

                        const custDiv = document.createElement('div');
                        custDiv.innerHTML = customerLabel;

                        itemCard.appendChild(custDiv);
                        itemCard.appendChild(topRow);
                        itemCard.appendChild(origNoteBox);
                        itemCard.appendChild(resultBox);
                        itemCard.appendChild(actionRow);

                        listContainer.appendChild(itemCard);
                    }
                });

                if (count === 0) {
                    listContainer.innerHTML = `<div style="text-align:center; padding:30px; color:#888; font-size:14px;">「${author}」さんに関わる剥がした履歴はありません。</div>`;
                }
            }
        };

        window.openMyFusenListModal = () => {
            const currentAuthor = localStorage.getItem('tfk_fusen_author') || '';
            if (!currentAuthor) {
                alert('記入者名が設定されていません。一度付箋を登録して名前を保存してください。');
                return;
            }

            title.innerText = `📝 ${currentAuthor} さんの付箋`;

            let activeCount = 0;
            for (let targetId in fusenDataCache.active) {
                fusenDataCache.active[targetId].forEach(note => {
                    if (note.author === currentAuthor) activeCount++;
                });
            }

            let historyCount = 0;
            (fusenDataCache.history || []).forEach(item => {
                if (item.remover === currentAuthor || item.author === currentAuthor) historyCount++;
            });

            activeTabBtn.innerText = `📌 貼り付け中 (${activeCount})`;
            historyTabBtn.innerText = `🗑️ 剥がした履歴 (${historyCount})`;

            activeTabBtn.onclick = () => {
                currentTab = 'active';
                renderTabContent(currentAuthor);
            };

            historyTabBtn.onclick = () => {
                currentTab = 'history';
                renderTabContent(currentAuthor);
            };

            renderTabContent(currentAuthor);
            modal.style.display = 'flex';
        };
    }

    function renderMyFusenButton() {
        const currentAuthor = localStorage.getItem('tfk_fusen_author') || '';
        if (!currentAuthor) return;

        if (isPcMode) {
            let oldFixedBtn = document.querySelector('body > #tfk-my-fusen-float-btn');
            if (oldFixedBtn) oldFixedBtn.remove();

            const leftTables = document.querySelectorAll('table');
            let targetLeftContainer = null;

            for (let tbl of leftTables) {
                if (tbl.innerText.includes('浄化槽コード') && tbl.innerText.includes('浄化槽設置先名')) {
                    targetLeftContainer = tbl.closest('div') || tbl.parentElement;
                    break;
                }
            }

            if (targetLeftContainer) {
                let myNotesCount = 0;
                for (let targetId in fusenDataCache.active) {
                    fusenDataCache.active[targetId].forEach(note => {
                        if (note.author === currentAuthor) myNotesCount++;
                    });
                }

                let inlineBtn = targetLeftContainer.querySelector('#tfk-my-fusen-inline-btn');
                if (!inlineBtn) {
                    inlineBtn = document.createElement('div');
                    inlineBtn.id = 'tfk-my-fusen-inline-btn';
                    inlineBtn.style.cssText = 'margin:15px auto 5px auto; background:#F39C12; color:#fff; padding:8px 18px; border-radius:20px; font-size:13px; font-weight:bold; box-shadow:0 3px 8px rgba(0,0,0,0.2); cursor:pointer; display:inline-flex; align-items:center; gap:6px; border:2px solid #fff; text-align:center;';
                    inlineBtn.onclick = (e) => {
                        e.preventDefault(); e.stopPropagation();
                        window.openMyFusenListModal();
                    };
                    targetLeftContainer.appendChild(inlineBtn);
                }
                inlineBtn.style.display = 'inline-flex';
                inlineBtn.innerHTML = `📝 マイ付箋 (${myNotesCount})`;
            }
            return;
        }

        const currentUrl = window.location.href.toLowerCase();
        const activePage = document.querySelector('.ui-page-active') || document.body;
        const pageText = activePage.innerText || '';

        const isListScreen = (currentUrl.includes('list') || pageText.includes('点検一覧') || pageText.includes('設置先一覧') || pageText.includes('予定一覧') || pageText.includes('清掃一覧')) && !isMobileDetailScreen();

        let btn = document.getElementById('tfk-my-fusen-float-btn');

        if (!isListScreen) {
            if (btn) btn.style.display = 'none';
            return;
        }

        let myNotesCount = 0;
        for (let targetId in fusenDataCache.active) {
            fusenDataCache.active[targetId].forEach(note => {
                if (note.author === currentAuthor) myNotesCount++;
            });
        }

        if (!btn) {
            btn = document.createElement('div');
            btn.id = 'tfk-my-fusen-float-btn';
            btn.style.cssText = 'position:fixed; bottom:30px; right:20px; background:#F39C12; color:#fff; padding:10px 18px; border-radius:24px; font-size:13px; font-weight:bold; box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:999999; cursor:pointer; display:flex; align-items:center; gap:6px; border:2px solid #fff;';
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                window.openMyFusenListModal();
            };
            document.body.appendChild(btn);
        }
        btn.style.display = 'flex';
        btn.innerHTML = `📝 マイ付箋 (${myNotesCount})`;
    }

    function createInlineFusenChip(note, index, targetId) {
        const chip = document.createElement('span');
        chip.style.cssText = `background:${note.color} !important; border:1px solid ${note.border} !important; color:#333 !important; padding:2px 6px !important; border-radius:4px !important; box-shadow:0 1px 3px rgba(0,0,0,0.15) !important; cursor:pointer !important; display:inline-flex !important; align-items:center !important; gap:4px !important; white-space:nowrap !important; margin:0 3px !important; vertical-align:middle !important; height:22px !important; box-sizing:border-box !important; position:relative !important; z-index:20 !important; font-weight:normal !important;`;

        const textSpan = document.createElement('span');
        textSpan.innerText = note.text;
        textSpan.style.cssText = `max-width:110px !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; font-size:11px !important; font-weight:bold !important; line-height:1 !important;`;

        chip.appendChild(textSpan);

        const handleTap = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            window.openRemoveModal(targetId, index);
            return false;
        };

        chip.onclick = handleTap;
        chip.ontouchstart = (e) => e.stopPropagation();

        return chip;
    }

    function createAddInlineBadge(targetId) {
        const badge = document.createElement('span');
        badge.innerText = '＋付箋';
        badge.style.cssText = 'margin-left:6px; font-size:11px; color:#007AFF; background:#E5F1FF; border:1px solid #007AFF; border-radius:12px; padding:2px 8px; cursor:pointer; font-weight:bold; display:inline-block; vertical-align:middle; height:22px; line-height:16px; box-sizing:border-box; position:relative !important; z-index:20 !important;';

        const handleTap = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            window.openFusenModal(targetId);
            return false;
        };

        badge.onclick = handleTap;
        badge.ontouchstart = (e) => e.stopPropagation();

        return badge;
    }

    function createMediumFusenDomMobile(note, index, targetId) {
        const fusen = document.createElement('div');
        fusen.style.cssText = `background:${note.color} !important; border:1px solid ${note.border} !important; color:#1A202C !important; padding:10px 12px !important; border-radius:8px !important; box-shadow:0 2px 6px rgba(0,0,0,0.12) !important; cursor:pointer !important; display:flex !important; flex-direction:column !important; justify-content:space-between !important; width:calc(50% - 6px) !important; box-sizing:border-box !important; min-height:70px !important;`;

        const textDiv = document.createElement('div');
        textDiv.innerText = note.text;
        textDiv.style.cssText = `font-size:13px !important; font-weight:bold !important; margin-bottom:6px !important; word-wrap:break-word !important; line-height:1.35 !important; text-align:left !important; white-space:pre-wrap !important; color:#000 !important;`;

        const footerDiv = document.createElement('div');
        footerDiv.style.cssText = `border-top:1px dashed rgba(0,0,0,0.2) !important; padding-top:4px !important; font-size:10px !important; color:#4A5568 !important; display:flex !important; justify-content:space-between !important; align-items:center !important; flex-wrap:wrap !important; gap:2px !important;`;

        footerDiv.innerHTML = `<span style="width:100%; text-align:right;">👤 <b>${note.author || '不明'}</b> <span style="font-family:monospace; color:#718096; margin-left:3px;">${note.date || ''}</span></span>`;

        fusen.appendChild(textDiv);
        fusen.appendChild(footerDiv);

        fusen.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            window.openRemoveModal(targetId, index);
        };
        return fusen;
    }

    function renderFusenOnListMobile() {
        if (isMobileDetailScreen()) return;

        const activePage = document.querySelector('.ui-page-active') || document.body;
        const links = activePage.querySelectorAll('a, li, .taskItem, tr, div');
        if (links.length === 0) return;

        links.forEach(link => {
            const href = link.getAttribute('href') || '';
            const textContent = link.innerText.trim();
            let targetId = null;

            let container = link.closest('li') || link.closest('.taskItem') || link.closest('tr') || link.parentNode;
            if (!container) return;

            const jksNumEl = container.querySelector('.jksNum, .code, .number');
            if (jksNumEl) {
                const numMatch = jksNumEl.innerText.trim().match(/^([0-9]{1,8})/);
                if (numMatch) targetId = numMatch[1];
            }

            if (!targetId) {
                const contractMatch = href.match(/(?:ContractNumber|SetUpCode|id|code)=([0-9]{1,8})/i);
                if (contractMatch) {
                    targetId = contractMatch[1];
                } else {
                    const textMatch = textContent.match(/^\s*([0-9]{1,8})(?:\s|\n||$)/);
                    if (textMatch) targetId = textMatch[1];
                }
            }

            if (!targetId) return;

            const oldArea = container.querySelector('.tfk-fusen-area');
            if (oldArea) oldArea.remove();

            const nameEl = container.querySelector('.Name, .jksName, .name, .customerName');
            if (!nameEl) return;

            nameEl.style.display = 'flex';
            nameEl.style.alignItems = 'center';
            nameEl.style.overflowX = 'auto';
            nameEl.style.whiteSpace = 'nowrap';

            let inlineWrapper = nameEl.querySelector('.tfk-inline-fusen-wrapper');
            if (!inlineWrapper) {
                inlineWrapper = document.createElement('span');
                inlineWrapper.className = 'tfk-inline-fusen-wrapper';
                inlineWrapper.style.cssText = 'display:inline-flex; align-items:center; vertical-align:middle; z-index:20; position:relative; margin-left:6px;';

                ['click', 'touchstart', 'touchend', 'mousedown', 'mouseup'].forEach(evt => {
                    inlineWrapper.addEventListener(evt, (e) => e.stopPropagation(), { passive: false });
                });

                nameEl.appendChild(inlineWrapper);
            }

            const notes = fusenDataCache.active[targetId] || [];
            const currentNotesStr = JSON.stringify(notes) + "_" + targetId;

            if (inlineWrapper.dataset.notesCache === currentNotesStr) return;

            inlineWrapper.innerHTML = '';
            inlineWrapper.dataset.notesCache = currentNotesStr;

            inlineWrapper.appendChild(createAddInlineBadge(targetId));

            notes.forEach((note, index) => {
                inlineWrapper.appendChild(createInlineFusenChip(note, index, targetId));
            });
        });
    }

    function renderFusenOnMainMobile() {
        if (!isMobileDetailScreen()) {
            const oldContainer = document.getElementById('tfk-main-fusen-container');
            if (oldContainer) oldContainer.remove();
            return;
        }

        let mainTargetId = null;
        let checkNumberForMap = null;
        const activePage = document.querySelector('.ui-page-active') || document.body;

        const iframe = document.getElementById('frmBasic') || document.querySelector('iframe');
        if (iframe) {
            const src = iframe.getAttribute('src') || '';
            const setupMatch = src.match(/[?&]SetUpCode=([0-9]{1,8})/i);
            if (setupMatch) mainTargetId = setupMatch[1];
        }

        if (!mainTargetId) {
            try {
                const params = new URLSearchParams(window.location.search);
                mainTargetId = params.get('SetUpCode') || params.get('ContractNumber') || params.get('id');
                checkNumberForMap = params.get('CheckNumber');
            } catch(e) {}
        }

        if (!mainTargetId && checkNumberForMap) {
            const mappedId = localStorage.getItem('tfk_map_ch_' + checkNumberForMap);
            if (mappedId) mainTargetId = mappedId;
        }

        if (!mainTargetId) return;

        let fusenContainer = document.getElementById('tfk-main-fusen-container');
        let cardListWrapper = document.getElementById('tfk-main-fusen-card-list');
        let btnWrapper = document.getElementById('tfk-main-fusen-btn-area');

        if (!fusenContainer) {
            fusenContainer = document.createElement('div');
            fusenContainer.id = 'tfk-main-fusen-container';
            fusenContainer.style.cssText = 'display:block !important; width:100% !important; clear:both !important; float:none !important; padding:8px 10px !important; margin:6px 0 !important; box-sizing:border-box !important; z-index:90 !important; position:relative !important; background:transparent !important; text-align:center !important;';

            cardListWrapper = document.createElement('div');
            cardListWrapper.id = 'tfk-main-fusen-card-list';
            cardListWrapper.style.cssText = 'display:flex !important; flex-direction:row !important; flex-wrap:wrap !important; gap:8px !important; justify-content:flex-start !important; align-items:stretch !important; width:100% !important; box-sizing:border-box !important; margin-bottom:6px !important;';

            btnWrapper = document.createElement('div');
            btnWrapper.id = 'tfk-main-fusen-btn-area';
            btnWrapper.style.cssText = 'width:100% !important; text-align:center !important;';

            fusenContainer.appendChild(cardListWrapper);
            fusenContainer.appendChild(btnWrapper);
        }

        let tabAnchor = activePage.querySelector('.ui-navbar');
        if (!tabAnchor) {
            const allElements = activePage.querySelectorAll('div, a, li, span');
            for (let el of allElements) {
                const txt = (el.innerText || '').trim();
                if (txt === '基本情報' || txt.includes('基本情報')) {
                    if (el.children.length === 0 || el.tagName === 'A') {
                        tabAnchor = el.closest('.ui-navbar') || el.closest('ul') || el.closest('div');
                        break;
                    }
                }
            }
        }

        if (tabAnchor && tabAnchor.parentNode) {
            if (tabAnchor.previousSibling !== fusenContainer && tabAnchor !== fusenContainer) {
                tabAnchor.parentNode.insertBefore(fusenContainer, tabAnchor);
            }
        } else {
            const contentArea = activePage.querySelector('.ui-content') || activePage;
            if (contentArea && contentArea.lastChild !== fusenContainer) {
                contentArea.appendChild(fusenContainer);
            }
        }

        const notes = fusenDataCache.active[mainTargetId] || [];
        const currentNotesStr = JSON.stringify(notes);

        if (cardListWrapper.dataset.notesCache !== currentNotesStr) {
            cardListWrapper.innerHTML = '';
            btnWrapper.innerHTML = '';
            cardListWrapper.dataset.notesCache = currentNotesStr;

            if (notes.length > 0) {
                notes.forEach((note, index) => {
                    cardListWrapper.appendChild(createMediumFusenDomMobile(note, index, mainTargetId));
                });
            }

            const addBtn = document.createElement('div');
            addBtn.innerText = '＋ このお客様に付箋を貼る';
            addBtn.style.cssText = 'padding:10px 20px !important; font-size:14px !important; color:#007AFF !important; border:1px dashed #007AFF !important; border-radius:8px !important; cursor:pointer !important; display:inline-block !important; background:#fff !important; font-weight:bold !important; text-align:center !important; margin:0 auto !important; box-shadow:0 1px 3px rgba(0,0,0,0.06) !important;';
            addBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                window.openFusenModal(mainTargetId);
            };
            btnWrapper.appendChild(addBtn);
        }
    }

    function createFusenDomPc(note, index, targetId, isList) {
        const fusen = document.createElement('div');
        const padding = isList ? '4px 8px' : '6px 10px';
        const fontSize = isList ? '11px' : '13px';
        const authorSize = isList ? '9px' : '11px';
        const iconSize = isList ? '9' : '12';
        const widthStyle = isList ? 'min-width:100px; max-width:160px;' : 'min-width:120px; max-width:180px;';

        fusen.style.cssText = `background:${note.color} !important; border:1px solid ${note.border} !important; color:#333 !important; padding:${padding} !important; border-radius:4px !important; box-shadow:2px 3px 6px rgba(0,0,0,0.15) !important; cursor:pointer !important; display:flex !important; flex-direction:column !important; justify-content:space-between !important; flex: 0 0 auto !important; ${widthStyle} !important; box-sizing:border-box !important;`;

        const textDiv = document.createElement('div');
        textDiv.innerText = note.text;
        textDiv.style.cssText = `font-size:${fontSize} !important; font-weight:bold !important; margin-bottom:4px !important; word-wrap:break-word !important; line-height:1.4 !important; text-align:left !important; white-space:pre-wrap !important;`;

        const footerDiv = document.createElement('div');
        footerDiv.style.cssText = `border-top:1px dotted rgba(0,0,0,0.2) !important; padding-top:2px !important; text-align:right !important; font-size:${authorSize} !important; color:#555 !important; display:flex !important; justify-content:flex-end !important; align-items:center !important; gap:4px !important; flex-wrap:wrap !important;`;

        const iconSvg = `<svg viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}" fill="#005A9E"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
        footerDiv.innerHTML = `${iconSvg} <span style="font-weight:bold;">${note.author || '不明'}</span> <span style="color:#888; font-family:monospace;">${note.date || ''}</span>`;

        fusen.appendChild(textDiv);
        fusen.appendChild(footerDiv);

        fusen.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            window.openRemoveModal(targetId, index);
        };
        return fusen;
    }

    function createAddBtnPc(targetId, isList) {
        const addBtn = document.createElement('div');
        const padding = isList ? '4px 10px' : '6px 12px';
        const fontSize = isList ? '11px' : '13px';

        addBtn.innerText = isList ? '＋追加' : '＋ 付箋を貼る';
        addBtn.style.cssText = `padding:${padding} !important; font-size:${fontSize} !important; color:#007AFF !important; border:2px dashed #007AFF !important; border-radius:6px !important; cursor:pointer !important; display:flex !important; align-items:center !important; justify-content:center !important; background:rgba(255,255,255,0.8) !important; font-weight:bold !important; flex: 0 0 auto !important;`;

        addBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            window.openFusenModal(targetId);
        };
        return addBtn;
    }

    function renderFusenOnEcoproList() {
        const rows = document.querySelectorAll('tr');
        rows.forEach(tr => {
            const tds = tr.querySelectorAll('td');
            if (tds.length === 0) return;

            const codeTd = tds[0];
            const firstTdText = codeTd.innerText.trim();
            const match = firstTdText.match(/^([0-9]{1,8})/);
            if (!match) return;

            const targetId = match[1];
            if (tr.innerText.includes('売上') || tr.innerText.includes('マスタ修正') || tr.innerText.includes('浄化槽設置先名')) return;

            const targetTd = tds.length > 1 ? tds[1] : tds[0];
            const nameDiv = targetTd.querySelector('div.name, .name');
            if (!nameDiv) return;

            let inlineWrapper = nameDiv.querySelector('.tfk-inline-fusen-wrapper-pc');

            if (!inlineWrapper) {
                inlineWrapper = document.createElement('span');
                inlineWrapper.className = 'tfk-inline-fusen-wrapper-pc';
                inlineWrapper.style.cssText = 'display:inline-flex; align-items:center; vertical-align:middle; z-index:20; position:relative; margin-left:4px; font-size:12px; font-weight:normal;';

                ['click', 'touchstart', 'touchend', 'mousedown', 'mouseup'].forEach(evt => {
                    inlineWrapper.addEventListener(evt, (e) => e.stopPropagation(), { passive: false });
                });

                nameDiv.appendChild(inlineWrapper);
            }

            const notes = fusenDataCache.active[targetId] || [];
            const currentNotesStr = JSON.stringify(notes) + "_" + targetId;

            if (inlineWrapper.dataset.notesCache === currentNotesStr) return;

            inlineWrapper.innerHTML = '';
            inlineWrapper.dataset.notesCache = currentNotesStr;

            inlineWrapper.appendChild(createAddInlineBadge(targetId));

            notes.forEach((note, index) => {
                inlineWrapper.appendChild(createInlineFusenChip(note, index, targetId));
            });
        });
    }

    function renderFusenOnEcoproMain() {
        const inputs = document.querySelectorAll('input[type="text"]');
        let targetId = null;
        let anchorElement = null;

        for (let input of inputs) {
            let val = input.value.trim();
            if (val.match(/^[0-9]+$/)) {
                let prev = input.previousElementSibling;
                let parentPrev = input.parentElement ? input.parentElement.previousElementSibling : null;

                if ((prev && prev.innerText && prev.innerText.includes('浄化槽コード')) ||
                    (parentPrev && parentPrev.innerText && parentPrev.innerText.includes('浄化槽コード'))) {
                    targetId = val;
                    anchorElement = input;
                    break;
                }
            }
        }

        if (!targetId || !anchorElement) return;

        let fusenContainer = document.getElementById('tfk-ecopro-fusen-container');

        if (!fusenContainer) {
            fusenContainer = document.createElement('div');
            fusenContainer.id = 'tfk-ecopro-fusen-container';
            fusenContainer.style.cssText = 'display:flex; flex-direction:row; flex-wrap:wrap; gap:10px; align-items:center; margin-left:15px;';

            let tr = anchorElement.closest('tr');
            if (tr) {
                let td = document.createElement('td');
                td.style.border = 'none';
                td.style.background = 'transparent';
                td.appendChild(fusenContainer);
                tr.appendChild(td);
            } else {
                fusenContainer.style.display = 'inline-flex';
                fusenContainer.style.verticalAlign = 'middle';
                anchorElement.parentNode.insertBefore(fusenContainer, anchorElement.nextSibling);
            }
        }

        const notes = fusenDataCache.active[targetId] || [];
        const currentNotesStr = JSON.stringify(notes) + "_" + targetId;

        if (fusenContainer.dataset.notesCache === currentNotesStr) return;

        fusenContainer.innerHTML = '';
        fusenContainer.dataset.notesCache = currentNotesStr;

        if (notes.length > 0) {
            notes.forEach((note, index) => {
                fusenContainer.appendChild(createFusenDomPc(note, index, targetId, false));
            });
            fusenContainer.appendChild(createAddBtnPc(targetId, false));
        } else {
            fusenContainer.appendChild(createAddBtnPc(targetId, false));
        }
    }

    // --- 初期化 ---
    createModal();
    createRemoveModal();
    createMyFusenListModal();
    fetchFusenData();

    setInterval(() => {
        if (isMobileMode) {
            renderFusenOnListMobile();
            renderFusenOnMainMobile();
        } else if (isPcMode) {
            renderFusenOnEcoproList();
            renderFusenOnEcoproMain();
        }
        renderMyFusenButton();
    }, 1500);

    setInterval(fetchFusenData, 30000);

    // ★ 旧サーバー(tfkankyo.com)からのワンクリックデータ移行ユーティリティ
    window.migrateFusenData = async () => {
        const oldApi = 'https://tfkankyo.com/fusenkun/fusen_api.php?domain=' + cleanDomain;
        console.log(`[移行] 旧API (${oldApi}) からデータを取得中...`);
        
        try {
            const res = await fetch(oldApi);
            if (!res.ok) throw new Error("旧APIからの取得に失敗しました");
            const data = await res.json();
            
            console.log(`[移行] C# バックエンドへデータを保存中...`, data);
            const saveRes = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (saveRes.ok) {
                alert('✅ 旧データの内製データベース(fusen.db)への移行が完了しました！');
                window.location.reload();
            } else {
                alert('❌ 内製データベースへの保存に失敗しました。');
            }
        } catch (e) {
            console.error(e);
            alert('❌ 移行処理中にエラーが発生しました。コンソールを確認してください。');
        }
    };
}