==================================================
DotNetBridge プロジェクト仕様・全体概要書
==================================================

1. プロジェクト概要
--------------------------------------------------
・システム名称
  DotNetBridge

・主要機能
  マルチテナント・リバースプロキシ ＋ 独自認証（Cookie / Google OAuth） ＋ 動的JSインジェクション基盤

・中継対象（レガシー）
  Classic ASP / IIS環境（ECOPRO3 事務所用 / EcoMaster 現場モバイル用）

・主な目的
  レガシーASPのセッションを保護・維持しつつ、モダン機能（QR決済、付箋機能、清掃自動連携など）を画面へ動的に注入する

・本番インフラ
  Render（Linux環境 / ポートは PORT 環境変数で動的バインド）


2. 技術スタック
--------------------------------------------------
・フレームワーク
  ASP.NET Core (.NET 8.0 / C#)

・データベース
  SQLite (Render Persistent Disk /var/data に永続化)
  - fusen.db : クラウド付箋データ
  - payment.db : 決済・消込ログ
  - subscription.db : テナント契約・接続先管理

・ORマッパー
  Entity Framework Core 8.0

・認証方式
  ASP.NET Core Cookie認証 (/Account/Login) ＋ Google OAuth 2.0 (/signin-google)

・決済連携
  Stripe API (Checkout Sessions / Webhooks) / あおぞら銀行決済

・フロントエンド
  Vanilla JavaScript (ES Modules)

・文字コード
  CP932 (Shift-JIS) 相互エンコーディング対応


3. ディレクトリ構成と役割
--------------------------------------------------
DotNetBridge/
├── Controllers/
│   ├── AccountController.cs         # ログイン・ログアウト・契約停止画面
│   ├── AdminController.cs           # テナント契約管理ポータル
│   ├── AozoraPaymentController.cs   # あおぞら銀行決済処理
│   ├── FusenApiController.cs        # 付箋データ送受信API
│   ├── PaymentAdminController.cs    # 決済消込データ一覧画面
│   ├── StripePaymentController.cs   # Stripe決済セッション生成・Webhook
│   └── SubscriptionController.cs    # サブスクリプション管理
├── Data/
│   ├── FusenDbContext.cs            # 付箋用 DbContext
│   ├── PaymentDbContext.cs            # 決済ログ用 DbContext
│   └── SubscriptionDbContext.cs     # 契約管理用 DbContext
├── Models/
│   └── FusenStore.cs                # データモデル定義
├── Services/
│   ├── ProxyDispatcher.cs           # ユーザーメールからDB参照・プロキシ先振分け
│   ├── EcoProProxyService.cs        # 事務所用ASP (ECOPRO) リバースプロキシ
│   └── EcoMasterProxyService.cs     # 現場用ASP (EcoMaster/mobile60) リバースプロキシ
├── Views/                           # 各種画面（Razor View）
└── wwwroot/                         # 静的ファイル・フロントエンドモジュール
    ├── custom-inject.js             # 画面判定および拡張モジュールの動的ロードハブ
    └── js/modules/
        ├── auto-login.js            # 自動ログイン
        ├── clean-autolink.js        # 清掃実績・予定の非同期連動
        ├── common.js                # 共通処理
        ├── continuous-upload.js     # 連続写真アップロード
        ├── fusen-kun.js             # クラウド付箋くん (v52.3)
        ├── inspection-warp.js       # 点検ワープ・戻るボタン補修
        ├── pdf-archive.js           # PDF自動保管・キャプチャ
        ├── router.js                # URLパス解析
        ├── settings.js              # 設定UI・トグル
        ├── stripe-pay.js            # HHC_Pay (Stripe決済・QRコード生成)
        ├── aozora-pay.js            # あおぞら決済
        └── zandaka-copy.js          # 残高コピー


4. 絶対ルール（開発ガードレール）
--------------------------------------------------
1. 404フォールバック通信の絶対禁止
   本家IISへ存在しないURLを送ると ASPSESSIONID が即死するため、事前に厳格なパス判定を行う。

2. IIS互換Cookie整形の維持
   プロキシ内部Cookie（.AspNetCore等）を除去し、`; `（セミコロン＋スペース）で連結して転送する。

3. 画面脱出時の window.top 徹底
   frameset/iframe 内の崩れを防ぐため、リダイレクト時は window.top.location.href を使用する。

4. 停止時の転送先制限
   Google OAuthの無限リダイレクトを防ぐため、停止時は専用画面 /Account/Suspended へ飛ばす。

5. CP932 (Shift-JIS) エンコーディング保持
   レスポンス書き換え時は常に Encoding.GetEncoding(932) を基準とする。

6. サーバー側（C#）での代理ログイン実装禁止
   プロキシはステートレスな土管に徹し、ログイン処理は100%フロント（JS）に任せる。

7. DOM監視（MutationObserver）の無限ループ防止
   DOM変更時は要素に dataset.copyInjected = "true" などの処理済みフラグを付与する。

8. 非同期通信の同期制御
   タイマー待機ではなく隠し iframe の load イベント（Promise）で完了検知する。


5. 残タスク・今後の課題
--------------------------------------------------
・/success および /cancel ページのUIリッチ化
・Stripe API / ネットワークエラー時のユーザーログ出力強化
・管理者ログイン情報（admin / password123）のハッシュ化・DB管理移行

# PROJECT OVERVIEW (追加・更新セクション)

**開発環境における認証バイパス構成**

* **目的**: シークレットウィンドウ等の Google 未ログイン状態でも、開発環境（Render）から対象 ASP（`mobile60_ToubuF`）へ直通接続し、試走・開発を行える状態にする。

---

**トラブルシューティング & 修正履歴**

* **無限リダイレクトループの解消**:
  * `ProxyDispatcher` の未認証判定と `AccountController`（`Suspended`）の相互転送によるピンポン現象を、`AccountController.cs` の `Redirect("/")` を廃止・静的レスポンス化することで切断。
* **プロキシ内部エンジン（`EcoMasterProxyService`）の権限突破**:
  * セッション値の不保持および `context.User`（クレーム）の不在により、プロキシ内部でアカウント停止判定となっていた問題を解決。
  * `Program.cs` の起動処理にて SQLite DB（`TenantSubscriptions`）へ開発用アカウント（`eco@tfkankyo.com`）を自動挿入。
  * `ProxyDispatcher.cs` にて、未ログインアクセス時に `ClaimsIdentity`（`ClaimTypes.Email` = `eco@tfkankyo.com`）を動的に擬装生成し、内部サービスの権限チェックを通過させる構造を確立。
* **クラウド付箋くん（`fusen-kun.js` v52.3）の飛び火遮断と全画面同期化**:
  * **ホワイトリスト制御による飛び火遮断**: 帳票ポップアップ（`/Report/`）やサブウィンドウ、写真確認画面等での誤爆を防ぐため、動作対象を主要6画面（`menuCheck.asp`, `listCheck.asp`, `listClean.asp`, `menuClean.asp`, `listStandard.asp`, `menuStandard.asp`）に完全限定。
  * **誤爆防止・1行1個制限の強化**: リスト表示時、数字のみの要素（「4」「7」等のインデックス枠）への直接挿入をスキップし、親要素に `dataset.fusenInjected = "true"` フラグを刻むことで多重挿入を遮断。
  * **顧客共通ID（浄化槽番号）の優先抽出**: 清掃メニュー等で伝票固有の `CleanNumber` ではなく、DOM内の「浄化槽番号」や `SetUpCode` を最優先取得するロジックに統一。
  * **ドメインキーの統一（全画面共通化）**: `cleanDomain`（DB参照キー）の算出処理から `.asp` 画面名を除外処理し、同一テナント内の全画面で同一の付箋データ領域（`fusen.db`）を参照・大判カード同期表示する構造を確立。
  * **キー視認性の向上**: ボタンテキストに判定中のID（例: `[1175]`）を直接表示し、画面間でのキー一致を一目で確認可能に改修。
* **HHC_Pay 純正領収書干渉・チラつき防止（`stripe-pay.js`）**:
  * **潜伏領収書の強制無効化**: PDFキャプチャ（`captureCurrentPageDom()`）や自動印刷（`window.print()`）実行時に、本家ASPの隠れ領収書枠（「領 収 書」「￥ 0.-」）が `@media print` やスタイル再計算によって表面に浮き出・重複表示される不具合を改修。
  * **@media all, print スタイル注入とDOM即時消去**: 通常描画時および `@media print` 実行時の両方に対応する遮断スタイル（`display: none !important;`）を動的注入し、DOM直接検索による非表示ガードとの併用で一瞬の露出を完全ブロック。

---

**現在の進捗状況と次の対応項目**

* **達成済み**:
  * シークレットウィンドウからのアクセスで、ASP 業務画面（`menuStandard.asp`）およびカスタム拡張ウィジェットの正常表示を確認。
  * クラウド付箋くんの「飛び火完封」および「一覧〜業務/清掃メニュー間の大判付箋カード1:1リアルタイム同期」の完元を確認。
  * HHC_Pay（`stripe-pay.js`）生成時の純正領収書露出・チラつき現象の完全防護を確認。
* **次の対応項目**:
  * 決済完了・キャンセル画面（`/success`, `/cancel`）のUIリッチ化。
  * 管理者ログイン情報（`admin` / `password123`）のハッシュ化およびDB管理移行。