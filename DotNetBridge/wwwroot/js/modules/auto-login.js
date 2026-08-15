// wwwroot/js/modules/auto-login.js

import { getSettings } from './settings.js';

const STORAGE_KEY = 'tfk_auto_login_data';
let isEventListenerAttached = false; // ★ 二重リスナー登録＆ダイアログ無限ループ防止フラグ

export function initAutoLogin() {
    // ⚙️ 設定で「自動ログイン」がOFFになっている場合は発動させない
    if (!getSettings().auto_login) return;

    const pwInput = document.querySelector('input[type="password"]');
    if (!pwInput) return;

    const form = pwInput.closest('form');
    if (!form) return;

    const savedDataJson = localStorage.getItem(STORAGE_KEY);

    // 🚀 発動モード：記憶データがあれば自動入力して即送信
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
                showResetButton();

                setTimeout(() => {
                    const submitBtn = form.querySelector('input[type="submit"], button[type="submit"], input[value*="ログイン"], input[value*="ﾛｸﾞｲﾝ"], a[href*="login"]');
                    if (submitBtn) {
                        submitBtn.click();
                    } else {
                        form.submit();
                    }
                }, 1200);
            }
        } catch (e) {
            console.error("[AutoLogin] エラー:", e);
        }
    } 
    // 💾 記憶モード：データがなければ送信イベントをフック
    else {
        // すでにリスナーをセット済みの場合は重ねて登録しない（無限ループ防止）
        if (isEventListenerAttached) return;

        const handleSaveAndSubmit = (e) => {
            // 一旦フォームのデフォルト送信をストップ
            e.preventDefault();

            const inputs = form.querySelectorAll('input[type="text"], input[type="number"], input[type="email"], input[type="password"]');
            const data = {};

            inputs.forEach(inp => {
                if (inp.name && inp.value.trim() !== "") {
                    data[inp.name] = inp.value.trim();
                }
            });

            if (Object.keys(data).length > 0) {
                // 確認ダイアログを表示
                if (confirm('🔒 このログイン情報を端末に記憶して、次回から自動でログインしますか？')) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                }
            }

            // 保存処理完了後、イベントを取り除いて本来のフォーム送信を実行！
            form.removeEventListener('submit', handleSaveAndSubmit);
            form.submit();
        };

        form.addEventListener('submit', handleSaveAndSubmit);
        isEventListenerAttached = true; // ★ 登録済みフラグを立てる
    }
}

function showResetButton() {
    if (document.getElementById('auto-login-reset-btn')) return;

    const resetBtn = document.createElement('div');
    resetBtn.id = 'auto-login-reset-btn';
    resetBtn.innerHTML = '🔄 自動ログインを解除';
    resetBtn.style.cssText = 'position:fixed; top:15px; left:15px; background:rgba(231, 76, 60, 0.95); color:white; padding:10px 15px; border-radius:8px; z-index:999999; cursor:pointer; font-weight:bold; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
    
    resetBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        localStorage.removeItem(STORAGE_KEY);
        alert('自動ログイン設定を解除しました。次回から手動入力になります。');
        resetBtn.remove();
        window.location.reload();
    };

    document.body.appendChild(resetBtn);
}