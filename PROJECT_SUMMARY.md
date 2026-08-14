# DotNetBridge プロジェクト概要・仕様書 (PROJECT_SUMMARY.md)

本ドキュメントは、**DotNetBridge**（ASP.NET Core Webアプリケーション）の全体アーキテクチャ、ルーティング、Stripe決済連携、リバースプロキシ動作、Tampermonkey（アシストくん）連携、および今後の課題についてまとめたプロジェクトサミリーです。

---

## 1. プロジェクト概要・技術スタック

### 概要
`DotNetBridge` は、外部のレガシーWebシステム（`https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/`）へのアクセスを独自認証で保護しながらリバースプロキシ経由で中継しつつ、特定のページ（請求画面等）に対して自動的に JavaScript（Stripe決済QR生成機能）をインジェクション・統合するシステムです。また、Stripe Checkoutを用いたクレジットカード決済のWebhook処理および、業務効率化アシスタント（Tampermonkey「アシストくん」）向けの消込データ連携APIを提供します。

### 技術スタック
- **フレームワーク**: ASP.NET Core (C# / .NET 8.0)
- **データベース**: SQLite (`PaymentDbContext`, `payment.db`)
- **ORマッパー**: Entity Framework Core 8.0
- **認証**: ASP.NET Core Cookie認証 (`/Account/Login`)
- **決済プラットフォーム**: Stripe API (Stripe.net SDK, Checkout Sessions, Webhooks)
- **インフラ・デプロイ**: Docker対応、Renderなどのクラウド環境対応 (`PORT` 環境変数対応、`DOTNET_USE_POLLING_FILE_WATCHER` 設定済)
- **フロントエンド / 拡張**: バニラJavaScript (ES Modules)、Tampermonkey連携用API

---

## 2. 開発の歴史と絶対ルール（重要）

### 🚨 1. 現在のステータスとロールバックの経緯
- **現在の状態**: 複雑な状態管理を追加した結果システムが破綻したため、安定稼働していた「Google認証の調整」時点（コミット `e607c90`）のコードベースへ完全にロールバックした。現在はプロキシとして正常稼働中。

### 🚫 2. 絶対的な設計方針と禁止事項（厳守）
- **サーバー側（C#）での代理ログイン実装は絶対厳禁！**
  - 過去にC#側（`LegacyAuthService` や `IMemoryCache` 等）で本家ASPのログインを代理実行し、`ASPSESSIONID` や Cookie をサーバーのメモリ上で保持・管理しようとした結果、セッションの混在やプロキシの500エラー爆死を引き起こし、16回ものデプロイ泥沼を経験した。
  - 今後、サーバー側でセッションや状態（State）を管理する設計は絶対に行わない。

- **プロキシ基盤（`ProxyService.cs`）は「完全ステートレスな土管」として聖域化**
  - リクエストを黙って本家へ流し、レスポンスをそのまま返す Pass-through に徹底する。このファイルの複雑化・改変は原則行わない。
  - HTML応答時のみ、CP932デコードを行って `</body>` 直前に `<script src="/js/custom-inject.js"></script>` を1行挿入する処理だけを許可する。

- **レガシーへのログインはフロントエンド（JS）の「オートログインくん」に任せる**
  - 本家クラシックASPへのログイン処理やセッション維持は、C#側ではなく**クライアント側のブラウザ**に100%任せる設計とする。
  - 過去（Androidアプリ時代）の資産であるJS「オートログインくん」をインジェクションで流し込み、ブラウザ側で自動フォーム補完・Submitを行わせる。これにより、本家サーバーとブラウザ間で直接Cookieをやり取りさせ、セッション破綻を防ぐ。

---

## 3. ルーティング・エンドポイント一覧

| パス / パターン | HTTP メソッド | コントローラー / ハンドラー | 説明 |
| :--- | :--- | :--- | :--- |
| `/` | GET | ProxyService (リバースプロキシ) | 認証済みユーザーのルートアクセスを上流システムへプロキシ（未認証時は `/Account/Login` へリダイレクト） |
| `/Account/Login` | GET / POST | `AccountController` | 独自のログイン画面および認証処理 (`admin` / `password123`) |
| `/Account/Logout` | GET | `AccountController` | ログアウト処理およびCookie破棄 |
| `/admin/payments` | GET | `PaymentAdminController` (`Index`) | 入金消込データ一覧の管理画面（DB保存されたStripe決済ログの確認） |
| `/api/StripePayment/create-checkout` | POST | `StripePaymentController` | Stripe Checkout Sessionを生成し、決済用URLを返すAPI |
| `/api/StripePayment/webhook` | POST | `StripePaymentController` | StripeからのWebhookを受信し、決済完了時にDBへ消込ログ (`PaymentLog`) を保存 |
| `/api/StripePayment/logs` | GET | `StripePaymentController` | 保存された消込データ一覧をJSON形式で取得する確認用API |
| `/api/StripePayment/get_unprocessed` | GET | `StripePaymentController` | 未処理（ステータス `completed` / `PAID`）の消込データをTampermonkey（アシストくん）向けに返却 |
| `/api/StripePayment/get_unprocessed` | POST | `StripePaymentController` | 指定されたIDの消込データステータスを `processed` に更新 |
| `/proxy/*` (その他すべてのパス) | ALL | `ProxyService` | `/Account`, `/api`, `/admin` 以外のパスに対するリバースプロキシ中継 |

---

## 4. Stripe連携の実装状況

- **ファイル名**: `DotNetBridge/Controllers/StripePaymentController.cs`
- **処理概要**:
  1. **Checkout Session 生成 (`POST /api/StripePayment/create-checkout`)**:
     - フロントエンドからのリクエスト（金額、顧客名、顧客コード、伝票番号、明細名）を受け取り、Stripe API (`SessionService`) を呼び出して Checkout Session を作成。
     - メタデータ (`customer_code`, `customer_name`, `invoice_no`, `item_description`) を付与。
     - `SuccessUrl = "{domain}/success"`、`CancelUrl = "{domain}/cancel"` を設定。
  2. **Webhook 受信・DB消込 (`POST /api/StripePayment/webhook`)**:
     - `Stripe-Signature` とシークレットによる署名検証 (`EventUtility.ConstructEvent`)。
     - `checkout.session.completed` イベントを検知した場合、`PaymentDbContext` を用いて `StripeSessionId` による二重書き込みチェックを実施。
     - 支払い完了ログ (`PaymentLog`) をデータベースに保存。

---

## 5. データベース構造・EF Coreエンティティの一覧

- **DBコンテキスト**: `DotNetBridge.Data.PaymentDbContext` (SQLite: `payment.db`)
- **エンティティ**: `DotNetBridge.Data.PaymentLog`

### `PaymentLog` テーブル構造
| カラム名 | 型 | 説明 |
| :--- | :--- | :--- |
| `Id` | `int` (PK, Identity) | 主キー |
| `InvoiceNo` | `string` | 伝票番号（例: 売上番号、請求番号） |
| `CustomerCode` | `string` | 顧客コード / お客様番号 |
| `Amount` | `long` | 請求金額（円単位） |
| `StripeSessionId` | `string` | Stripe Checkout Session ID |
| `Status` | `string` | ステータス（初期値 `"PAID"` / `"completed"` → 処理後 `"processed"`） |
| `PaidAt` | `DateTime` | 決済日時（UTC） |

---

## 6. ProxyService（リバースプロキシ）の動作仕様・設定ターゲット

- **ファイル名**: `DotNetBridge/Services/ProxyService.cs`
- **ターゲットベースURL**: `https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/`
- **主な動作仕様**:
  1. **リクエスト中継**:
     - クライアントからのリクエストメソッド、クエリ文字列、ボディ（POST/PUT/PATCH）をそのままアップストリームへ転送。
     - `Host`, `Content-Length`, `Accept-Encoding`, `Content-Type` などのヘッダーを適切に調整。
     - `Referer` / `Origin` ヘッダーに含まれる `/proxy/` などのプレフィックスをターゲットURLに置換。
  2. **レスポンスヘッダー調整**:
     - `transfer-encoding`, `content-length` などのホップバイホップヘッダーを除外。
     - `Set-Cookie` ヘッダーから `Domain=` 属性を削除し、プロキシ経由でもCookieが正しく機能するように調整。
  3. **HTML書き換え・JSインジェクション**:
     - レスポンスが `text/html` の場合、Shift_JIS (CP932) または UTF-8 としてパース。
     - 上流システムのドメイン参照（`hhc-eco1.com`）を `hhc-eco11.com` に置換。
     - レスポンスの `</body>` 直前に `<script type="module" src="/js/custom-inject.js"></script>` タグを自動挿入し、ブラウザ側で拡張スクリプトが動作するように統合。

---

## 7. アシストくん（Tampermonkey）連携APIの仕様

- **対象ファイル**: `DotNetBridge/Controllers/StripePaymentController.cs` (および `wwwroot/js/`)
- **仕様概要**:
  1. **未処理データ取得 (`GET /api/StripePayment/get_unprocessed`)**:
     - データベースからステータスが `completed` または `PAID` であり、かつ顧客コード・伝票番号が有効なレコードを一覧で返却。
     - レスポンス構造:
       ```json
       [
         {
           "id": 1,
           "customer_code": "12345",
           "invoice_no": "67890",
           "amount_total": 5500,
           "status": "completed"
         }
       ]
       ```
  2. **消込完了ステータス更新 (`POST /api/StripePayment/get_unprocessed`)**:
     - 処理済みにマークするため、リクエストボディに `{ "id": 1 }` を送信。
     - 対象ログの `Status` を `"processed"` に更新し、成功時は `{ "success": true }` を返却。

---

## 8. 未実装・今後対応が必要な課題

1. **サクセス・キャンセルURLのハンドリングビュー (`/success` / `/cancel`)**:
   - `StripePaymentController` 内で `SuccessUrl = "{domain}/success"`, `CancelUrl = "{domain}/cancel"` が指定されているが、現時点でこれらのルーティングやビュー (`/success`, `/cancel`) が未実装。決済完了後・キャンセル後のユーザー向け専用画面（Razor Viewまたは静的ページ）の作成が必要。
2. **エラーハンドリング・ログ出力の強化**:
   - ネットワーク障害やStripe API通信エラー発生時のユーザーフィードバックやリトライ機構の改善。
3. **本番環境用セキュリティ設定**:
   - 簡易ハードコードされているログイン情報 (`admin` / `password123`) のハッシュ化やデータベース管理、環境変数化。
   - WebhookシークレットやStripe APIシークレットキーの厳格な環境変数運用チェック。
