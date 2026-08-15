import { observeDOM } from './modules/common.js';
import { getCurrentPage } from './modules/router.js';
import { initStripePay } from './modules/stripe-pay.js';
import { initAutoLogin } from './modules/auto-login.js'; // ★ 追加

console.log("[ProxyInject] エンジン起動");

const page = getCurrentPage();

observeDOM(() => {
    switch (page) {
        case "receipt":
            initStripePay();
            break;
        case "login": // ★ ログイン画面の識別名（または画面問わず常に実行）
            initAutoLogin();
            break;
    }
    // 2. 画面問わず、パスワード入力枠があれば自動ログイン処理を動かす
    initAutoLogin();
});