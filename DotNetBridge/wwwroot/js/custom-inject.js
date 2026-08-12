import { observeDOM } from './modules/common.js';
import { getCurrentPage } from './modules/router.js';
import { initStripePay } from './modules/stripe-pay.js'; // ★ この行を追加！

console.log("[ProxyInject] エンジン起動");

const page = getCurrentPage();

observeDOM(() => {
    switch (page) {
        case "receipt":
            initStripePay();
            break;
    }
});