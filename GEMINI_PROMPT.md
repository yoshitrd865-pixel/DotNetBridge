# Gemini引き継ぎ用初期化プロンプト

以下のコードブロックを次のチャット（Gemini）の冒頭にコピー＆ペーストしてそのままご使用いただけます。

```markdown
あなたは ASP.NET Core および DotNetBridge プロジェクトの優秀な開発パートナーです。
これまでの開発経緯と現在の最新ソースコード、フロントエンドモジュール構成を共有しますので、この前提を把握した上で今後の開発サポートをお願いします。

### 1. プロジェクト概要
- **システム概要**: ASP.NET Core によるリバースプロキシ ＋ 認証統合（Cookie認証 ＋ Google OAuth 2.0） ＋ クライアントサイド拡張インジェクションシステム
- **動作環境**: Render (Linux環境, ポート変数は PORT 環境変数を使用)
- **データベース**: SQLite（Render Persistent Disk `/var/data` による永続化: `fusen.db`, `payment.db`）

### 2. 直近で実装・解決済みの内容
- **クラウド付箋くん（`fusen-kun.js`）のアップデート**:
  - **ハイブリッド画面判定の強化**: UserAgentだけでなくDOM要素（`.ui-page`, `.taskItem`, `.pagetitle`）や `listcheck.asp` の存在を検知し、PCブラウザでスマホUIを開いている場合でも正しくモバイル表示ロジックが動作するよう改善。
  - **UIテーマカラーの統一**: ボタンやヘッダーライン、アクセントカラーを従来のオレンジ系（`#F39C12`）からブランドUIに合わせたブルー系（`#0284C7` / `#007AFF`）に統一（デフォルト付箋カラーは黄色維持）。
  - **旧データ移行ユーティリティ**: 旧本番ドメイン `hhc-eco11.com_EcoToubuF3` の旧データをワンクリックで一括移行できる機能（`window.migrateFusenData`）を実装。
- **Render 永続ディスク（Persistent Disk）とデータベース保護**:
  - Mount path `/var/data` (Size: 1GB) を導入し、再デプロイや再起動でデータが消失しない構成を確立。
  - `Program.cs` の SQLite 接続文字列を `/var/data/fusen.db` および `/var/data/payment.db` に変更。
- **付箋データの移行完了**: 旧サーバーの本番データ（`hhc-eco11.com_EcoToubuF3` / 21KB）を取得し、`/var/data/fusen.db` への一括移行・永続保存が完了。
- **Google OAuth 2.0 統合**: `AddGoogle()`、`AccountController` への `GoogleLogin`/`GoogleResponse` アクション実装
- **プロキシ除外処理**: `/signin-google`, `/Account`, `/api`, `/admin`, `/success`, `/cancel` をミドルウェアから除外
- **Render HTTPS / Proxy 対応**: `app.UseForwardedHeaders(...)` を追加し、`redirect_uri_mismatch` (エラー 400) を解消
- **モバイル UX / レスポンシブ**: `Login.cshtml` の Viewport 設定、レスポンシブデザイン、Google公式風ログインボタン追加
- **セッション永続化**: `AddDataProtection().PersistKeysToFileSystem(...)` による再デプロイ時の鍵リセット防止
- **拡張モジュール群の統合**: `auto-login.js`, `stripe-pay.js`, `continuous-upload.js`, `inspection-warp.js`, `zandaka-copy.js`, `fusen-kun.js` のモジュール化と `custom-inject.js` からの動的ロード・ガード制御

### 3. モジュール設計と役割分担
- **`settings.js`**: 設定状態の保持（`localStorage`）と設定UI・機能ON/OFFトグルの管理
- **`router.js`**: URLパス解析とページ判定（`pathname.includes` による堅牢な部分一致）
- **`custom-inject.js`**: 全体制御ハブ（一括・個別ガードでのモジュール起動、`<body>` 直前インジェクション）
- **拡張モジュール一覧**:
  - `auto-login.js` (`auto_login`): 自動ログイン機能
  - `stripe-pay.js` (`hhc_pay_kun`): QR決済・Stripe連携機能
  - `continuous-upload.js` (`continuous_upload`): `viewFile.asp` / `viewInfo.asp` での連続写真アップロードUI
  - `inspection-warp.js` (`tenkenbox_worp`): 顧客BOX横の空きマス乗っ取り点検BOXワープボタン ＆ `viewFile.asp` の `window.close` 戻るボタン修復パッチ
  - `zandaka-copy.js` (`zandaka_copy` 等): 伝票・残高情報のクリップボードコピー＆自動整理機能
  - `fusen-kun.js` (`fusen_kun`): クラウド付箋くん（ハイブリッド画面判定、ブルー系統一UI、旧データ移行機能付き）

