// wwwroot/js/modules/auto-login.js

const STORAGE_KEY = 'tfk_auto_login_data';
let isEventListenerAttached = false; // 重複登録防止

export function initAutoLogin() {
    // 🚨 1. ログイン失敗画面（詰み防止）の判定
    const pageText = document.body ? document.body.innerText : '';
    const isLoginErrorScreen = window.location.pathname.toLowerCase().includes('login.asp') || pageText.includes('ログインに失敗しました');

    if (isLoginErrorScreen) {
        handleLoginFailureUI();
        return; // 自動送信ループを完全にブロック
    }

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
                // 🔓 手動で記憶を解除できるボタンをフォーム上部に表示
                renderClearCredentialsButton(form);

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

// 🛠️ 2. ログイン失敗時の自動クリーンアップ ＆ リセットUI表示関数（システムのブルー基調に調整）
function handleLoginFailureUI() {
    if (document.getElementById('auto-login-reset-box')) return;

    // 間違った記憶データを自動消去して無限ループを防止
    localStorage.removeItem(STORAGE_KEY);

    const container = document.createElement('div');
    container.id = 'auto-login-reset-box';
    container.style.cssText = `
        position: fixed;
        top: 20px; left: 50%;
        transform: translateX(-50%);
        width: 90%; max-width: 400px;
        background: #ffffff;
        border: 2px solid #007AFF;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.15);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        text-align: center;
        box-sizing: border-box;
        animation: fadeIn 0.3s ease-in-out;
    `;

    container.innerHTML = `
        <div style="font-size: 16px; font-weight: bold; color: #007AFF; margin-bottom: 8px;">
            ⚠️ 自動ログイン情報をリセットしました
        </div>
        <div style="font-size: 13px; color: #475569; margin-bottom: 16px; line-height: 1.4;">
            ログインに失敗したため、端末に記憶していたログイン情報を自動消去しました。
        </div>
        <button id="reset-autologin-btn" style="
            width: 100%;
            padding: 12px;
            background: #007AFF;
            color: #ffffff;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(0, 122, 255, 0.3);
        ">
            🔄 再ログイン画面へ
        </button>
    `;

    document.body.appendChild(container);

    document.getElementById('reset-autologin-btn').onclick = () => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('auto_login_id');
        localStorage.removeItem('auto_login_pass');
        
        window.location.href = '/'; 
    };
}

// 🔓 3. フォーム画面でいつでも手動で記憶を解除できるボタン
function renderClearCredentialsButton(form) {
    if (document.getElementById('auto-login-clear-btn')) return;

    const clearBtn = document.createElement('button');
    clearBtn.id = 'auto-login-clear-btn';
    clearBtn.type = 'button';
    clearBtn.innerText = '🔓 記憶中のログイン情報を削除（別アカウントで入る）';
    clearBtn.style.cssText = `
        width: 100%;
        margin-bottom: 15px;
        padding: 10px;
        background: #f1f5f9;
        color: #007AFF;
        border: 1px solid #007AFF;
        border-radius: 8px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
    `;

    clearBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm('記憶されているログイン情報を削除しますか？\n次回送信時に新しいログイン情報を記憶できます。')) {
            localStorage.removeItem(STORAGE_KEY);
            alert('ログイン情報を削除しました。');
            window.location.reload();
        }
    };

    form.parentNode.insertBefore(clearBtn, form);
}

// 👑 アプリ風かっこいいローディング表示関数（システム標準ブルーに調整）
function showLoadingOverlay() {
    if (document.getElementById('auto-login-loading-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'auto-login-loading-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
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
                border: 4px solid rgba(255, 255, 255, 0.2);
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
        <div style="font-size: 13px; color: #93c5fd;">
            🔒 セッションを安全に同期しています
        </div>
    `;

    document.body.appendChild(overlay);
}