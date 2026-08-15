// wwwroot/js/modules/zandaka-copy.js

export function initZandakaCopy() {
    if (window.zandakaCopipeStarted) return;
    window.zandakaCopipeStarted = true;

    runAllFeatures();
    setInterval(runAllFeatures, 1000);
}

const Storage = {
    save(data) {
        const json = JSON.stringify(data);
        try {
            if (window.HHCBridge) window.HHCBridge.savePool(json);
            else localStorage.setItem('hhc_copy_data_v2', json);
        } catch(e) {}
    },
    load() {
        try {
            let json = '';
            if (window.HHCBridge) json = window.HHCBridge.getPool() || '';
            else json = localStorage.getItem('hhc_copy_data_v2') || '';
            if (!json) return null;
            return JSON.parse(json);
        } catch(e) { return null; }
    },
    clear() {
        try {
            if (window.HHCBridge) window.HHCBridge.clearPool();
            else localStorage.removeItem('hhc_copy_data_v2');
        } catch(e) {}
    }
};

function showToast(message) {
    let toast = document.getElementById('hhc-toast-msg');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'hhc-toast-msg';
        toast.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(15, 23, 42, 0.9);color:white;padding:12px 24px;border-radius:8px;font-weight:bold;z-index:9999999;font-size:14px;text-align:center;pointer-events:none;transition:opacity 0.3s;white-space:pre-wrap;width:80%;max-width:300px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

function toWareki(dateStr) {
    const match = dateStr.match(/([0-9]{4})\/([0-9]{1,2})\/([0-9]{1,2})/);
    if (!match) return dateStr;
    const y = parseInt(match[1]), m = parseInt(match[2]), d = parseInt(match[3]);
    if (y >= 2019) return `R${y - 2018}年${m}月${d}日`;
    if (y >= 1989) return `H${y - 1988}年${m}月${d}日`;
    return `${y}年${m}月${d}日`;
}

function cleanMemo(text) {
    let t = text;
    t = t.replace(/[〜～ー−]/g, '-');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
}

function getDisplayWidth(str) {
    let width = 0;
    for (let i = 0; i < str.length; i++) {
        width += str[i].match(/[ -~]/) ? 0.5 : 1;
    }
    return width;
}

function compressMemos(memos) {
    if (memos.length === 0) return "";

    const MAX_WIDTH = 32;

    function buildString(kanriLevel, seisouLevel, houteiLevel, removeBrackets, removeJisshi) {
        let arr = [...memos];
        if (removeBrackets) arr = arr.map(m => m.replace(/（[^）]*）|\([^)]*\)/g, ''));
        if (removeJisshi) arr = arr.map(m => m.replace(/実施：/g, ''));

        arr = arr.map(m => {
            let t = m;
            t = t.replace(/令和/g, 'R').replace(/平成/g, 'H');
            t = t.replace(/([0-9０-９])\s*トン/g, '$1トン');

            if (kanriLevel === 1) t = t.replace(/浄化槽維持管理費/g, '浄化槽管理費');
            else if (kanriLevel === 2) t = t.replace(/(浄化槽維持管理費|浄化槽管理費|維持管理費|管理費)/g, '管理費');

            if (seisouLevel === 1) t = t.replace(/浄化槽汚泥引抜清掃/g, '汚泥引抜清掃');
            else if (seisouLevel === 2) t = t.replace(/(浄化槽汚泥引抜清掃|汚泥引抜清掃)/g, '引抜清掃');
            else if (seisouLevel === 3) t = t.replace(/(浄化槽汚泥引抜清掃|汚泥引抜清掃|引抜清掃)/g, '清掃');

            if (houteiLevel === 1) t = t.replace(/法定検査手数料/g, '法定検査');
            return t.trim();
        });

        if (arr.length === 1) return arr[0];

        const isKanri = (m) => m.includes('管理費') || m.includes('維持管理');
        const isSeisou = (m) => !isKanri(m) && (m.includes('清掃') || m.includes('引抜'));
        const kanriItems = arr.filter(isKanri);
        const seisouItems = arr.filter(isSeisou);
        const otherItems = arr.filter(m => !isKanri(m) && !isSeisou(m));
        const sorted = [...kanriItems, ...seisouItems, ...otherItems];

        let result = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            let next = sorted[i];
            const km1 = result.match(/(浄化槽維持管理費|浄化槽管理費|維持管理費|管理費)/);
            const km2 = next.match(/(浄化槽維持管理費|浄化槽管理費|維持管理費|管理費)/);
            if (km1 && km2) {
                let stripped = next.replace(km2[0], '').trim();
                if (stripped === "") continue;
                next = stripped;
            }
            result += " / " + next;
        }
        return result;
    }

    let res = buildString(0, 0, 0, false, false);
    if (getDisplayWidth(res) <= MAX_WIDTH) return res;

    res = buildString(0, 0, 0, true, false);
    if (getDisplayWidth(res) <= MAX_WIDTH) return res;

    res = buildString(0, 1, 1, true, false);
    if (getDisplayWidth(res) <= MAX_WIDTH) return res;

    res = buildString(0, 2, 1, true, false);
    if (getDisplayWidth(res) <= MAX_WIDTH) return res;

    res = buildString(0, 3, 1, true, false);
    if (getDisplayWidth(res) <= MAX_WIDTH) return res;

    res = buildString(1, 3, 1, true, false);
    if (getDisplayWidth(res) <= MAX_WIDTH) return res;

    res = buildString(2, 3, 1, true, false);
    if (getDisplayWidth(res) <= MAX_WIDTH) return res;

    res = buildString(2, 3, 1, true, true);
    if (getDisplayWidth(res) <= MAX_WIDTH) return res;

    return res.substring(0, Math.floor(MAX_WIDTH) - 2) + "...他";
}