### 4. 重要なノウハウ・開発ガードレール（バグ防止原則）
- **サーバー側（C#）での代理ログイン実装は絶対厳禁！**: プロキシ基盤（`ProxyService.cs`）は「完全ステートレスな土管」として聖域化し、レガシーASPへのログインやセッション維持はフロントエンド（JS）に100%任せる。
- **DOM監視（MutationObserver）の無限ループ・ピクつき防止**: `observeDOM` 下でテキストやDOMを変更する際、要素や親要素に `dataset.copyInjected = "true"` や `dataset.added = "true"` などの処理済みフラグを刻み、再描画・上書きループを完封すること。
- **OS/ブラウザ差分（iOS WebKit vs Android Blink）への配慮**: iOS特有の過敏なDOM変化検知に耐えられるよう、`innerHTML` 全置き換えを避け `innerText` 書き換えにとどめること。

### 5. 最新の主要ファイル構成

#### ① `Program.cs`
```csharp
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Services;
using DotNetBridge.Data;

// Linux環境(Render)での inotify ハンドル上限到達によるエラーを防止
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
builder.Services.AddScoped<ProxyService>();

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

// Render Persistent Disk (/var/data) 永続化設定
builder.Services.AddDbContext<FusenDbContext>(options =>
    options.UseSqlite("Data Source=/var/data/fusen.db"));

builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseSqlite("Data Source=/var/data/payment.db"));

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

    var proxyService = context.RequestServices.GetRequiredService<ProxyService>();
    await proxyService.ProcessProxyAsync(context);
});

app.Run();
```

#### ② フロントエンド制御アーキテクチャ (`wwwroot/js/`)
- **`custom-inject.js`**: `ProxyService` により HTML 末尾へ動的注入されるハブスクリプト。`settings.js` から各モジュールの有効/無効状態を読み込み、`router.js` のパス判定結果に応じて各拡張モジュールを動的にインポート・初期化。
- **`router.js`**: URLパス (`location.pathname`) に基づくページ種別判定を担当。
- **`settings.js`**: ユーザー設定の `localStorage` 永続化とフローティング設定UIの構築・管理。

#### ③ ディレクトリ構造
```text
DotNetBridgeApp/
├── Dockerfile
├── PROJECT_SUMMARY.md
├── GEMINI_PROMPT.md
└── DotNetBridge/
    ├── DotNetBridge.csproj
    ├── Program.cs
    ├── README.md
    ├── Controllers/
    │   ├── AccountController.cs
    │   ├── FusenApiController.cs
    │   ├── PaymentAdminController.cs
    │   └── StripePaymentController.cs
    ├── Data/
    │   ├── FusenDbContext.cs
    │   └── PaymentDbContext.cs
    ├── Models/
    │   └── FusenStore.cs
    ├── Services/
    │   └── ProxyService.cs
    ├── Views/
    │   ├── Account/
    │   │   └── Login.cshtml
    │   ├── PaymentAdmin/
    │   └── StripePayment/
    │       ├── Success.cshtml
    │       └── Cancel.cshtml
    └── wwwroot/
        └── js/
            ├── custom-inject.js
            └── modules/
                ├── settings.js
                ├── router.js
                ├── auto-login.js
                ├── stripe-pay.js
                ├── continuous-upload.js
                ├── inspection-warp.js
                ├── zandaka-copy.js
                └── fusen-kun.js
```

---
以上の前提とソースコードを理解したら、「DotNetBridgeの最新状態（全モジュール・アーキテクチャ・ガードレール）を完璧に把握しました！次は何を実装・調整しますか？」と短く返答してください。
```
