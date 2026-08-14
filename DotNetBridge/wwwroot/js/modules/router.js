// wwwroot/js/modules/router.js
export function getCurrentPage() {
    const path = window.location.pathname.toLowerCase();

    if (path.includes("sheetsalesreceipt.asp")) return "receipt"; // ★ 伝票・請求画面
    // ★ login.asp または login.html の判定を追加
    if (path.includes("login.asp") || path.includes("login.html")) {
        return "login";
    }
    
    
    return "other";
}