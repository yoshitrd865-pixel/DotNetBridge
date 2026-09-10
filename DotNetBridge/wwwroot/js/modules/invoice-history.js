// wwwroot/js/modules/invoice-history.js

const DB_NAME = 'ECOPRO3DB';
const DB_VERSION = 7;
const STORE_NAME = 'InvoiceHistory';

/* =========================================================
 * 1. IndexedDB 制御（ローカルキャッシュ）
 * ========================================================= */
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('savedAt', 'savedAt', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function addRecord(record) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).add(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
}

export async function getAllRecords() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
            const records = Array.isArray(req.result) ? req.result : [];
            records.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
            resolve(records);
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
}

/* =========================================================
 * 2. 高精度な帳票明細パース（神ロジック移植）
 * ========================================================= */
function normalizeText(value) {
    return String(value == null ? '' : value)
        .replace(/\u00a0/g, ' ')
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function hasAmount(value) {
    return /^[¥￥]?\s*-?[\d,]+(?:\.\d+)?\s*円?$/.test(normalizeText(value));
}

export function extractInvoiceItems(targetDoc = document) {
    const table = targetDoc.getElementById('tblSales');
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll('tr'));
    let headerInfo = null;

    // ヘッダー行の動的検出
    for (let i = 0; i < rows.length; i++) {
        const cells = Array.from(rows[i].children).filter(c => ['td', 'th'].includes(c.tagName.toLowerCase()));
        const texts = cells.map(c => normalizeText(c.innerText || c.textContent));
        if (texts.includes('日付') && texts.some(t => ['明細項目', '商品名称', '商品名', '品名'].includes(t)) && texts.includes('金額')) {
            headerInfo = {
                rowIndex: i,
                dateIdx: texts.indexOf('日付'),
                detailIdx: texts.findIndex(t => ['明細項目', '商品名称', '商品名', '品名'].includes(t)),
                amountIdx: texts.indexOf('金額')
            };
            break;
        }
    }

    if (!headerInfo) return [];

    const items = [];
    let previousDate = '';

    for (let i = headerInfo.rowIndex + 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].children).filter(c => ['td', 'th'].includes(c.tagName.toLowerCase()));
        if (cells.length <= Math.max(headerInfo.dateIdx, headerInfo.detailIdx, headerInfo.amountIdx)) continue;

        let itemDate = normalizeText(cells[headerInfo.dateIdx].innerText);
        const detailName = normalizeText(cells[headerInfo.detailIdx].innerText);
        const amount = normalizeText(cells[headerInfo.amountIdx].innerText);

        if (itemDate && /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(itemDate)) {
            previousDate = itemDate;
        } else if (!itemDate) {
            itemDate = previousDate;
        }

        // 「設置先」や見出し行の再除外
        if (!detailName || detailName.includes('設置先') || ['日付', '明細項目', '数量', '単価', '金額'].includes(detailName)) continue;
        if (!amount || !hasAmount(amount)) continue;

        items.push({ date: itemDate, detailName: detailName, amount: amount });
    }

    return items;
}

/* =========================================================
 * 3. 履歴保存 & 発行履歴UIモーダル
 * ========================================================= */
export async function saveInvoiceHistory() {
    const items = extractInvoiceItems();
    const urlParams = new URLSearchParams(window.location.search);
    
    const record = {
        savedAt: new Date().toISOString(),
        invoiceNo: urlParams.get("SalesSlipNumber") || urlParams.get("CheckNumber") || "未指定",
        customerCode: urlParams.get("SetUpCode") || "未指定",
        items: items
    };

    // 1. ローカルIndexedDBに保存
    await addRecord(record);

    // 2. Render側サーバーAPIへ非同期送信 (DB保存用)
    fetch('/api/InvoiceHistory/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
    }).catch(err => console.log('[History API Skip or Error]', err));
}

export async function showHistoryDialog() {
    const records = await getAllRecords();
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; z-index:2147483646; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:20px;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'width:100%; max-width:800px; max-height:85vh; background:#fff; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 10px 25px rgba(0,0,0,0.3); font-family:sans-serif;';

    let htmlContent = `
        <div style="background:#176dac; color:#fff; padding:15px 20px; display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:18px;">📜 請求書発行履歴 (${records.length}件)</h3>
            <button id="close-history-btn" style="background:transparent; border:1px solid #fff; color:#fff; padding:4px 12px; border-radius:4px; cursor:pointer;">閉じる</button>
        </div>
        <div style="padding:20px; overflow-y:auto; flex:1; background:#f8f9fa;">
    `;

    if (records.length === 0) {
        htmlContent += `<div style="text-align:center; color:#666; padding:40px;">保存された履歴はありません。</div>`;
    } else {
        records.forEach(r => {
            const dateStr = new Date(r.savedAt).toLocaleString('ja-JP');
            htmlContent += `
                <div style="background:#fff; border:1px solid #e0e0e0; border-radius:6px; padding:15px; margin-bottom:12px; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-weight:bold; font-size:14px; color:#333; margin-bottom:8px; display:flex; justify-content:space-between;">
                        <span>📅 ${dateStr} (伝票No: ${r.invoiceNo})</span>
                        <span style="color:#27ae60;">顧客コード: ${r.customerCode}</span>
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
                        <thead>
                            <tr style="background:#eee; color:#555;">
                                <th style="padding:6px; border:1px solid #ddd;">日付</th>
                                <th style="padding:6px; border:1px solid #ddd;">明細項目</th>
                                <th style="padding:6px; border:1px solid #ddd; text-align:right;">金額</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${r.items.map(item => `
                                <tr>
                                    <td style="padding:6px; border:1px solid #ddd; width:100px;">${item.date || '-'}</td>
                                    <td style="padding:6px; border:1px solid #ddd;">${item.detailName}</td>
                                    <td style="padding:6px; border:1px solid #ddd; text-align:right;">${item.amount}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });
    }

    htmlContent += `</div>`;
    dialog.innerHTML = htmlContent;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    document.getElementById('close-history-btn').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}