function getCurrentId() {
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get('CheckNumber') || params.get('ContractNumber') || "unknown";
    } catch(e) { return "unknown"; }
}

function getSavedMemos() {
    const currentId = getCurrentId();
    const data = Storage.load();
    if (!data) return [];
    if (data.id !== currentId || Date.now() - data.timestamp > 30 * 60 * 1000) return [];
    return data.memos || [];
}

function processDocument(doc) {
    if (!doc) return;

    // 【1】残高エリアの移動
    let hasZandakaHeader = false;
    const headers = Array.from(doc.querySelectorAll('*')).filter(el =>
        (el.textContent || "").trim() === '残高' && el.tagName !== 'SCRIPT' && el.children.length === 0
    );
    if (headers.length > 0) hasZandakaHeader = true;

    headers.forEach(header => {
        const container = header.parentElement;
        const section = header.nextElementSibling;
        if (container && section && container.firstElementChild !== header) {
            container.prepend(section);
            container.prepend(header);
        }
    });

    // 【2】Copyボタン配置
    const savedMemos = getSavedMemos();
    const allTrs = Array.from(doc.querySelectorAll('tr'));
    let currentBlockTargets = [];
    const finalValidTargets = [];
    let currentSlipDate = "";

    allTrs.forEach(tr => {
        const text = tr.innerText || tr.textContent || "";
        let isRed = false;
        const trColor = window.getComputedStyle(tr).color.replace(/\s/g, '');
        if (trColor.includes('rgb(255,0,0)')) isRed = true;
        tr.querySelectorAll('*').forEach(el => {
            const c = window.getComputedStyle(el).color.replace(/\s/g, '');
            const a = (el.getAttribute('color') || "").toLowerCase();
            if (c.includes('rgb(255,0,0)') || a === 'red' || a === '#ff0000') isRed = true;
        });

        if (isRed) currentBlockTargets.forEach(t => { t.dataset.cancelBtn = "true"; });
        if (text.includes('伝票番号')) {
            currentBlockTargets = [];
            const dm = text.match(/[0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2}/);
            if (dm) currentSlipDate = toWareki(dm[0]);
        }
        if (/[@＠][0-9０-９]/.test(text) && !tr.querySelector('input:not([type="hidden"]), select, textarea')) {
            if (!tr.dataset.cancelBtn) tr.dataset.cancelBtn = "false";
            if (!isRed) {
                tr.dataset.slipDate = currentSlipDate;
                currentBlockTargets.push(tr);
                if (!finalValidTargets.includes(tr)) finalValidTargets.push(tr);
            } else {
                tr.dataset.cancelBtn = "true";
            }
        }
    });

    finalValidTargets.forEach(tr => {
        if (tr.dataset.cancelBtn === "true") return;

        const tds = tr.querySelectorAll('td');
        if (tds.length === 0) return;
        const firstTd = tds[0];

        let rawText = (firstTd.innerText || firstTd.textContent || "").trim();
        rawText = rawText.split(/[@＠]/)[0].replace(/📋 Copy/g, '').replace(/✓ 追加済/g, '').replace(/\n/g, ' ').trim();

        let formattedMemo = cleanMemo(rawText);

        if (formattedMemo.includes('当月分')) {
            let slipYearMonth = "";
            if (tr.dataset.slipDate) {
                let ymMatch = tr.dataset.slipDate.match(/(.*?年[0-9]{1,2}月)/);
                if (ymMatch) slipYearMonth = ymMatch[1];
            }
            if (slipYearMonth) {
                formattedMemo = formattedMemo.replace('当月分', slipYearMonth + '分');
                let redundant = ' / ' + slipYearMonth + '分';
                if (formattedMemo.includes(redundant)) formattedMemo = formattedMemo.replace(redundant, '');
                formattedMemo = formattedMemo.replace(/(浄化槽維持管理費|浄化槽管理費|維持管理費|管理費)/, '浄化槽維持管理費');
            }
        } else if (!formattedMemo.includes('管理費') && !formattedMemo.includes('維持管理費') && tr.dataset.slipDate) {
            formattedMemo = tr.dataset.slipDate + "実施：" + formattedMemo;
        }

        const isAlreadySaved = savedMemos.includes(formattedMemo);
        let btn = tr.querySelector('.hhc-copy-btn');
        if (!btn) {
            firstTd.style.position = 'relative'; firstTd.style.paddingRight = '85px';
            btn = doc.createElement('button'); btn.className = 'hhc-copy-btn';
            btn.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);color:white;border:none;padding:6px 12px;border-radius:4px;font-size:12px;font-weight:bold;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.2);z-index:10;';
            firstTd.appendChild(btn);
        }

        if (isAlreadySaved) {
            btn.innerHTML = '✓ 追加済'; btn.style.background = '#95a5a6'; btn.style.cursor = 'default'; btn.disabled = true;
        } else {
            btn.innerHTML = '📋 Copy'; btn.style.background = '#0284c7'; btn.style.cursor = 'pointer'; btn.disabled = false;

            btn.onclick = (e) => {
                e.stopPropagation();
                const currentId = getCurrentId();
                let data = Storage.load() || { id: currentId, timestamp: Date.now(), memos: [] };
                if (!data.memos.includes(formattedMemo)) {
                    data.memos.push(formattedMemo); data.timestamp = Date.now(); Storage.save(data);
                }
                const count = data.memos.length;
                const finalMemo = compressMemos(data.memos);

                showToast(count === 1 ? `✅ コピーしました！\n${finalMemo}` : `✅ ${count}件目を追加・自動整理しました！\n${finalMemo}`);

                btn.innerHTML = '✓ 追加済'; btn.style.background = '#95a5a6'; btn.style.cursor = 'default'; btn.disabled = true;
            };
        }
    });

    // 【3】入金画面：自動打鍵 ＆ 但し書き入力
    const visibleInputs = Array.from(doc.querySelectorAll('input, textarea')).filter(el => {
        try { return el.getBoundingClientRect().width > 0; } catch(e) { return true; }
    });

    let totalInput = null; let depositInput = null; let isKaikeiGamen = false;
    visibleInputs.forEach(input => {
        const tr = input.closest('tr');
        if (tr) {
            if (tr.textContent.includes('合計請求')) totalInput = input;
            if (tr.textContent.includes('お預かり')) { depositInput = input; isKaikeiGamen = true; }
        }
    });

    const textInputs = visibleInputs.filter(el => el.tagName === 'TEXTAREA' || el.type === 'text');
    const memoInput = textInputs.length > 0 ? textInputs[textInputs.length - 1] : null;

    if (depositInput && totalInput && totalInput.value && totalInput.value !== "0") {
        if (!depositInput.dataset.autoFilled && (depositInput.value === "" || depositInput.value === "0")) {
            depositInput.dataset.autoFilled = "true";
            const amountStr = totalInput.value.replace(/,/g, '');
            depositInput.click(); depositInput.focus();

            depositInput.style.backgroundColor = '#dbeafe';
            setTimeout(() => depositInput.style.backgroundColor = '', 800);

            setTimeout(() => {
                let i = 0;
                function pressNextDigit() {
                    if (i < amountStr.length) {
                        const digit = amountStr[i];
                        const keys = Array.from(doc.querySelectorAll('td, button, div, span'));
                        const keyBtn = keys.find(el => (el.textContent || "").trim() === digit && el.children.length === 0);
                        if (keyBtn) keyBtn.click();
                        i++;
                        setTimeout(pressNextDigit, 150);
                    } else {
                        setTimeout(() => {
                            const keys = Array.from(doc.querySelectorAll('td, button, div, span'));
                            const enterKey = keys.find(el => (el.textContent || "").trim() === 'E' && el.children.length === 0);
                            if (enterKey) enterKey.click();
                        }, 300);
                    }
                }
                pressNextDigit();
            }, 500);
        }
    }

    if (isKaikeiGamen && memoInput && !memoInput.dataset.autoPasted) {
        const data = Storage.load();
        if (data && data.memos && data.memos.length > 0) {
            let finalMemo = compressMemos(data.memos);

            finalMemo = finalMemo.replace(/(\s*[\/、,]\s*当月分|当月分\s*[\/、,]\s*)/g, '');
            let parts = finalMemo.split(/\s*[\/]\s*/);
            let uniqueParts = [...new Set(parts)];
            finalMemo = uniqueParts.join(' / ');

            if (memoInput.value === "") {
                memoInput.value = finalMemo;
                memoInput.dispatchEvent(new Event('input', { bubbles: true }));
                memoInput.dispatchEvent(new Event('change', { bubbles: true }));
                memoInput.dataset.autoPasted = "true";
                Storage.clear();

                memoInput.style.backgroundColor = '#dbeafe';
                setTimeout(() => memoInput.style.backgroundColor = '', 800);
                showToast("⚡ 但し書きを自動入力しました！");
            }
        }
    }

    // 【4】折りたたみ機能
    if (hasZandakaHeader) {
        const foldables = ['契約情報', '点検履歴', '清掃履歴'];
        Array.from(doc.querySelectorAll('*')).filter(el => {
            const text = (el.textContent || "").trim();
            return foldables.includes(text) && el.children.length === 0 && el.tagName !== 'SCRIPT';
        }).forEach(header => {
            if (header.dataset.accordion) return;
            header.dataset.accordion = "true";
            header.style.cssText += ';cursor:pointer;background:#e2e8f0;padding:10px;font-weight:bold;border-bottom:1px solid #cbd5e1;color:#334155;';
            header.innerHTML += " ▼";
            const content = [];
            let next = header.nextElementSibling;
            while (next && !foldables.includes((next.textContent || "").trim()) && (next.textContent || "").trim() !== '残高') {
                content.push(next); next = next.nextElementSibling;
            }
            content.forEach(el => { if (el) el.style.display = 'none'; });
            header.onclick = () => {
                const show = content[0]?.style.display === 'none';
                content.forEach(el => { if (el) el.style.display = show ? '' : 'none'; });
                header.innerHTML = header.innerText.replace(/[▼▲]/g, '').trim() + (show ? ' ▲' : ' ▼');
            };
        });
    }
}

function runAllFeatures() {
    processDocument(document);
    document.querySelectorAll('iframe').forEach(ifr => {
        try {
            const innerDoc = ifr.contentDocument || ifr.contentWindow.document;
            processDocument(innerDoc);
        } catch(e) {}
    });
}