# PROJECT_SUMMARY.md

## 1. プロジェクト概要
上流ASPシステム（`hhc-eco11.com`）のモバイル版画面に対し、ASP.NET Core（.NET 10）によるリバースプロキシ（`DotNetBridge`）を経由させることで、端末側（ブラウザ）へStripe決済機能（決済QRコード生成・消込管理）を自動追加・連携するシステム。

---

## 2. システム構成・アーキテクチャ

* **バックエンド**: ASP.NET Core (.NET 10) / C#
* **DB**: SQLite (`PaymentDbContext`) - 決済ログ・消込データ保持
* **インフラ**: Render (Dockerコンテナデプロイ)
* **決済連携**: Stripe API (Checkout / Webhook)
* **プロキシ**: `ProxyService.cs` (上流システムとの通信中継およびJS自動挿入)
* **フロントエンド拡張**: `wwwroot/js/custom-inject.js` (ブラウザ側で動的UI追加・アシスト機能の提供)

---

## 3. これまでの障害対応と解消経緯

### ① C# 構文エラー & MVC構造の修正
* **発生現象**: Build失敗 (`CS1003`, `CS0103` エラー)
* **原因**: 
  * `StripePaymentController.cs` の `SessionCreateOptions` でのカンマ欠落・重複プロパティ。
  * `View()` / `ViewBag` 呼び出し箇所で、コントローラーが `ControllerBase` を継承していたこと。
* **対処**: `Metadata` オプションの整形、重複プロパティの削除、継承元を `Controller` に変更してビルドを正常化。

### ② Render (Linux) 起動障害（inotify制限）
* **発生現象**: コンテナ起動直後に `System.IO.IOException: The configured user limit (128) on the number of inotify instances has been reached` でプロセス強制終了 (Exit Status 139)。
* **原因**: .NETの `appsettings.json` 自動リロード機能が Linux のファイル監視上限（inotify）を使い果たしていたため。
* **対処**: `Program.cs` 内の `CreateBuilder` 設定で `reloadOnChange: false` を明示指定し、不要なファイル監視を停止。

### ③ 一部画面（点検・清掃・し尿一覧）の読み込み停止（OLE DBエラー）
* **発生現象**: 「設置先一覧」は動くが、日付検索を伴う特定の3画面で「読み込み中」のまま止まり、コンソールに `SyntaxError: Unexpected identifier 'OLE'` や `varchar` が出力される。
* **原因**: 
  * プロキシ側で上流の JSONP / API 通信（`json_*.asp`）までUTF-8テキスト変換・文字コード置換を適用しようとしたため、クエリやデータ構造が破綻。
  * 上流ASP側でSQL/OLE DBエラーが発生し、HTML形式のエラー文が返却されたことでJS構文エラーを誘発していた。
* **対処**: `ProxyService.cs` を画面ごとの個別対応から **Pass-through（透過スルー）方式** へ方針変更。API通信はバイトデータのまま完全素通りさせ、上流データの非破壊転送を実現。

### ④ 顧客BOXなどの写真・画像表示エラー (404 Not Found)
* **発生現象**: 顧客BOXの写真（`jpg`等）がリンク切れ・表示不可になる。
* **原因**: 
  * パス結合時の `mobile60_ToubuF/` の二重重複。
  * 上流の旧ドメイン（`hhc-eco1.com`）の画像URLがそのまま残り、プロキシを通過せず直接参照しようとしていた。
* **対処**: `ProxyService.cs` でパス先頭の重複除去（正規化）ロジックを追加し、HTML応答時のみ `hhc-eco1.com` → `hhc-eco11.com` へのドメイン補正を実施。

---

## 4. 現在の「Pass-through型プロキシ」基本設計方針（遵守事項）

今後コードを変更・拡張する際は、以下の基本設計方針を絶対に崩さないでください。

1. **API・画像データ等の通信 (`json_*.asp`, 画像, JS等)**
   * **完全スルー（Pass-through）**: レスポンスを一切加工せず、生のバイトデータ（バイナリ）のままブラウザへそのまま流す（AndroidのWebView直通と同等の安定性を確保）。
2. **HTML画面応答 (`text/html`)**
   * Shift_JIS(CP932)として解読し、旧ドメイン表記の補正と、`</body>` 直前への `<script src="/js/custom-inject.js"></script>` タグ1行挿入のみを行う。画面ごとの個別処理や複雑な文字コード変換ロジックは追加しないこと。
3. **Cookieの扱い**
   * 上流からの `Set-Cookie` の `Domain` と `Path` 属性を削り（`Path=/;` に統一）、プロキシ配下の全パスでセッション（ASPSESSIONID）が正しくブラウザから送信されるように維持すること。
