// wwwroot/js/modules/invoice-history.js

const DB_NAME = 'ECOPRO3DB';
const DB_VERSION = 7;
const STORE_NAME = 'InvoiceHistory';

/* =========================================================
 * 1. IndexedDB 制御
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
 * 2. menuStandard.asp 専用の自動解析＆保存
 * ========================================================= */
export async function saveInvoiceHistoryFromMenu() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const customerCode = urlParams.get("SetUpCode") || "未指定";
        const bodyText = document.body.innerText;

        // 1. 日付 & 伝票番号の抽出
        const slipMatch = bodyText.match(/(\d{4}\/\d{2}\/\d{2})\s*\[伝票番号:(\d+)\]/);
        if (!slipMatch) {
            console.log('[請求書履歴くん] 伝票情報が見つからないためスキップ');
            return;
        }

        const invoiceDate = slipMatch[1];
        const invoiceNo = slipMatch[2];

        // 2. 重複チェック（同一の顧客コード＋伝票番号が保存済みなら二重保存しない）
        const existingRecords = await getAllRecords();
        if (existingRecords.some(r => r.invoiceNo === invoiceNo && r.customerCode === customerCode)) {
            console.log(`[請求書履歴くん] 伝票No: ${invoiceNo} は既に保存済みです。`);
            return;
        }

        // 3. 残高テーブルからの明細・小計・消費税・合計の抽出
        const items = [];
        const tables = document.querySelectorAll('table');

        tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const text = row.innerText.trim();
                if (!text || text.includes('伝票番号')) return;

                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                    const detailName = cells[0].innerText.trim();
                    const amount = cells[1].innerText.trim();
                    if (detailName && amount) {
                        items.push({ date: invoiceDate, detailName: detailName, amount: amount });
                    }
                }
            });
        });

        if (items.length === 0) return;

        const record = {
            savedAt: new Date().toISOString(),
            invoiceNo: invoiceNo,
            customerCode: customerCode,
            items: items
        };

        // ローカルDB ＆ バックエンドAPIへの保存
        await addRecord(record);
        fetch('/api/InvoiceHistory/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record)
        }).catch(() => {});

        console.log('[請求書履歴くん] 自動保存完了:', record);

    } catch (e) {
        console.error('[請求書履歴くん] 解析エラー:', e);
    }
}

/* =========================================================
 * 3. 履歴表示モーダル
 * ========================================================= */
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

/* =========================================================
 * 4. 初期化関数
 * ========================================================= */
export function initInvoiceHistory() {
    if (window.invoiceHistoryInjected) return;
    window.invoiceHistoryInjected = true;

    // 画面が開いたら自動解析して保存
    saveInvoiceHistoryFromMenu();

    // 右下に「📜 発行履歴」ボタンを表示
    if (!document.getElementById('btn-show-invoice-history')) {
        const btn = document.createElement('button');
        btn.id = 'btn-show-invoice-history';
        btn.innerText = '📜 発行履歴を見る';
        btn.style.cssText = 'position:fixed; bottom:10px; right:10px; z-index:99999; background:#176dac; color:#fff; border:none; padding:8px 14px; border-radius:6px; font-weight:bold; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.3);';
        btn.onclick = showHistoryDialog;
        document.body.appendChild(btn);
    }
}