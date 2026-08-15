// wwwroot/js/modules/settings.js

const SETTINGS_KEY = 'tfk_app_settings';

export const FEATURES = [
    { id: "app_lock", name: "🔐 アプリ起動ロック", default: false, implemented: false },
    { id: "quick_tenken", name: "⚡ 超・クイック点検くん", default: false, implemented: false },
    { id: "zandaka_copy", name: "📜 残高コピーくん", default: true, implemented: true },
    { id: "tenkenbox_worp", name: "📦 点検BOXワープくん", default: true, implemented: true }, // ★ 初期ON
    { id: "auto_login", name: "🔑 自動ログインくん", default: true, implemented: true }, // ★ 初期ON
    { id: "claude_fusen", name: "📝 クラウド付箋くん", default: false, implemented: false },
    { id: "mitenken_map", name: "🗺️ 未点検マップ化くん", default: false, implemented: false },
    { id: "hhc_pay_kun", name: "💳 HHC_Pay (QR決済)", default: true, implemented: true },   // ★ 初期ON
    { id: "seikyu_rireki_kun", name: "💳 請求書履歴くん", default: false, implemented: false },
    { id: "continuous_upload", name: "📸 連続アップロードくん", default: true, implemented: true } // ★ 初期ON
];

export function getSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        const parsed = saved ? JSON.parse(saved) : {};
        const result = {};
        FEATURES.forEach(f => {
            // 保存値があればそれを優先、無ければデフォルト値を使う
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

export function initSettingsMenu() {
    if (document.getElementById('tfk-custom-settings-card')) return;

    let logoutBtn = document.querySelector('input[value*="ログアウト"]');
    if (!logoutBtn) {
        const candidates = Array.from(document.querySelectorAll('button, a, div, input'));
        logoutBtn = candidates.find(el => el.textContent && el.textContent.includes('ログアウト'));
    }
    if (!logoutBtn) logoutBtn = document.querySelector('form');

    const currentSettings = getSettings();

    const card = document.createElement('div');
    card.id = 'tfk-custom-settings-card';
    card.style.cssText = 'width:92%; max-width:400px; margin:20px auto; background:#fff; border-radius:16px; box-shadow:0 4px 15px rgba(0,0,0,0.08); padding:16px; font-family:-apple-system, BlinkMacSystemFont, sans-serif; box-sizing:border-box; border:1px solid #eef2f5;';

    let listHtml = FEATURES.map(f => {
        const badge = !f.implemented ? '<span style="font-size:11px; background:#f1f5f9; color:#94a3b8; padding:2px 6px; border-radius:4px; margin-left:6px; font-weight:normal;">未実装</span>' : '';
        
        // 実装済みの場合は、現在の設定（またはデフォルト）を反映
        const isChecked = f.implemented ? currentSettings[f.id] : false;
        const disabledAttr = !f.implemented ? 'disabled' : '';
        const opacityStyle = !f.implemented ? 'opacity: 0.5;' : '';

        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid #f0f3f6; ${opacityStyle}">
                <div style="display:flex; align-items:center;">
                    <span style="font-size:15px; font-weight:600; color:#334155;">${f.name}</span>
                    ${badge}
                </div>
                <label style="position:relative; display:inline-block; width:48px; height:26px; margin:0;">
                    <input type="checkbox" class="tfk-toggle-input" data-id="${f.id}" ${isChecked ? 'checked' : ''} ${disabledAttr} style="opacity:0; width:0; height:0;">
                    <span class="tfk-slider" style="position:absolute; cursor:${f.implemented ? 'pointer' : 'not-allowed'}; top:0; left:0; right:0; bottom:0; background-color:#cbd5e1; transition:.3s; border-radius:26px;"></span>
                </label>
            </div>
        `;
    }).join('');

    card.innerHTML = `
        <style>
            .tfk-slider:before {
                position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px;
                background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            /* チェックが入っている時は明るい緑色にする */
            .tfk-toggle-input:checked + .tfk-slider { background-color: #22c55e !important; }
            .tfk-toggle-input:checked + .tfk-slider:before { transform: translateX(22px); }
        </style>
        <div style="display:flex; justify-content:space-between; align-items:center; font-weight:bold; color:#64748b; font-size:14px; margin-bottom:8px;">
            <span>⚙️ TFK便利機能カスタマイズ</span>
            <span>▼</span>
        </div>
        <div id="tfk-switches-body">
            ${listHtml}
        </div>
    `;

    if (logoutBtn && logoutBtn.parentNode) {
        logoutBtn.parentNode.insertBefore(card, logoutBtn.nextSibling);
    } else {
        document.body.appendChild(card);
    }

    // スイッチ保存処理
    card.querySelectorAll('.tfk-toggle-input').forEach(chk => {
        chk.addEventListener('change', () => {
            const updated = getSettings();
            updated[chk.getAttribute('data-id')] = chk.checked;
            saveSettings(updated);
        });
    });
}