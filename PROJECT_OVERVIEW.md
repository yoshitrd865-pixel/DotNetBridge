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

**開発環境・マルチテナント認証構成**

* **アカウント分離設計（現場／事務所の独立化）**:
  * **ID 1 (現場・EcoMaster)**: `eco@tfkankyo.com` ➔ `https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/`
  * **ID 4 (事務所・EcoPro)**: `ecopro@tfkankyo.com` ➔ `https://hhc-eco11.com/EcoToubuF3/Main/`
  * メールアドレスごとに接続先 `TargetAspUrl` を完全分離し、現場端末の動作に一切影響を与えずに事務所用のプロキシ調整・検証を行える環境を構築。

---

**トラブルシューティング & 修正履歴**

* **起動時DBマイグレーションの例外根絶（`Program.cs`）**:
  * `PaymentLogs` および `TenantSubscriptions` テーブルへの `ALTER TABLE` 実行時、SQLiteの既存カラム二重追加による起動時例外・`fail:` ログが発生していた問題を解消。
  * `PRAGMA table_info` を使用した事前存在チェック関数（`EnsureColumnExists`）を実装し、エラーログを出さない安全なテーブル初期化フローを確立。
* **Render再起動時のアカウント消去・`/Account/Suspended` ループ防止**:
  * Renderのコンテナ再起動（ディスクリセット）時にデータベースが初期化され、未登録扱いとなったログインが `/Account/Suspended` へ無限リダイレクトする問題を改修。
  * `Program.cs` の初期データ作成ロジックに `eco@tfkankyo.com` および `ecopro@tfkankyo.com` の自動インサート処理を追加し、起動と同時に常時復元される構造へ変更。
* **プロキシバイパス判定の正常化と静的アセット（CSS/JS）通信の復元**:
  * ミドルウェアのバイパス条件に `/css` や `/js` を含めたことで本家IIS上のCSSファイルが404エラー（Renderローカル探し）となりスタイルが崩れていた問題を修正。
  * プロキシバイパス対象を C# コントローラー専用ルート（`/Account`, `/admin`, `/Subscription`, `/api`）のみに限定し、本家IIS上の全CSS/画像/JSがプロキシ経由で正しくレンダリングされるよう復旧。
* **Basic認証ダイアログ（ポップアップ）遮断とフレーム内認証（`EcoProProxyService.cs`）**:
  * 本家IISから `401 Unauthorized` が返却された際、ブラウザが標準認証ダイアログ（ユーザー名/パスワード入力ポップアップ）を出す問題を解決。
  * `EcoProProxyService` 内で `401` ステータスを検知した場合、ステータスを `200 OK` に書き換えた上でログイン画面への `window.top.location.href` 脱出HTMLを返却する遮断フィルターを配備。

---

**現在の進捗状況と次の対応項目**

* **達成済み**:
  * **EcoMaster (現場用)**: `menu.asp` および `listCheck.asp` におけるCSSレイアウトの復元、カスタマイズパネル（残高コピーくん等）の完全動作を確認。明日の現場稼働準備完了。
  * **Render環境**: 自動ビルドおよびデプロイの完全正常化（`Live` 緑色表示維持、起動ログエラー根絶）。
  * **アカウント分離**: 現場用（`eco@`）と事務所用（`ecopro@`）のDB登録・プロキシ振り分け基盤の構築完了。
* **次の対応項目（事務所用 EcoPro の改修）**:
  * `ecopro@tfkankyo.com` を用いた事務所用マルチフレーム（`FrameMain.asp` / `FrameCheckPlan.asp`）でのセッション（`ASPSESSIONID`）透過補正。
  * 左側フレーム内の各機能アイコン画像パスのドメイン・相対パス自動変換補正。
  * Google OAuthログイン完了後の二重ログイン画面（IIS標準ログインフォーム）の自動スキップ化。