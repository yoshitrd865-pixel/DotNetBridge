// wwwroot/js/modules/feature1.js

export function initFeature1() {
    if (document.body.dataset.feature1Applied) return;

    console.log("[ProxyInject] 機能1の処理を実行しました");
    
    document.body.dataset.feature1Applied = "true";
}