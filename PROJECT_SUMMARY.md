# DotNetBridge プロジェクト概要・仕様書 (PROJECT_SUMMARY.md)

本ドキュメントは、**DotNetBridge**（ASP.NET Core Webアプリケーション）の全体アーキテクチャ、ルーティング、Stripe決済連携、リバースプロキシ動作、各種拡張モジュール（クラウド付箋くん等）、データベース永続化仕様、および今後の課題についてまとめたプロジェクトサミリーです。

---

## 1. プロジェクト概要・技術スタック

### 概要
`DotNetBridge` は、外部のレガシーWebシステム（`https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/`）へのアクセスを独自認証で保護しながらリバースプロキシ経由で中継しつつ、特定のページ（請求画面等）に対して自動的に JavaScript（Stripe決済QR生成機能やクラウド付箋くん等）をインジェクション・統合するシステムです。また、Stripe Checkoutを用いたクレジットカード決済のWebhook処理および、業務効率化アシスタント（Tampermonkey「アシストくん」）向けの消込データ連携APIを提供します。

### 技術スタック
- **フレームワーク**: ASP.NET Core (C# / .NET 8.0)
- **データベース**: SQLite (`FusenDbContext`, `PaymentDbContext`) ※Render Persistent Disk により `/var/data` に永続化
- **ORマッパー**: Entity Framework Core 8.0
- **認証**: ASP.NET Core Cookie認証 (`/Account/Login`) ＋ Google OAuth 2.0 (`/signin-google`)
- **決済プラットフォーム**: Stripe API (Stripe.net SDK, Checkout Sessions, Webhooks)
- **インフラ・デプロイ**: Render Persistent Disk対応（Mount path: `/var/data`, Size: 1GB）、Docker対応 (`PORT` 環境変数対応、`DOTNET_USE_POLLING_FILE_WATCHER` 設定済)
- **フロントエンド / 拡張**: バニラJavaScript (ES Modules)、動的インジェクション (`custom-inject.js`)

---

## 2. 開発の歴史と絶対ルール（重要）

### 🚨 1. 現在のステータスと変更経緯
- **現在の状態**: 
  - Render上に Persistent Disk（Mount path: `/var/data`）を導入し、`fusen.db` および `payment.db` を永続化。
  - クラウド付箋くん（`fusen-kun.js`）のハイブリッド画面判定強化、ブルー系UI（`#0284C7` / `#007AFF`）へのテーマカラー統一、旧本番ドメインデータ（`hhc-eco11.com_EcoToubuF3` / 21KB）の一括移行・永続保存が完了。

### 🚫 2. 絶対的な設計方針と禁止事項（厳守）
- **サーバー側（C#）での代理ログイン実装は絶対厳禁！**
   - 本家ASPのログインやセッション維持はフロントエンド（JS）の「オートログインくん」に100%任せる。サーバー側でセッションや状態を管理しない。

- **プロキシ基盤（`ProxyService.cs`）は「完全ステートレスな土管」として聖域化**
   - リクエストを黙って本家へ流し、レスポンスをそのまま返す Pass-through に徹底する。HTML応答時のみ、CP932デコードを行って `</body>` 直前に `<script src="/js/custom-inject.js"></script>` を1行挿入する処理だけを許可する。

- **DOM監視（MutationObserver）の無限ループ・ピクつき防止**
   - DOMを変更する際、要素や親要素に `dataset.copyInjected = "true"` などの処理済みフラグを刻み、再描画ループを完封する。

---

## 3. ルーティング・エンドポイント一覧

| パス / パターン | HTTP メソッド | コントローラー / ハンドラー | 説明 |
| :--- | :--- | :--- | :--- |
| `/` | GET | ProxyService (リバースプロキシ) | 認証済みユーザーのルートアクセスを上流システムへプロキシ（未認証時は `/Account/Login` へリダイレクト） |
| `/Account/Login` | GET / POST | `AccountController` | 独自のログイン画面および認証処理 (`admin` / `password123`) ＋ Googleログイン |
| `/Account/Logout` | GET | `AccountController` | ログアウト処理およびCookie破棄 |
| `/admin/payments` | GET | `PaymentAdminController` (`Index`) | 入金消込データ一覧の管理画面（DB保存されたStripe決済ログの確認） |
| `/api/fusen/*` | GET / POST | `FusenApiController` | クラウド付箋くん用の付箋データ保存・取得API (`/api/fusen/get`, `/api/fusen/save`) |
| `/api/StripePayment/create-checkout` | POST | `StripePaymentController` | Stripe Checkout Sessionを生成し、決済用URLを返すAPI |
| `/api/StripePayment/webhook` | POST | `StripePaymentController` | StripeからのWebhookを受信し、決済完了時にDBへ消込ログ (`PaymentLog`) を保存 |
| `/api/StripePayment/logs` | GET | `StripePaymentController` | 保存された消込データ一覧をJSON形式で取得する確認用API |
| `/api/StripePayment/get_unprocessed` | GET / POST | `StripePaymentController` | 未処理の消込データをTampermonkey（アシストくん）向けに返却・ステータス更新 |
| `/proxy/*` (その他すべてのパス) | ALL | `ProxyService` | `/Account`, `/api`, `/admin` 以外のパスに対するリバースプロキシ中継 |

---

## 4. データベース構成・永続化仕様

- **データベースエンジン**: SQLite
- **ストレージパス**: Render Persistent Disk (`/var/data/`)
  - **付箋データベース**: `FusenDbContext` → `Data Source=/var/data/fusen.db`
  - **決済データベース**: `PaymentDbContext` → `Data Source=/var/data/payment.db`
- **データ移行実績**:
  - 旧サーバー（`tfkankyo.com`）の本番環境データ（キー: `hhc-eco11.com_EcoToubuF3` / 21KB）を取得し、`/var/data/fusen.db` への一括移行・永続保存が完了済み。

---

## 5. フロントエンド拡張モジュール一覧 (`wwwroot/js/modules/`)

1. **`settings.js`**: 設定状態の保持（`localStorage`）と設定UI・機能ON/OFFトグルの管理。
2. **`router.js`**: URLパス解析とページ判定（`pathname.includes` による堅牢な部分一致）。
3. **`custom-inject.js`**: 全体制御ハブ（インジェクションと各モジュールの遅延読み込み・ガード制御）。
4. **`auto-login.js`**: クラシックASP向け自動ログイン機能。
5. **`stripe-pay.js`**: QR決済・Stripe連携機能。
6. **`continuous-upload.js`**: `viewFile.asp` / `viewInfo.asp` での連続写真アップロードUI。
7. **`inspection-warp.js`**: 顧客BOX横の空きマス乗っ取り点検BOXワープボタン ＆ `viewFile.asp` の `window.close` 戻るボタン修復。
8. **`zandaka-copy.js`**: 伝票・残高情報のクリップボードコピー＆自動整理機能。
9. **`fusen-kun.js`**: クラウド付箋くん
   - **ハイブリッド画面判定**: UserAgentだけでなくDOM要素（`.ui-page`, `.taskItem`, `.pagetitle`）や `listcheck.asp` の存在を検知し、PCブラウザでスマホUIを開いている場合でも正しくモバイル表示ロジックが動作するよう改善。
   - **UIテーマカラーの統一**: ボタンやヘッダーライン、アクセントカラーを従来のオレンジ系（`#F39C12`）からブランドUIに合わせたブルー系（`#0284C7` / `#007AFF`）に統一（付箋自体のデフォルトカラーは黄色を維持）。
   - **旧データ移行ユーティリティ**: `window.migrateFusenData` により、旧ドメインキーのLocalStorageデータをワンクリックでサーバーDBへ一括移行可能。

---

## 6. 未実装・今後対応が必要な課題

1. **サクセス・キャンセルURLのハンドリングビュー (`/success` / `/cancel`)**:
   - 決済完了後・キャンセル後のユーザー向け専用画面（Razor View）の本格的なリッチ化。
2. **エラーハンドリング・ログ出力の強化**:
   - ネットワーク障害やStripe API通信エラー発生時のユーザーフィードバックやリトライ機構の改善。
3. **本番環境用セキュリティ設定**:
   - 簡易ハードコードされているログイン情報 (`admin` / `password123`) のハッシュ化やデータベース管理、環境変数化。
