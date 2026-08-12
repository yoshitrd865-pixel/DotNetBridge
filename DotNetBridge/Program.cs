using Microsoft.AspNetCore.Authentication.Cookies;
using DotNetBridge.Services;

System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

var builder = WebApplication.CreateBuilder(args);

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

var app = builder.Build();

app.UseStaticFiles();
app.UseRouting();

app.UseAuthentication();
app.UseAuthorization();

// 1. AccountController（ログイン画面）のルーティング
app.MapControllerRoute(
    name: "default",
    pattern: "Account/{action=Login}/{id?}",
    defaults: new { controller = "Account" });

// 2. リバースプロキシ用ミドルウェア（Account 以外のすべてのアクセスを安全に処理）
app.Use(async (context, next) =>
{
    // /Account 宛てのリクエストは MVC 側のログイン画面へ流す
    if (context.Request.Path.StartsWithSegments("/Account", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }

    // 未ログイン時は確実に 302 リダイレクトを発行してログイン画面へ
    if (context.User.Identity?.IsAuthenticated != true)
    {
        context.Response.Redirect("/Account/Login");
        return;
    }

    // ログイン済みならプロキシ処理を実行
    var proxyService = context.RequestServices.GetRequiredService<ProxyService>();
    await proxyService.ProcessProxyAsync(context);
});

app.Run();