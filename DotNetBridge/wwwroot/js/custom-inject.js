// wwwroot/js/custom-inject.js
import { observeDOM } from './modules/ecomaster/common.js';
import { getCurrentPage } from './modules/ecomaster/router.js';
import { initStripePay } from './modules/ecomaster/stripe-pay.js';
import { initAutoLogin } from './modules/ecomaster/auto-login.js';
import { initContinuousUpload } from './modules/ecomaster/continuous-upload.js';
import { initSettingsMenu, getSettings } from './modules/ecomaster/settings.js';
import { initInspectionWarp } from './modules/ecomaster/inspection-warp.js';
import { initZandakaCopy } from './modules/ecomaster/zandaka-copy.js';
import { initFusenKun } from './modules/ecomaster/fusen-kun.js';
import { initCleanAutoLink } from './modules/ecomaster/clean-autolink.js';
import { initCommentSpeaker } from './modules/ecomaster/comment-speaker.js';
import { initInvoiceHistory } from './modules/ecomaster/invoice-history.js';

const isEcoPro = window.location.pathname.includes('/Main/') || document.querySelector('frameset') !== null;

if (!isEcoPro) {
    console.log("[ProxyInject] EcoMaster エンジン起動");

    const page = getCurrentPage();
    const isMenuStandard = window.location.pathname.includes("menuStandard.asp");

    function runIfEnabled(featureId, action) {
        const settings = getSettings();
        if (settings[featureId]) {
            action();
        } else {
            console.log(`[ProxyInject] ${featureId} は設定でOFFのためスキップ`);
        }
    }

    function captureOperatorName() {
        const pageTitleEl = document.querySelector('td.pagetitle');
        if (pageTitleEl) {
            const name = pageTitleEl.textContent.trim();
            if (name && name !== "メニュー") {
                localStorage.setItem('hhc_operator_name', name);
            }
        }
    }

    observeDOM(() => {
        captureOperatorName();

        if (page === "menu" && !isMenuStandard) {
            initSettingsMenu();
        }

        if (isMenuStandard) {
            runIfEnabled("invoice_history_kun", initInvoiceHistory);
        }

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

        runIfEnabled("auto_login", initAutoLogin);
        runIfEnabled("tenkenbox_worp", initInspectionWarp);
        runIfEnabled("zandaka_copy", initZandakaCopy);
        runIfEnabled("fusen_kun", initFusenKun);
        runIfEnabled("clean_autolink", initCleanAutoLink);
        runIfEnabled("comment_speaker", initCommentSpeaker);
    });
}