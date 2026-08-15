// wwwroot/js/modules/router.js
export function getCurrentPage() {
    const path = window.location.pathname.toLowerCase();

    if (path.includes("sheetsalesreceipt.asp")) return "receipt"; // ★ 伝票・請求画面
    // ★ login.asp または login.html の判定を追加
    if (path.includes("login.asp") || path.includes("login.html")) {
        return "login";
    }
// ★ 点検BOX(viewFile.asp) と 顧客BOX(viewInfo.asp) をアップロード対象に指定！
    if (path.includes("viewfile.asp") || path.includes("viewinfo.asp")) {
        return "upload";
    }
    
    
    return "other";
}