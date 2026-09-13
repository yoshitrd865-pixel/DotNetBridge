import { initKeshikomiAuto } from './modules/ecopro/keshikomi-auto.js';

(function () {
    if (window.__ecoproInjected) return;
    window.__ecoproInjected = true;

    const run = () => {
        if (typeof initKeshikomiAuto === 'function') {
            initKeshikomiAuto();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();