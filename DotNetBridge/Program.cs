// Program.cs
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using System.Linq;
using DotNetBridge.Services;
using DotNetBridge.Data;

// Linux環境(Render)での inotify ハンドル上限到達によるエラーを防止する環境変数設定
Environment.SetEnvironmentVariable("DOTNET_USE_POLLING_FILE_WATCHER", "1");

// CP932 (Shift-JIS) 相互エンコーディング用のプロバイダー登録
System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args
});

// appsettings.json の構成設定（inotifyファイル監視オフで安全化）
builder.Configuration.Sources.Clear();
builder.Configuration.AddJsonFile("appsettings.json", optional: true, reloadOnChange: false);
builder.Configuration.AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true, reloadOnChange: false);
builder.Configuration.AddEnvironmentVariables();

// --- 暗号キーの保存先を永続化（再デプロイしてもログイン状態を維持） ---
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(@"./keys"));

// コントローラー・ビューおよびプロキシ依存サービスの登録
builder.Services.AddControllersWithViews();
builder.Services.AddScoped<EcoMasterProxyService>();
builder.Services.AddScoped<EcoProProxyService>();
builder.Services.AddScoped<ProxyDispatcher>();

// ★ セッション機能の追加（有効期限8時間）
builder.Services.AddSession(options =>
{
    options.IdleTimeout = TimeSpan.FromHours(8);
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
});

// ★ HttpClientがクッキー(ASPSESSIONID)を自動削除しないよう UseCookies = false を設定
builder.Services.AddHttpClient("NoRedirectClient", client => { })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false
    });

// --- 認証設定（Cookie認証 ＋ Google OAuth） ---
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

        options.Events.OnRedirectToLogin = ctx =>
        {
            if (ctx.Request.Path.StartsWithSegments("/Account"))
            {
                ctx.Response.Redirect(ctx.RedirectUri);
            }
            else
            {
                ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            }
            return Task.CompletedTask;
        };
    })
    .AddGoogle(options =>
    {
        options.ClientId = builder.Configuration["GOOGLE_CLIENT_ID"] ?? "";
        options.ClientSecret = builder.Configuration["GOOGLE_CLIENT_SECRET"] ?? "";
    });

// Render の PORT 環境変数を読み込む（無ければ8080）
builder.WebHost.UseUrls($"http://*:{Environment.GetEnvironmentVariable("PORT") ?? "8080"}");

// SQLite DB（DbContext）の接続設定
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("PaymentConnection")));

builder.Services.AddDbContext<FusenDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("FusenConnection")));

builder.Services.AddDbContext<SubscriptionDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("SubscriptionConnection") 
        ?? builder.Configuration.GetConnectionString("PaymentConnection")));

var app = builder.Build();

// ★ Renderなどのプロキシ環境下で https を正しく認識させる設定
var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto
};
forwardedHeadersOptions.KnownNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();

app.UseForwardedHeaders(forwardedHeadersOptions);

// 起動時に DB テーブルおよびカラムの自動生成・開発アカウント注入を実行
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    db.Database.EnsureCreated();

    // --------------------------------------------------
    // ★【SQLiteスキーマ自動拡張】PaymentLogs テーブルへの新カラム補正
    // --------------------------------------------------
    var alterSqls = new[]
    {
        @"ALTER TABLE ""PaymentLogs"" ADD COLUMN ""CustomerName"" TEXT NULL;",
        @"ALTER TABLE ""PaymentLogs"" ADD COLUMN ""IssuedBy"" TEXT NULL;",
        @"ALTER TABLE ""PaymentLogs"" ADD COLUMN ""IssuedAt"" TEXT NOT NULL DEFAULT '0001-01-01 00:00:00';",
        @"ALTER TABLE ""PaymentLogs"" ADD COLUMN ""PdfFileName"" TEXT NULL;",
        @"ALTER TABLE ""PaymentLogs"" ADD COLUMN ""ItemDescription"" TEXT NULL;"
    };

    foreach (var sql in alterSqls)
    {
        try 
        { 
            db.Database.ExecuteSqlRaw(sql); 
        } 
        catch 
        { 
            // 既にカラムが存在している場合はエラーを無視して継続
        }
    }

    var fusenDb = scope.ServiceProvider.GetRequiredService<FusenDbContext>();
    fusenDb.Database.EnsureCreated();

    var subDb = scope.ServiceProvider.GetRequiredService<SubscriptionDbContext>();
    subDb.Database.EnsureCreated();

    subDb.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS ""TenantSubscriptions"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_TenantSubscriptions"" PRIMARY KEY AUTOINCREMENT,
            ""GoogleEmail"" TEXT NOT NULL,
            ""TargetAspUrl"" TEXT NOT NULL,
            ""StripeCustomerId"" TEXT NULL,
            ""StripeSubscriptionId"" TEXT NULL,
            ""IsActive"" INTEGER NOT NULL,
            ""PaidAt"" TEXT NOT NULL DEFAULT '0001-01-01 00:00:00',
            ""CreatedAt"" TEXT NOT NULL
        );
    ");

    subDb.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS ""SystemSettings"" (
            ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_SystemSettings"" PRIMARY KEY AUTOINCREMENT,
            ""Key"" TEXT NOT NULL,
            ""Value"" TEXT NOT NULL
        );
    ");

    try
    {
        subDb.Database.ExecuteSqlRaw(@"ALTER TABLE ""TenantSubscriptions"" ADD COLUMN ""PaidAt"" TEXT NOT NULL DEFAULT '0001-01-01 00:00:00';");
    }
    catch
    {
        // 既に PaidAt カラムが存在する場合はスキップ
    }

    // 開発用アカウントを SQLite DB へ自動注入 ＆ 既存データの TargetAspUrl 補正
    try
    {
        // 1. 新規注入時はベースルート (/EcoToubuF3/) で作成
        subDb.Database.ExecuteSqlRaw(@"
            INSERT INTO ""TenantSubscriptions"" (""GoogleEmail"", ""TargetAspUrl"", ""IsActive"", ""CreatedAt"")
            SELECT 'eco@tfkankyo.com', 'https://hhc-eco11.com/EcoToubuF3/', 1, '2026-01-01 00:00:00'
            WHERE NOT EXISTS (SELECT 1 FROM ""TenantSubscriptions"" WHERE ""GoogleEmail"" = 'eco@tfkankyo.com');
        ");

        // 2. ★ 既存のDBに mobile60_ToubuF/ が入っている場合も自動でベースルートへ統一補正
        subDb.Database.ExecuteSqlRaw(@"
            UPDATE ""TenantSubscriptions"" 
            SET ""TargetAspUrl"" = 'https://hhc-eco11.com/EcoToubuF3/' 
            WHERE ""GoogleEmail"" = 'eco@tfkankyo.com' AND ""TargetAspUrl"" LIKE '%mobile60_ToubuF%';
        ");
    }
    catch { }
}        

app.UseStaticFiles();
app.UseRouting();

app.UseSession();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapControllerRoute(
    name: "default",
    pattern: "Account/{action=Login}/{id?}",
    defaults: new { controller = "Account" });

// --------------------------------------------------
// ★【リバースプロキシ用ミドルウェア】
// --------------------------------------------------
app.Use(async (context, next) =>
{
    var dispatcher = context.RequestServices.GetRequiredService<ProxyDispatcher>();
    
    // ProxyDispatcher 側でプロキシを実行（true）したか判定
    bool handled = await dispatcher.DispatchAsync(context);
    if (!handled)
    {
        await next();
    }
});

app.Run();