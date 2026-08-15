// wwwroot/js/modules/inspection-warp.js

export function initInspectionWarp() {
    const url = window.location.href;

    // 🛠️ 1. viewFile.asp 専用：戻るボタン修復パッチ（ボタン設置はせず即終了）
    if (url.includes('viewFile.asp')) {
        window.close = function() { window.history.back(); };

        const fixBackButton = () => {
            document.querySelectorAll('*').forEach(el => {
                const oc = el.getAttribute('onclick') || "";
                if (oc.includes('window.close') || oc.includes('self.close')) {
                    el.setAttribute('onclick', 'window.history.back();');
                }
            });
        };

        fixBackButton();
        setTimeout(fixBackButton, 500);
        setInterval(fixBackButton, 2000);
        return; // ★ viewFile.asp ではここで処理終了
    }

    // 🎨 2. 顧客BOXリンク（a[href*="viewInfo.asp"]）の常時監視 ＆ ワープボタン生成
    const checkAndApply = () => {
        const kokyakuLink = document.querySelector('a[href*="viewInfo.asp"]');
        if (kokyakuLink) {
            addNativeLookingButton(kokyakuLink);
        } else {
            const btn = document.getElementById('native-warp-btn');
            if (btn) btn.remove();
        }
    };

    checkAndApply();
    setInterval(checkAndApply, 500);
}

function addNativeLookingButton(kokyakuLink) {
    if (document.getElementById('native-warp-btn')) return;

    // 浄化槽番号（SetUpCode）を取得
    const match = kokyakuLink.href.match(/SetUpCode=(\d+)/);
    if (!match) return;

    const setupCode = match[1];
    const kokyakuCell = kokyakuLink.parentElement;
    if (!kokyakuCell) return;

    // 隣の「透明な空きマス」を取得して乗っ取る
    let targetCell = kokyakuCell.nextElementSibling;
    const isNextEmpty = targetCell && targetCell.innerText.trim() === "";

    let newCell;
    if (isNextEmpty) {
        newCell = targetCell;
        newCell.id = 'native-warp-btn';
    } else {
        newCell = kokyakuCell.cloneNode(false);
        newCell.id = 'native-warp-btn';
        kokyakuCell.parentNode.insertBefore(newCell, kokyakuCell.nextSibling);
    }

    // 純正風ワープボタンを設置
    newCell.innerHTML = `
        <a href="javascript: window.open('viewFile.asp?SetUpCode=${setupCode}', 'viewFile');"
           style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-decoration: none; width: 100%; cursor: pointer; padding-top: 5px; opacity: 1; transition: opacity 0.2s;"
           onclick="this.style.opacity='0.5'; setTimeout(()=>this.style.opacity='1', 300);">
            <div style="font-size: 34px; color: #2980b9; line-height: 1; margin-bottom: 6px;">📷&#xFE0E;</div>
            <div style="font-size: 13px; color: #333; text-align: center; font-weight: normal; font-family: sans-serif;">点検BOX</div>
        </a>
    `;
}