// wwwroot/js/modules/router.js
export function getCurrentPage() {
    const path = window.location.pathname.toLowerCase();

    if (path.includes("menu.asp")) return "menu"; // ★ 追加
    if (path.includes("sheetsalesreceipt.asp")) return "receipt";
    if ((path.includes("login.asp") || path.includes("login.html")) && document.querySelector('input[type="password"]')) return "login";
    if (path.includes("viewfile.asp") || path.includes("viewinfo.asp")) return "upload";
    // 🧹 点検画面のルーティング判定（画面のASPファイル名に合わせて調整してください）
    if (path.includes("viewcheck") || path.includes("check")) return "inspection";
    
    return "other";
}