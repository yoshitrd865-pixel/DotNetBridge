// wwwroot/js/modules/settings.js

const SETTINGS_KEY = 'tfk_app_settings';

export const FEATURES = [
    { id: "app_lock", name: "🔐 アプリ起動ロック", default: true },
    { id: "quick_tenken", name: "⚡ 超・クイック点検くん", default: false },
    { id: "zandaka_copy", name: "📋 残高コピーくん", default: true },
    { id: "tenkenbox_worp", name: "📦 点検BOXワープくん", default: true },
    { id: "auto_login", name: "🔑 自動ログインくん", default: true },
    { id: "claude_fusen", name: "📝 クラウド付箋くん", default: true },
    { id: "mitenken_map", name: "🗺️ 未点検マップ化くん", default: false },
    { id: "hhc_pay_kun", name: "💳 HHC_Pay (QR決済)", default: false },
    { id: "seikyu_rireki_kun", name: "💳 請求書履歴くん", default: false },
    { id: "pc_mode", name: "🖥️ PCサイト表示モード", default: true }
];

export function getSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        const parsed = saved ? JSON.parse(saved) : {};
        const result = {};
        FEATURES.forEach(f => {
            result[f.id] = (parsed[f.id] !== undefined) ? parsed[f.id] : f.default;
        });
        return result;
    } catch (e) {
        const defaults = {};
        FEATURES.forEach(f => defaults[f.id] = f.default);
        return defaults;
    }
}

function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ⚙️ メニュー画面にUIを挿入
export function initSettingsMenu() {
    if (document.getElementById('tfk-custom-settings-card')) return;

    // 「ログアウト」ボタンまたはフォームを探す
    const logoutBtn = document.querySelector('input[value*="ログアウト"], button:contains("ログアウト")') || document.querySelector('form');
    if (!logoutBtn) return;

    const currentSettings = getSettings();

    // カードUI要素を作成
    const card = document.createElement('div');
    card.id = 'tfk-custom-settings-card';
    card.style.cssText = 'width:92%; max-width:400px; margin:20px auto; background:#fff; border-radius:16px; box-shadow:0 4px 15px rgba(0,0,0,0.08); padding:16px; font-family:-apple-system, BlinkMacSystemFont, sans-serif; box-sizing:border-box; border:1px solid #eef2f5;';

    // スイッチ項目の描画
    let listHtml = FEATURES.map(f => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #f0f3f6;">
            <span style="font-size:15px; font-weight:600; color:#334155;">${f.name}</span>
            <label style="position:relative; display:inline-block; width:48px; height:26px; margin:0;">
                <input type="checkbox" data-id="${f.id}" ${currentSettings[f.id] ? 'checked' : ''} style="opacity:0; width:0; height:0;">
                <span class="tfk-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#e2e8f0; transition:.3s; border-radius:26px;"></span>
            </label>
        </div>
    `).join('');

    card.innerHTML = `
        <style>
            .tfk-slider:before {
                position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px;
                background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            input:checked + .tfk-slider { background-color: #22c55e; }
            input:checked + .tfk-slider:before { transform: translateX(22px); }
        </style>
        <div style="display:flex; justify-content:space-between; align-items:center; font-weight:bold; color:#64748b; font-size:14px; margin-bottom:8px;">
            <span>⚙️ TFK便利機能カスタマイズ</span>
            <span>▼</span>
        </div>
        <div id="tfk-switches-body">
            ${listHtml}
        </div>
    `;

    // ログアウト要素の後ろに挿入
    logoutBtn.parentNode.insertBefore(card, logoutBtn.nextSibling);

    // スイッチ変更時の即時保存イベント
    card.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.addEventListener('change', () => {
            const updated = getSettings();
            updated[chk.getAttribute('data-id')] = chk.checked;
            saveSettings(updated);
        });
    });
}