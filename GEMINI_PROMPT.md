Gemini引き継ぎ用初期化プロンプト以下のコードブロックを次のチャット（Gemini）の冒頭にコピー＆ペーストしてそのままご使用いただけます。あなたは ASP.NET Core および DotNetBridge プロジェクトの優秀な開発パートナーです。
これまでの開発経緯と現在の最新ソースコード、プロキシ・フロントエンドモジュール構成を共有しますので、この前提を把握した上で今後の開発サポートをお願いします。

### 1. プロジェクト概要
- **システム概要**: ASP.NET Core によるマルチテナント・リバースプロキシ ＋ 認証統合（Cookie認証 ＋ Google OAuth 2.0） ＋ クライアントサイド拡張インジェクションシステム
- **動作環境**: Render (Linux環境, ポート変数は PORT 環境変数を使用)
- **データベース**: SQLite（Render Persistent Disk `/var/data` による永続化: `fusen.db`, `payment.db`, `subscription.db`）

### 2. 直近で実装・解決済みの内容
- **マルチテナント・スマートリバースプロキシ基盤の構築完了**:
  - **`ProxyDispatcher.cs` による動的ディスパッチ**: ログインユーザーの Google メールアドレス（`ClaimTypes.Email`）から DB (`SubscriptionDbContext`) を検索し、テナントごとの接続先 (`TargetAspUrl`) に応じて `EcoProProxyService` (ECOPRO) と `EcoMasterProxyService` (EcoMaster/mobile60) へ動的振分け。
  - **スマートパス判定 (404フォールバック全廃)**: 本家IISへの試し打ち（404応答）による `ASPSESSIONID` 破棄事故を完封。`/EcoHHCDemo/` 直下のアセット・帳票フォルダ（`Report/`, `PrintDaily/`, `icon/`, `css/` 等）と `/EcoHHCDemo/main/` 直下の業務画面を事前のパス解析で1発直撃生成。
  - **IIS互換Cookie成形**: プロキシ内部用クッキー（`.AspNetCore`, `Session`）を分離・除外の上、本家IISが受容できるセミコロン＋スペース（`; `）区切りに統一して透過転送。
  - **`window.top` による画面全体脱出 & 無限ループ防止**: Classic ASP 特有の `frameset/iframe` 内で認証切れや契約停止（`IsActive == false`）が発生した際、HTTP 302 リダイレクトではなく JavaScript（`window.top.location.href = '/Account/Suspended'`）を出力して画面外枠ごと一括脱出。Google OAuth の自動再認証による無限リダイレクト（白画面ループ）を防ぐため、専用のアカウント停止画面 `/Account/Suspended` へ直接誘導する仕様を確立。
  - **帳票出力 & CP932 (Shift-JIS) 文字コード保持**: 帳票ポップアップ（`/Report/*.htm`）の Same-Origin 属性を維持し、文字化けやパラメータ破壊を防ぐ相互エンコーディング処理を実装。
- **クラウド付箋くん（`fusen-kun.js`）のアップデート**:
  - **ハイブリッド画面判定の強化**: UserAgentだけでなくDOM要素（`.ui-page`, `.taskItem`, `.pagetitle`）や `listcheck.asp` の存在を検知し、PCブラウザでスマホUIを開いている場合でも正しくモバイル表示ロジックが動作するよう改善。
  - **UIテーマカラーの統一**: ボタンやヘッダーライン、アクセントカラーを従来のオレンジ系（`#F39C12`）からブランドUIに合わせたブルー系（`#0284C7` / `#007AFF`）に統一（デフォルト付箋カラーは黄色維持）。
  - **旧データ移行ユーティリティ**: 旧本番ドメイン `hhc-eco11.com_EcoToubuF3` の旧データをワンクリックで一括移行できる機能（`window.migrateFusenData`）を実装。
