import { observeDOM } from './modules/common.js';
import { getCurrentPage } from './modules/router.js';
import { initStripePay } from './modules/stripe-pay.js';
import { initAutoLogin } from './modules/auto-login.js';
import { initContinuousUpload } from './modules/continuous-upload.js';
import { initSettingsMenu, getSettings } from './modules/settings.js';
import { initInspectionWarp } from './modules/inspection-warp.js';
import { initZandakaCopy } from './modules/zandaka-copy.js';
import { initFusenKun } from './modules/fusen-kun.js';

console.log("[ProxyInject] エンジン起動");

const page = getCurrentPage();

// 🛡️ 機能がONの時だけ安全に実行する一括ガード関数
function runIfEnabled(featureId, action) {
    const settings = getSettings();
    if (settings[featureId]) {
        action();
    } else {
        console.log(`[ProxyInject] ${featureId} は設定でOFFのためスキップ`);
    }
}
// ★ initFusenKun は observeDOM の外側で1回だけ起動させる！
runIfEnabled("fusen_kun", initFusenKun);

observeDOM(() => {
    // ⚙️ メニュー画面のカスタマイズカード表示（これは常に起動）
    if (page === "menu") {
        initSettingsMenu();
    }

    // 各機能の呼び出し（ここで一括判定！）
    switch (page) {
        case "receipt":
            runIfEnabled("hhc_pay_kun", initStripePay);
            break;

        case "login":
            runIfEnabled("auto_login", initAutoLogin);
            break;

        case "upload":
            runIfEnabled("continuous_upload", initContinuousUpload);
            break;
    }

    // 画面問わず動作する自動ログイン
    runIfEnabled("auto_login", initAutoLogin);
    // 📸 点検BOXワープ ＆ 戻るボタン修復（★ここに追加！）
    runIfEnabled("tenkenbox_worp", initInspectionWarp);
    runIfEnabled("zandaka_copy", initZandakaCopy);
});