# Gemini引き継ぎ用初期化プロンプト

以下のコードブロックを次のチャット（Gemini）の冒頭にコピー＆ペーストしてそのままご使用いただけます。

```markdown
あなたは ASP.NET Core および DotNetBridge プロジェクトの優秀な開発パートナーです。
これまでの開発経緯と現在の最新ソースコードを共有しますので、この前提を把握した上で今後の開発サポートをお願いします。

### 1. プロジェクト概要
- **システム概要**: ASP.NET Core によるリバースプロキシ ＋ 認証統合（Cookie認証 ＋ Google OAuth 2.0）
- **動作環境**: Render (Linux環境, ポート変数は PORT 環境変数を使用)
- **データベース**: SQLite (`PaymentDbContext`, `payment.db`)

### 2. 直近で実装・解決済みの内容
- **Google OAuth 2.0 統合**: `AddGoogle()`、`AccountController` への `GoogleLogin`/`GoogleResponse` アクション実装
- **プロキシ除外処理**: `/signin-google`, `/Account`, `/api`, `/admin`, `/success`, `/cancel` をミドルウェアから除外
- **Render HTTPS / Proxy 対応**: `app.UseForwardedHeaders(...)` を追加し、`redirect_uri_mismatch` (エラー 400) を解消
- **モバイル UX / レスポンシブ**: `Login.cshtml` の Viewport 設定、レスポンシブデザイン、Google公式風ログインボタン追加
- **セッション永続化**: `AddDataProtection().PersistKeysToFileSystem(...)` による再デプロイ時の鍵リセット防止

### 3. 最新の主要ファイル構成

#### ① `Program.cs`
```csharp
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google; // ★ Google認証用に追加
using Microsoft.AspNetCore.DataProtection; // ★ 先頭に追加
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

// reloadOnChange: false にしてファイル監視(inotify)を停止
builder.Configuration.Sources.Clear();
builder.Configuration.AddJsonFile("appsettings.json", optional: true, reloadOnChange: false);
builder.Configuration.AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true, reloadOnChange: false);
builder.Configuration.AddEnvironmentVariables();

// --- 暗号キーの保存先を永続化（再デプロイしてもログイン状態を維持） ---
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(@"./keys"));

builder.Services.AddControllersWithViews();
builder.Services.AddScoped<ProxyService>();

builder.Services.AddHttpClient("NoRedirectClient", client => { })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AllowAutoRedirect = false
    });

// --- 認証設定 ---
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
    .AddGoogle(options => // ★ Google 認証設定を追加
    {
        options.ClientId = builder.Configuration["GOOGLE_CLIENT_ID"] ?? "";
        options.ClientSecret = builder.Configuration["GOOGLE_CLIENT_SECRET"] ?? "";
    });

// Render の PORT 環境変数を読み込む
builder.WebHost.UseUrls($"http://*:{Environment.GetEnvironmentVariable("PORT") ?? "8080"}");

// SQLite の接続設定
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseSqlite("Data Source=payment.db"));

var app = builder.Build();

// ★ 追加：Renderなどのプロキシ環境下で https を正しく認識させる設定
var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto
};
// Renderからのプロキシヘッダーを無条件で信頼する設定
forwardedHeadersOptions.KnownNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();

app.UseForwardedHeaders(forwardedHeadersOptions);

// 起動時に DB テーブルが存在しなければ自動生成
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    db.Database.EnsureCreated();
}

app.UseStaticFiles(); // wwwroot配下の配信を許可
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

// 1. 各コントローラーの属性ルーティングと標準ルートの有効化
app.MapControllers();
app.MapControllerRoute(
    name: "default",
    pattern: "Account/{action=Login}/{id?}",
    defaults: new { controller = "Account" });