- **清掃オートリンク機能（`clean-autolink.js`）の新規構築・完元**:
  - **顧客名の動的キャッチとセッション保持**: `menuCheck.asp` / `menuclean.asp` から顧客名を自動取得し `sessionStorage` (`clean_autolink_customer_name`) に保持。最終完了画面まで確実に引き継ぐ構造を確立。
  - **清掃実績（汚泥量入力時）の自動連動ルート**: 汚泥量（1㎥、1.5㎥、2㎥、3㎥、直接入力）選択時に発火。隠し `iframe` で `listClean.asp` を呼び出し、検索窓クリア＆顧客ID＋全期間検索で該当顧客の `CleanNumber` を自動抽出。裏画面で `clean.asp?CleanNumber=XXX` を開き汚泥量をセットしてフォーム送信＆確認ダイアログ自動クリック。処理後は `listClean.asp` の検索条件を「当月」かつワードクリアへ自動リセット（`resetListCleanToDefault`）してセッションクリーンを維持。
  - **清掃予定（次回月選択時）の自動連動ルート**: 汚泥量未入力で次回清掃月（1〜12月）選択時に発火。未来年自動判定（過去月なら翌年化、同月なら確認ダイアログ）を行い、隠し `iframe` で `cleanPlan.asp` を開き `YYYY/MM/01` 形式で注入して送信完走。
  - **非同期通信の同期制御（`async/await` + `iframe.onload`）**: 隠し `iframe` の `onload` イベント（Promise化）を利用して ASP サーバーからの POST 完了レスポンスをリアルタイム検出し、親画面遷移による強制切断事故を100%防止。
  - **UI/UX・相互排他制御 & 完了通知カード**: 実績と予定の相互打ち消し制御、ダークグラデーション＋ローディングスピナー付きトースト表示（`showStatusToast`）、点検完了画面（`writeCheck.asp`）の `id="divCondition"` 直前へのスタイリッシュな完了通知カード挿入。
- **Render 永続ディスク（Persistent Disk）とデータベース保護**:
  - Mount path `/var/data` (Size: 1GB) を導入し、再デプロイや再起動でデータが消失しない構成を確立。
  - `Program.cs` の SQLite 接続文字列を `/var/data/fusen.db` および `/var/data/payment.db` に変更。
- **付箋データの移行完了**: 旧サーバーの本番データ（`hhc-eco11.com_EcoToubuF3` / 21KB）を取得し、`/var/data/fusen.db` への一括移行・永続保存が完了。
- **Google OAuth 2.0 統合**: `AddGoogle()`、`AccountController` への `GoogleLogin`/`GoogleResponse`/`Suspended` アクション実装
- **プロキシ除外処理**: `/signin-google`, `/Account`, `/api`, `/admin`, `/success`, `/cancel` をミドルウェアから除外
- **Render HTTPS / Proxy 対応**: `app.UseForwardedHeaders(...)` を追加し、`redirect_uri_mismatch` (エラー 400) を解消
- **モバイル UX / レスポンシブ**: `Login.cshtml` の Viewport 設定、レスポンシブデザイン、Google公式風ログインボタン追加
- **セッション永続化**: `AddDataProtection().PersistKeysToFileSystem(...)` による再デプロイ時の鍵リセット防止
- **拡張モジュール群の統合**: `auto-login.js`, `stripe-pay.js`, `continuous-upload.js`, `inspection-warp.js`, `zandaka-copy.js`, `fusen-kun.js`, `clean-autolink.js` のモジュール化と `custom-inject.js` からの動的ロード・ガード制御

### 3. モジュール設計と役割分担
- **`ProxyDispatcher.cs`**: DBを参照し、マルチテナント判定・プロキシクラスへの振分け・契約停止時の安全なキックアウトを担当。
- **`EcoProProxyService.cs`**: ECOPRO（事務所用ASP）のスマートパス判定、Cookie成形、CP932エンコーディング変換、ヘッダー/ボディ透過処理を担当。
- **`EcoMasterProxyService.cs`**: EcoMaster（現場用ASP）のパス正規化、`<base>` タグ挿入、PWA/カスタムJS注入を担当。
- **`settings.js`**: 設定状態の保持（`localStorage`）と設定UI・機能ON/OFFトグルの管理。
- **`router.js`**: URLパス解析とページ判定（`pathname.includes` による堅牢な部分一致）。
- **`custom-inject.js`**: 全体制御ハブ（一括・個別ガードでのモジュール起動、`<body>` 直前インジェクション）。
- **拡張モジュール一覧**:
  - `auto-login.js` (`auto_login`): 自動ログイン機能
  - `stripe-pay.js` (`hhc_pay_kun`): QR決済・Stripe連携機能
  - `continuous-upload.js` (`continuous_upload`): `viewFile.asp` / `viewInfo.asp` での連続写真アップロードUI
  - `inspection-warp.js` (`tenkenbox_worp`): 顧客BOX横の空きマス乗っ取り点検BOXワープボタン ＆ `viewFile.asp` の `window.close` 戻るボタン修復パッチ
  - `zandaka-copy.js` (`zandaka_copy` 等): 伝票・残高情報のクリップボードコピー＆自動整理機能
  - `fusen-kun.js` (`fusen_kun`): クラウド付箋くん（ハイブリッド画面判定、ブルー系統一UI、旧データ移行機能付き）
  - `clean-autolink.js` (`clean_autolink`): 清掃オートリンク機能（点検入力画面から清掃実績/清掃予定を非同期iframe自動連動、検索条件自動リセット、完了通知カード）

