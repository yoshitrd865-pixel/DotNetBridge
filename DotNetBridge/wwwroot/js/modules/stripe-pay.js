// wwwroot/js/modules/stripe-pay.js

// 外部モジュール（PDF自動保存機能および設定管理）のインポート
import { setupAutoArchiveOnPrint, captureCurrentPageDom } from './pdf-archive.js';
import { getSettings } from './settings.js';

/**
 * HHC_Pay（Stripe決済QRコード生成・自動印刷連携）のメイン初期化関数
 */
export async function initStripePay() {
    // 1. 二重実行防止ガード: すでにQR表示エリアが存在する場合は二重処理を防ぐために即時終了
    if (document.getElementById('tfk-paygate-qr-area')) return;

    // 2. 画面判定ガード: 画面内に「今回請求額」というテキストが存在しない帳票・画面では起動しない
    if (!document.body.innerText.includes('今回請求額')) return;

    // ★【追加パッチ①】印刷時・キャプチャ時（PDFアーカイブ処理時）の強制全表示オーバーライドCSS注入
    // captureCurrentPageDom() や window.print() 実行時に本家ASPの印刷用CSS（@media print）が領収書枠を全開にする挙動を無効化
    if (!document.getElementById('tfk-hide-receipt-style')) {
        const style = document.createElement('style');
        style.id = 'tfk-hide-receipt-style';
        style.innerHTML = `
            @media all, print {
                /* 本家ASPの隠れ領収書要素（ID/Class名パターン）を強制遮断 */
                [id*="Receipt"], [class*="receipt"], .tblReceipt, [id*="領収"], [class*="領収"] {
                    display: none !important;
                    visibility: hidden !important;
                    height: 0 !important;
                    overflow: hidden !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ★【追加パッチ②】DOM直接検出による純正領収書（「領 収 書」「￥ 0.-」領域）のピンポイント完全消去
    // クラス名が定義されていないテーブル構造に対しても「領収書」「￥0.-」テキスト要素を直接潰してレイアウト崩れを防ぐ
    document.querySelectorAll('table, div, tr, td').forEach(el => {
        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, '');
        // 「領収書」や「￥0.-」を含み、かつ「今回請求額」（請求書本体）を含まない裏要素を対象に指定
        if ((txt.includes('領収書') || txt.includes('￥0.-') || txt.includes('￥0')) && !txt.includes('今回請求額')) {
            const targetBox = el.closest('table, div') || el;
            targetBox.style.setProperty('display', 'none', 'important');
            targetBox.style.setProperty('visibility', 'hidden', 'important');
        }
    });

    // 3. 自動印刷のフック制御: 処理中に勝手にブラウザの印刷ダイアログが開くのを一時的に差し止める
    const originalPrint = window.print;
    window.print = function() {}; // 一時的に空関数で上書きして印刷を無効化

    // 4. ステータストーストUIの生成: 画面左下に現在の処理状況（黒い固定カード）を表示
    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'position:fixed; bottom:10px; left:10px; background:rgba(0,0,0,0.8); color:#fff; padding:8px 12px; border-radius:8px; font-size:12px; z-index:999999; font-weight:bold; box-shadow:0 2px 5px rgba(0,0,0,0.3);';
    statusDiv.innerText = '💳 HHC_Pay: 画面を監視中...';
    document.body.appendChild(statusDiv);

    try {
        // 抽出用変数の初期化
        let amount = 0;                  // 請求金額
        let customerName = "お客様";     // 顧客名
        let customerCode = "未指定";     // 顧客コード
        let invoiceNo = "未指定";        // 伝票/請求番号
        let itemDescription = "浄化槽維持管理費"; // 明細項目名

        // 画面内の全テキスト表示要素を取得
        const allElements = document.querySelectorAll('th, td, div, span, b, p');

        // --------------------------------------------------
        // 【抽出ロジック 1】 請求金額（今回請求額）の取得
        // --------------------------------------------------
        for (let el of allElements) {
            if (el.textContent.trim() === '今回請求額') {
                // 「今回請求額」セルの右隣または親要素の次の要素から数値だけを抜き出す
                if (el.parentElement && el.parentElement.nextElementSibling) {
                    const numStr = el.parentElement.nextElementSibling.textContent.replace(/[^0-9]/g, '');
                    if (numStr) amount = parseInt(numStr, 10);
                }
                break;
            }
        }

        // --------------------------------------------------
        // 【抽出ロジック 2】 宛名（〇〇 様）の取得
        // --------------------------------------------------
        for (let el of allElements) {
            const text = el.textContent.trim();
            // 「様」を含み、30文字未満かつ「設置先」という文字を含まない要素を宛名として採択
            if (text.includes('様') && text.length < 30 && !text.includes('設置先')) {
                customerName = text;
                break;
            }
        }

        // --------------------------------------------------
        // 【抽出ロジック 3】 顧客コード & 伝票番号の抽出
        // --------------------------------------------------
        const urlParams = new URLSearchParams(window.location.search);

        // ① 顧客コード: URLパラメータ SetUpCode を優先、無ければ画面テキストから検索
        if (urlParams.get("SetUpCode") && urlParams.get("SetUpCode") !== "") {
            customerCode = urlParams.get("SetUpCode");
        } else {
            allElements.forEach(el => {
                const text = el.textContent.trim();
                if (/お客様番号|顧客コード|請求先コード/.test(text)) {
                    const codeMatch = text.match(/\d+/);
                    if (codeMatch) customerCode = codeMatch[0];
                }
            });
        }

        // ② 伝票番号: URLパラメータ (SalesSlipNumber / CheckNumber / CleanNumber) を順に優先検索
        if (urlParams.get("SalesSlipNumber") && urlParams.get("SalesSlipNumber") !== "") {
            invoiceNo = urlParams.get("SalesSlipNumber");
        } else if (urlParams.get("CheckNumber") && urlParams.get("CheckNumber") !== "") {
            invoiceNo = urlParams.get("CheckNumber");
        } else if (urlParams.get("CleanNumber") && urlParams.get("CleanNumber") !== "") {
            invoiceNo = urlParams.get("CleanNumber");
        } else {
            // URLパラメータに存在しない場合は画面テキスト（伝票番号/売上番号等）から抽出
            allElements.forEach(el => {
                const text = el.textContent.trim();
                if (/伝票番号|売上番号|請求番号/.test(text)) {
                    const invMatch = text.match(/\d+/);
                    if (invMatch) invoiceNo = invMatch[0];
                }
            });
        }

        // --------------------------------------------------
        // 【抽出ロジック 4】 明細項目名の取得
        // --------------------------------------------------
        const detailCells = document.querySelectorAll('td.detail, td[class*="detail"]');
        for (let cell of detailCells) {
            const text = cell.textContent.trim();
            // 日付・金額・消費税・設置先以外の主要な名目を明細項目名として取得
            if (
                text !== "" &&
                text !== "消費税" &&
                !text.includes('設置先') &&
                !/^\d{4}\/\d{2}\/\d{2}$/.test(text) &&
                !/^[0-9,]+$/.test(text)
            ) {
                itemDescription = text;
                break;
            }
        }

        // --------------------------------------------------
        // 金額チェックとエラー処理
        // --------------------------------------------------
        if (amount <= 0) {
            statusDiv.innerText = '⚠️ エラー: 金額読み取り失敗';
            statusDiv.style.background = '#c0392b';
            return;
        }

        // --------------------------------------------------
        // 【QRコード表示エリアの動的HTML構築】
        // --------------------------------------------------
        statusDiv.innerText = `💳 HHC_Pay: QRコード生成中...`;

        // 枠となるコンテナDIVを作成
        const qrContainer = document.createElement('div');
        qrContainer.id = 'tfk-paygate-qr-area';
        qrContainer.style.cssText = 'margin-top: 30px; padding: 20px; border: 2px dashed #F39C12; text-align: center; background: #fff; border-radius: 8px; width: 95%; margin-left: auto; margin-right: auto; page-break-inside: avoid;';

        // 画面内の売上テーブル（tblSales）の直後にQRエリアを配置（無ければbody末尾）
        const tblSales = document.getElementById('tblSales') || document.querySelector('table');
        if (tblSales) {
            tblSales.parentNode.insertBefore(qrContainer, tblSales.nextSibling);
        } else {
            document.body.appendChild(qrContainer);
        }

        // C# バックエンドの Stripe 決済セッション生成API宛のURLを組み立て
        const redirectUrl = `${window.location.origin}/api/StripePayment/redirect-checkout`
            + `?amount=${amount}`
            + `&customer_code=${encodeURIComponent(customerCode)}`
            + `&customer_name=${encodeURIComponent(customerName)}`
            + `&invoice_no=${encodeURIComponent(invoiceNo)}`
            + `&item_description=${encodeURIComponent(itemDescription)}`;

        // 外部QRコード生成APIを利用して画像URL化
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(redirectUrl)}`;

        // QRコードカードの内部HTMLを流し込み
        qrContainer.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; gap:25px; padding:10px;">
                <div><img id="stripe-qr-image-element" src="${qrImageUrl}" style="width:130px; height:130px;"></div>
                <div style="text-align: left;">
                    <h3 style="margin:0 0 6px 0; color:#E67E22; font-size:16px;">📱 スマホでお支払い（クレカ・PayPay・コンビニ）</h3>
                    <p style="margin:0; font-size:13px; color:#333; line-height:1.5;">
                        QRコードをスマホのカメラで読み取ると、お支払い画面が開きます。<br>
                        <strong style="color:#c0392b; font-size:17px; display:inline-block; margin-top:4px;">ご請求金額: ${amount.toLocaleString()} 円</strong>
                    </p>
                </div>
            </div>
        `;

        // 成功ステータスに更新（緑色トースト）
        statusDiv.innerText = '✅ HHC_Pay: QR生成完了！';
        statusDiv.style.background = '#27ae60';

        // --------------------------------------------------
        // 画像ロード待機 & PDF保管連携
        // --------------------------------------------------
        // 印刷ダイアログが開く前にQR画像が完全に読み込まれるのを同期待機
        const qrImgEl = document.getElementById('stripe-qr-image-element');
        if (qrImgEl && !qrImgEl.complete) {
            await new Promise((resolve) => {
                qrImgEl.onload = resolve;
                qrImgEl.onerror = resolve;
            });
        }

        // PDF自動保管機能（pdf_archive_kun）がONの場合はキャプチャと印刷連動をセットアップ
        const settings = getSettings();
        if (settings["pdf_archive_kun"]) {
            captureCurrentPageDom(); // 印刷ダイアログ起動前に綺麗なDOMを保存
            setupAutoArchiveOnPrint(invoiceNo, customerCode);
        }

    } catch (err) {
        // 例外・エラーログの出力
        console.error('[StripePay Error]', err);
    } finally {
        // 後処理: トースト削除、一時無効化していた window.print を復元して印刷ダイアログを自動起動
        statusDiv.remove();
        window.print = originalPrint;
        window.print();
    }
}