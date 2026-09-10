// wwwroot/js/custom-inject.js
import { observeDOM } from './modules/common.js';
import { getCurrentPage } from './modules/router.js';
import { initStripePay } from './modules/stripe-pay.js';
//import { initAozoraPay } from './modules/aozora-pay.js'; あおぞら無効
import { initAutoLogin } from './modules/auto-login.js';
import { initContinuousUpload } from './modules/continuous-upload.js';
import { initSettingsMenu, getSettings } from './modules/settings.js';
import { initInspectionWarp } from './modules/inspection-warp.js';
import { initZandakaCopy } from './modules/zandaka-copy.js';
import { initFusenKun } from './modules/fusen-kun.js';
import { initCleanAutoLink } from './modules/clean-autolink.js';
import { initCommentSpeaker } from './modules/comment-speaker.js';
import { initInvoiceHistory } from './modules/invoice-history.js';

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

observeDOM(() => {
    // ⚙️ メニュー画面のカスタマイズカード表示
    if (page === "menu") {
        initSettingsMenu();
    }

    // 各機能の呼び出し
    switch (page) {
        case "receipt":
            runIfEnabled("hhc_pay_kun", initStripePay);
            break;

        case "menuStandard": // ★ 残高・業務メニュー画面で起動
            runIfEnabled("invoice_history_kun", initInvoiceHistory);
            break;

        case "login":
            runIfEnabled("auto_login", initAutoLogin);
            break;

        case "upload":
            runIfEnabled("continuous_upload", initContinuousUpload);
            break;
    }

    // 画面問わず動作する機能
    runIfEnabled("auto_login", initAutoLogin);
    runIfEnabled("tenkenbox_worp", initInspectionWarp);
    runIfEnabled("zandaka_copy", initZandakaCopy);
    runIfEnabled("fusen_kun", initFusenKun);
    runIfEnabled("clean_autolink", initCleanAutoLink);
    runIfEnabled("comment_speaker", initCommentSpeaker);
});