### 4. 重要なノウハウ・開発ガードレール（バグ防止原則）
- **無差別な404フォールバック通信の絶対禁止**: 本家IISへ存在しないURLを送信して404エラーを受け取ると、IIS側で `ASPSESSIONID` が即座に無効化される。送信前にパス形式を厳格に判定し、1発で正確な Target URI を生成すること。
- **IIS互換Cookie整形の維持**: 本家ASPへリクエストを転送する際、プロキシ自身の内部Cookie（`.AspNetCore`, `Session` 等）は除去し、有効なクッキーは必ず `; `（セミコロン＋スペース）で連結して転送すること。
- **画面リダイレクト時の `window.top` 徹底**: `frameset/iframe` 内での画面崩れを防ぐため、未認証・契約停止時の脱出は HTTP 302 ではなく `window.top.location.href = '/Account/Suspended'` を使用すること。
- **契約停止時の転送先制限**: Google OAuth の自動再認証による無限リダイレクトループ（白画面）を回避するため、停止時の転送先は `/Account/Login` ではなく必ず専用の案内画面 `/Account/Suspended` とすること。
- **CP932 (Shift-JIS) エンコーディング保持**: テキストレスポンス書き換え時はバイナリ破損や文字化けを防ぐため、常に `Encoding.GetEncoding(932)` を基準とすること。
- **認証情報の動的取得**: コード内にテスト目的のメールアドレスをハードコードせず、常に `context.User.FindFirst(ClaimTypes.Email)?.Value` から動的に取得すること。
- **サーバー側（C#）での代理ログイン実装は絶対厳禁！**: プロキシ基盤は「完全ステートレスな土管」として聖域化し、レガシーASPへのログインやセッション維持はフロントエンド（JS）に100%任せる。
- **DOM監視（MutationObserver）の無限ループ・ピクつき防止**: `observeDOM` 下でテキストやDOMを変更する際、要素や親要素に `dataset.copyInjected = "true"` などの処理済みフラグを刻み、再描画・上書きループを完封すること。
- **非同期通信の同期制御（`async/await` + `iframe.onload`）**: 隠し `iframe` の読み込み完了（`load` イベントの Promise 化）により ASP の POST レスポンス完了を確実・安全に検知し、親画面の予期せぬ遷移切れ（キャンセル）を防ぐこと。

### 5. 最新の主要ファイル構成

