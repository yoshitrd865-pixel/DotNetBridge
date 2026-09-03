using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure; // ★ 追加 (GetService 用)
using Microsoft.EntityFrameworkCore.Storage;        // ★ 追加 (IRelationalDatabaseCreator 用)
using Microsoft.Extensions.DependencyInjection;     // ★ 追加 (CreateScope 用)
using System.Linq;                                 // ★ 追加 (.Any() 用)
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
//プロキシサービスから、エコプロ／エコマスターように分ける
// builder.Services.AddScoped<ProxyService>();
builder.Services.AddScoped<EcoMasterProxyService>();
builder.Services.AddScoped<EcoProProxyService>();
builder.Services.AddScoped<ProxyDispatcher>();

// ★ セッション機能の追加（Googleログイン時の会社専用URL保持に必須）
builder.Services.AddSession(options =>
{
    options.IdleTimeout = TimeSpan.FromHours(8);
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
});

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
    .AddGoogle(options => // ★ Google 認証設定
    {
        options.ClientId = builder.Configuration["GOOGLE_CLIENT_ID"] ?? "";
        options.ClientSecret = builder.Configuration["GOOGLE_CLIENT_SECRET"] ?? "";
    });

// Render の PORT 環境変数を読み込む
builder.WebHost.UseUrls($"http://*:{Environment.GetEnvironmentVariable("PORT") ?? "8080"}");

// SQLite の接続設定 appsetting.jsonに本番のLinux環境のパスが書いてあります。
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("PaymentConnection")));

// (独立した fusen.db を作成) appsetting.jsonに本番のLinux環境のパスが書いてあります。
builder.Services.AddDbContext<FusenDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("FusenConnection")));

// ★ サブスク＆Googleアカウント管理用DB (SubscriptionDbContext) を追加
builder.Services.AddDbContext<SubscriptionDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("SubscriptionConnection") 
        ?? builder.Configuration.GetConnectionString("PaymentConnection")));

var app = builder.Build();

// ★ Renderなどのプロキシ環境下で https を正しく認識させる設定
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
    // 既存の決済用DB初期化
    var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    db.Database.EnsureCreated();

    // 付箋用DB初期化
    var fusenDb = scope.ServiceProvider.GetRequiredService<FusenDbContext>();
    fusenDb.Database.EnsureCreated();

    // ★ サブスク・Googleアカウント管理用DBの初期化
        var subDb = scope.ServiceProvider.GetRequiredService<SubscriptionDbContext>();

        // ★ 既存DBファイルがあっても TenantSubscriptions テーブルを確実に生成
        subDb.Database.ExecuteSqlRaw(@"
            CREATE TABLE IF NOT EXISTS ""TenantSubscriptions"" (
                ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_TenantSubscriptions"" PRIMARY KEY AUTOINCREMENT,
                ""GoogleEmail"" TEXT NOT NULL,
                ""TargetAspUrl"" TEXT NOT NULL,
                ""StripeCustomerId"" TEXT NULL,
                ""StripeSubscriptionId"" TEXT NULL,
                ""IsActive"" INTEGER NOT NULL,
                ""CreatedAt"" TEXT NOT NULL
            );
        ");
}        

app.UseStaticFiles(); // wwwroot配下の配信を許可
app.UseRouting();

app.UseSession(); // ★ セッションミドルウェアを追加（UseRoutingとUseAuthenticationの間に配置）

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

    // /success、/cancel、および Google 認証コールバック (/signin-google) をプロキシから除外
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
    /*プロキシ作成中だけ一時的にGoogleログインオフ
    if (context.User.Identity?.IsAuthenticated != true)
    {
        context.Response.Redirect("/Account/Login");
        return;
    }
    */

    var dispatcher = context.RequestServices.GetRequiredService<ProxyDispatcher>();
    await dispatcher.DispatchAsync(context);
});

app.Run();