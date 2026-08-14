using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
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
builder.Services.AddScoped<LegacyAuthService>();

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
    .AddGoogle(options =>
    {
        options.ClientId = builder.Configuration["GOOGLE_CLIENT_ID"] ?? "";
        options.ClientSecret = builder.Configuration["GOOGLE_CLIENT_SECRET"] ?? "";
        
        // ★ 追加: メールアドレスと基本プロフィール情報を確実に要求する設定
        options.Scope.Add("email");
        options.Scope.Add("profile");
    });

// Render の PORT 環境変数を読み込む
builder.WebHost.UseUrls($"http://*:{Environment.GetEnvironmentVariable("PORT") ?? "8080"}");

// SQLite の接続設定 (payment.db / account.db)
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseSqlite("Data Source=payment.db"));

builder.Services.AddDbContext<AccountDbContext>(options =>
    options.UseSqlite("Data Source=account.db"));

var app = builder.Build();

// Renderなどのプロキシ環境下で https を正しく認識させる設定
var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto
};
forwardedHeadersOptions.KnownNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();

app.UseForwardedHeaders(forwardedHeadersOptions);

// 起動時に DB テーブルが存在しなければ自動生成 ( payment.db / account.db )
using (var scope = app.Services.CreateScope())
{
    var paymentDb = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    paymentDb.Database.EnsureCreated();

    var accountDb = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
    accountDb.Database.EnsureCreated();
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

    // プロキシ除外パスの判定 (/Account 配下は絶対にプロキシさせない)
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

    // 未ログイン時はログイン画面へ
    if (context.User.Identity?.IsAuthenticated != true)
    {
        context.Response.Redirect("/Account/Login");
        return;
    }

    // ★ 修正: 複数のパターンから確実に Google Email を取得する
    var googleEmail = context.User.FindFirstValue(ClaimTypes.Email)
                   ?? context.User.FindFirstValue("email")
                   ?? context.User.Claims.FirstOrDefault(c => c.Type.EndsWith("emailaddress", StringComparison.OrdinalIgnoreCase))?.Value;

    if (!string.IsNullOrEmpty(googleEmail))
    {
        // ★ 追加ガード: account.db に紐付けデータがあるかチェック
        var accountDb = context.RequestServices.GetRequiredService<AccountDbContext>();
        var credential = await accountDb.UserLegacyCredentials.FindAsync(googleEmail);

        if (credential == null)
        {
            // DBに紐付け情報が存在しない場合は強行で初回連携画面へリダイレクト
            context.Response.Redirect("/Account/LinkAccount");
            return;
        }

        // 代理ログインを行って EcoMaster 用の Session Cookie を取得
        var legacyAuthService = context.RequestServices.GetRequiredService<LegacyAuthService>();
        var legacyCookie = await legacyAuthService.GetLegacySessionCookieAsync(googleEmail);

        if (!string.IsNullOrEmpty(legacyCookie))
        {
            context.Items["LegacyCookie"] = legacyCookie;
        }
    }

    var proxyService = context.RequestServices.GetRequiredService<ProxyService>();
    await proxyService.ProcessProxyAsync(context);
});

app.Run();