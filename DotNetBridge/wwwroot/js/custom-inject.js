import { observeDOM } from './modules/common.js';
import { getCurrentPage } from './modules/router.js';
import { initStripePay } from './modules/stripe-pay.js';

console.log("[ProxyInject] エンジン起動");

const page = getCurrentPage();

observeDOM(() => {
    // ログイン画面の時だけ連携再設定ボタンを注入
    initAccountRelinkButton();

    switch (page) {
        case "receipt":
            initStripePay();
            break;
    }
});

/**
 * login.html / login.asp またはログインフォームが存在する場合のみ
 * 連携再設定用ボタンを追加する関数
 */
function initAccountRelinkButton() {
    // 二重追加防止
    if (document.getElementById("btn-relink-account")) return;

    const path = window.location.pathname.toLowerCase();
    const isLoginPage = path.includes("login.html") || 
                        path.includes("login.asp") || 
                        document.querySelector("input[name='txtUserID']") !== null;

    if (!isLoginPage) return;

    const linkBtn = document.createElement("a");
    linkBtn.id = "btn-relink-account";
    linkBtn.href = "/Account/LinkAccount";
    linkBtn.innerText = "🔑 連携ID/パスワードの再設定はこちら";
    
    Object.assign(linkBtn.style, {
        display: "block",
        margin: "15px auto",
        textAlign: "center",
        width: "fit-content",
        backgroundColor: "#2c3e50",
        color: "#ffffff",
        padding: "10px 20px",
        borderRadius: "20px",
        fontSize: "13px",
        fontWeight: "bold",
        textDecoration: "none",
        boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
        transition: "background-color 0.2s"
    });

    linkBtn.addEventListener("mouseenter", () => linkBtn.style.backgroundColor = "#34495e");
    linkBtn.addEventListener("mouseleave", () => linkBtn.style.backgroundColor = "#2c3e50");

    const loginForm = document.querySelector("form") || document.body;
    loginForm.appendChild(linkBtn);
}