using Microsoft.AspNetCore.Authentication.Cookies;
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

builder.Services.AddControllersWithViews();
builder.Services.AddScoped<ProxyService>();

builder.Services.AddHttpClient("NoRedirectClient", client => { })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AllowAutoRedirect = false
    });

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = "/Account/Login";
        options.AccessDeniedPath = "/Account/Login";
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.HttpOnly = true;
    });

// Render の PORT 環境変数を読み込む
builder.WebHost.UseUrls($"http://*:{Environment.GetEnvironmentVariable("PORT") ?? "8080"}");

// SQLite の接続設定
builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseSqlite("Data Source=payment.db"));

var app = builder.Build();

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

    // 先ほど作成した /success と /cancel もプロキシから除外
    if (path.StartsWithSegments("/Account", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/admin", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/success", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/cancel", StringComparison.OrdinalIgnoreCase))
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