// 2. リバースプロキシ用ミドルウェア
app.Use(async (context, next) =>
{
    var path = context.Request.Path;

    // 先ほど作成した /success と /cancel、および Google 認証コールバック (/signin-google) をプロキシから除外
    if (path.StartsWithSegments("/Account", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/admin", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/success", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/cancel", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/signin-google", StringComparison.OrdinalIgnoreCase)) // ★ Google認証応答パスを除外
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

#### ② `Controllers/AccountController.cs`
```csharp
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google; // ★ Google認証用に追加

namespace DotNetBridge.Controllers
{
    [AllowAnonymous]
    public class AccountController : Controller
    {
        [HttpGet]
        public IActionResult Login()
        {
            if (User.Identity?.IsAuthenticated == true)
            {
                return Redirect("/");
            }
            return View();
        }

        [HttpPost]
        public async Task<IActionResult> Login(string username, string password)
        {
            if (username == "admin" && password == "password123")
            {
                var claims = new List<Claim>
                {
                    new Claim(ClaimTypes.Name, username),
                    new Claim(ClaimTypes.Role, "User")
                };

                var claimsIdentity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);

                await HttpContext.SignInAsync(
                    CookieAuthenticationDefaults.AuthenticationScheme, 
                    new ClaimsPrincipal(claimsIdentity));

                return Redirect("/");
            }

            ViewBag.Error = "ユーザー名またはパスワードが違います。";
            return View();
        }

        // ★ 1. 「Googleでログイン」ボタンが押された時の処理
        [HttpGet]
        public IActionResult GoogleLogin()
        {
            var properties = new AuthenticationProperties
            {
                // 認証成功後に戻ってくるアクション（GoogleResponse）を指定
                RedirectUri = Url.Action("GoogleResponse")
            };

            // ★ 追加: Google側に「アカウント選択または生体認証による再確認」を促す
            properties.Items["prompt"] = "select_account";

            // Googleのログイン画面へリダイレクト（チャレンジ）
            return Challenge(properties, GoogleDefaults.AuthenticationScheme);
        }

        // ★ 2. Google側の認証完了後に戻ってくる場所
        [HttpGet]
        public async Task<IActionResult> GoogleResponse()
        {
            // Cookie認証の結果を取得して成功したか確認
            var result = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            
            if (!result.Succeeded)
            {
                // 認証失敗した場合は再度ログイン画面へ
                return RedirectToAction("Login");
            }

            // 成功したらトップページ（プロキシ画面等）へ転送
            return Redirect("/");
        }

        [HttpGet]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return RedirectToAction("Login");
        }
    }
}
```

#### ③ `Views/Account/Login.cshtml`
```html
@{
    Layout = null;
}
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="utf-8" />
    <!-- ★ スマホで画面が小さくなるのを防ぐ必須のビューポート設定 -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>DotNetBridge - ログイン</title>
    <style>
        * {
            box-sizing: border-box;
        }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            min-height: 100vh; 
            background: #f4f6f9; 
            margin: 0; 
            padding: 1rem;
        }
        .login-card { 
            background: white; 
            padding: 2.5rem 2rem; 
            border-radius: 12px; 
            box-shadow: 0 4px 20px rgba(0,0,0,0.08); 
            width: 100%;
            max-width: 380px; /* スマホでは横幅いっぱいにフィット、PCでは程よい大きさに */
        }
        h2 {
            margin-top: 0;
            margin-bottom: 1.5rem;
            text-align: center;
            color: #333;
        }
        .field { margin-bottom: 1.2rem; }
        label { display: block; margin-bottom: 0.5rem; font-size: 0.95rem; color: #555; }
        input[type="text"], input[type="password"] { 
            width: 100%; 
            padding: 0.75rem; 
            font-size: 1rem; /* スマホでの自動ズーム防止 */
            border: 1px solid #ccc; 
            border-radius: 6px; 
            transition: border-color 0.2s;
        }
        input[type="text"]:focus, input[type="password"]:focus {
            outline: none;
            border-color: #007bff;
        }
        button { 
            width: 100%; 
            padding: 0.8rem; 
            background: #007bff; 
            color: white; 
            border: none; 
            border-radius: 6px; 
            cursor: pointer; 
            font-size: 1rem;
            font-weight: bold; 
            transition: background 0.2s;
        }
        button:hover { background: #0056b3; }
        .error { color: #dc3545; font-size: 0.88rem; margin-bottom: 1rem; text-align: center; }
        
        /* 区切り線スタイル */
        .divider {
            display: flex;
            align-items: center;
            text-align: center;
            margin: 1.5rem 0;
            color: #888;
            font-size: 0.85rem;
        }
        .divider::before, .divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid #eee;
        }
        .divider span {
            padding: 0 10px;
        }

        /* ★ Google ログインボタン */
        .btn-google {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            padding: 0.75rem;
            background-color: #ffffff;
            color: #333333;
            border: 1px solid #dadce0;
            border-radius: 6px;
            font-size: 0.95rem;
            font-weight: 500;
            text-decoration: none;
            transition: background-color 0.2s, box-shadow 0.2s;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .btn-google:hover {
            background-color: #f8f9fa;
            border-color: #d2e3fc;
        }
        .btn-google svg {
            margin-right: 10px;
            width: 18px;
            height: 18px;
        }
    </style>
</head>
<body>
    <div class="login-card">
        <h2>DotNetBridge</h2>
        @if (ViewBag.Error != null)
        {
            <div class="error">@ViewBag.Error</div>
        }
        
        <!-- ID/Pass フォーム -->
        <form method="post" action="/Account/Login">
            <div class="field">
                <label>ユーザー名</label>
                <input type="text" name="username" required autofocus />
            </div>
            <div class="field">
                <label>パスワード</label>
                <input type="password" name="password" required />
            </div>
            <button type="submit">ログイン</button>
        </form>

        <!-- OR 区切り -->
        <div class="divider">
            <span>または</span>
        </div>

        <!-- ★ Google ログインボタン -->
        <a href="/Account/GoogleLogin" class="btn-google">
            <svg viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            Google アカウントでログイン
        </a>
    </div>
</body>
</html>
```

#### ④ ディレクトリ構造
```text
DotNetBridgeApp/
├── Dockerfile
├── PROJECT_SUMMARY.md
└── DotNetBridge/
    ├── DotNetBridge.csproj
    ├── Program.cs
    ├── README.md
    ├── Controllers/
    │   ├── AccountController.cs
    │   ├── PaymentAdminController.cs
    │   └── StripePaymentController.cs
    ├── Data/
    │   └── PaymentDbContext.cs
    ├── Properties/
    │   └── launchSettings.json
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
```

---
以上の前提とソースコードを理解したら、「DotNetBridgeの最新状態を把握しました！次は何を実装・調整しますか？」と短く返答してください。
```
