import { observeDOM } from './modules/common.js';
import { getCurrentPage } from './modules/router.js';
import { initStripePay } from './modules/stripe-pay.js';
import { initAutoLogin } from './modules/auto-login.js';
import { initContinuousUpload } from './modules/continuous-upload.js';
import { initSettingsMenu } from './settings.js'; // ★ 追加

const page = getCurrentPage();

observeDOM(() => {
    switch (page) {
        case "menu":
            initSettingsMenu(); // ★ メニュー画面にカスタマイズカードを表示
            break;
        case "receipt":
            initStripePay();
            break;
        case "login":
            initAutoLogin();
            break;
        case "upload":
            initContinuousUpload();
            break;
    }

    initAutoLogin();
});