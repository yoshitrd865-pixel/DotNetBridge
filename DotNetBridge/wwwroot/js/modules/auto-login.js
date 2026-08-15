// wwwroot/js/modules/auto-login.js

const STORAGE_KEY = 'tfk_auto_login_data';
let isEventListenerAttached = false; // 重複登録防止

export function initAutoLogin() {
    const pwInput = document.querySelector('input[type="password"]');
    if (!pwInput) return;

    const form = pwInput.closest('form');
    if (!form) return;

    const savedDataJson = localStorage.getItem(STORAGE_KEY);

    // 🚀 発動モード：記憶データがあればローディングを出して自動送信
    if (savedDataJson) {
        try {
            const data = JSON.parse(savedDataJson);
            let filled = false;

            for (const key in data) {
                const input = form.querySelector(`input[name="${key}"]`);
                if (input) {
                    input.value = data[key];
                    filled = true;
                }
            }

            if (filled) {
                // 🎨 かっこいいローディング画面を最前面に表示！
                showLoadingOverlay();

                setTimeout(() => {
                    const submitBtn = form.querySelector('input[type="submit"], button[type="submit"], input[value*="ログイン"], input[value*="ﾛｸﾞｲﾝ"], a[href*="login"]');
                    if (submitBtn) {
                        submitBtn.click();
                    } else {
                        form.submit();
                    }
                }, 800);
            }
        } catch (e) {
            console.error("[AutoLogin] エラー:", e);
        }
    } 
    // 💾 記憶モード：データがなければ送信イベントをフック
    else {
        if (isEventListenerAttached) return;

        const handleSaveAndSubmit = (e) => {
            e.preventDefault();

            const inputs = form.querySelectorAll('input[type="text"], input[type="number"], input[type="email"], input[type="password"]');
            const data = {};

            inputs.forEach(inp => {
                if (inp.name && inp.value.trim() !== "") {
                    data[inp.name] = inp.value.trim();
                }
            });

            if (Object.keys(data).length > 0) {
                if (confirm('🔒 このログイン情報を端末に記憶して、次回から自動でログインしますか？')) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                }
            }

            form.removeEventListener('submit', handleSaveAndSubmit);
            form.submit();
        };

        form.addEventListener('submit', handleSaveAndSubmit);
        isEventListenerAttached = true;
    }
}

// 👑 アプリ風かっこいいローディング表示関数
function showLoadingOverlay() {
    if (document.getElementById('auto-login-loading-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'auto-login-loading-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #ffffff;
        animation: fadeIn 0.2s ease-in-out;
    `;

    overlay.innerHTML = `
        <style>
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .tfk-spinner {
                width: 48px;
                height: 48px;
                border: 4px solid rgba(255, 255, 255, 0.15);
                border-left-color: #38bdf8;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                margin-bottom: 20px;
            }
        </style>
        <div class="tfk-spinner"></div>
        <div style="font-size: 18px; font-weight: bold; letter-spacing: 0.5px; margin-bottom: 8px;">
            EcoMaster 接続中...
        </div>
        <div style="font-size: 13px; color: #94a3b8;">
            🔒 セッションを安全に同期しています
        </div>
    `;

    document.body.appendChild(overlay);
}