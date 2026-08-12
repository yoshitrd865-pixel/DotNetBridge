// wwwroot/js/modules/router.js
export function getCurrentPage() {
    const path = window.location.pathname.toLowerCase();

    if (path.includes("sheetsalesreceipt.asp")) return "receipt"; // ★ 伝票・請求画面
    return "other";
}