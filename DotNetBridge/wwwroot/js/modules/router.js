// wwwroot/js/modules/router.js
export function getCurrentPage() {
    const path = window.location.pathname.toLowerCase();

    if (path.includes("menu.asp")) return "menu"; // ★ 追加
    if (path.includes("sheetsalesreceipt.asp")) return "receipt";
    if (path.includes("login.asp") || path.includes("login.html")) return "login";
    if (path.includes("viewfile.asp") || path.includes("viewinfo.asp")) return "upload";

    return "other";
}