#### ① `Program.cs`
```csharp
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Services;
using DotNetBridge.Data;

Environment.SetEnvironmentVariable("DOTNET_USE_POLLING_FILE_WATCHER", "1");
System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args
});

builder.Configuration.Sources.Clear();
builder.Configuration.AddJsonFile("appsettings.json", optional: true, reloadOnChange: false);
builder.Configuration.AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true, reloadOnChange: false);
builder.Configuration.AddEnvironmentVariables();

builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(@"./keys"));

builder.Services.AddControllersWithViews();
builder.Services.AddScoped<EcoProProxyService>();
builder.Services.AddScoped<EcoMasterProxyService>();
builder.Services.AddScoped<ProxyDispatcher>();

builder.Services.AddHttpClient("NoRedirectClient", client => { })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AllowAutoRedirect = false
    });

builder.Services.AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    })
    .AddCookie(options =>
    {
        options.LoginPath = "/Account/Login";
        options.AccessDeniedPath = "/Account/Login";
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.HttpOnly = true;
        options.SlidingExpiration = true;
    })
    .AddGoogle(options =>
    {
        options.ClientId = builder.Configuration["GOOGLE_CLIENT_ID"] ?? "";
        options.ClientSecret = builder.Configuration["GOOGLE_CLIENT_SECRET"] ?? "";
    });

builder.WebHost.UseUrls($"http://*:{Environment.GetEnvironmentVariable("PORT") ?? "8080"}");

builder.Services.AddDbContext<FusenDbContext>(options =>
    options.UseSqlite("Data Source=/var/data/fusen.db"));

builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseSqlite("Data Source=/var/data/payment.db"));

builder.Services.AddDbContext<SubscriptionDbContext>(options =>
    options.UseSqlite("Data Source=/var/data/subscription.db"));

var app = builder.Build();

var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto
};
forwardedHeadersOptions.KnownNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();

app.UseForwardedHeaders(forwardedHeadersOptions);

using (var scope = app.Services.CreateScope())
{
    var fusenDb = scope.ServiceProvider.GetRequiredService<FusenDbContext>();
    fusenDb.Database.EnsureCreated();

    var paymentDb = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    paymentDb.Database.EnsureCreated();

    var subDb = scope.ServiceProvider.GetRequiredService<SubscriptionDbContext>();
    subDb.Database.EnsureCreated();
}

app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapControllerRoute(
    name: "default",
    pattern: "Account/{action=Login}/{id?}",
    defaults: new { controller = "Account" });

app.Use(async (context, next) =>
{
    var path = context.Request.Path;

    if (path.StartsWithSegments("/Account", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/admin", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/success", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/cancel", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/signin-google", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }

    if (context.User.Identity?.IsAuthenticated != true)
    {
        context.Response.Redirect("/Account/Login");
        return;
    }

    var dispatcher = context.RequestServices.GetRequiredService<ProxyDispatcher>();
    await dispatcher.DispatchAsync(context);
});

app.Run();

プロジェクトの実際のフォルダ・ファイルツリー構成は以下の通りです。

```text
DotNetBridge/
├── appsettings.Development.json
├── appsettings.json
├── DotNetBridge.csproj
├── fusen.db
├── payment.db
├── Program.cs
├── README.md
├── Controllers/
│   ├── AccountController.cs
│   ├── AdminController.cs
│   ├── FusenApiController.cs
│   ├── PaymentAdminController.cs
│   └── StripePaymentController.cs
├── Data/
│   ├── FusenDbContext.cs
│   ├── PaymentDbContext.cs
│   └── SubscriptionDbContext.cs
├── keys/
│   └── key-f46048a4-a85d-4794-af90-0a8e1c0f99e3.xml
├── Models/
│   └── FusenStore.cs
├── Properties/
│   └── launchSettings.json
├── Services/
│   ├── EcoMasterProxyService.cs
│   ├── EcoProProxyService.cs
│   ├── ProxyDispatcher.cs
│   └── ProxyService.cs.bak
├── Views/
│   ├── Account/
│   │   └── Login.cshtml
│   ├── Admin/
│   │   ├── Index.cshtml
│   │   └── Login.cshtml
│   ├── PaymentAdmin/
│   │   └── Index.cshtml
│   └── StripePayment/
│       ├── Cancel.cshtml
│       └── Success.cshtml
└── wwwroot/
    ├── icon-192.png
    ├── icon-512.png
    ├── manifest.json
    ├── sw.js
    ├── js/
    │   ├── custom-inject.js
    │   └── modules/
    │       ├── auto-login.js
    │       ├── clean-autolink.js
    │       ├── common.js
    │       ├── continuous-upload.js
    │       ├── feature1.js
    │       ├── fusen-kun.js
    │       ├── inspection-warp.js
    │       ├── router.js
    │       ├── settings.js
    │       ├── stripe-pay.js
    │       └── zandaka-copy.js
```

                以上の前提とソースコード、最新のリバースプロキシ構成および各種モジュール設計を完璧に理解したら、「DotNetBridgeの最新状態（マルチテナント基盤・清掃オートリンク・全拡張モジュール・ガードレール）を完璧に把握しました！次は何を実装・調整しますか？」と短く返答してください。
