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

// --- 暗号キーの保存先を永続化 ---
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
        
        options.Scope.Add("email");
        options.Scope.Add("profile");
    });

builder.WebHost.UseUrls($"http://*:{Environment.GetEnvironmentVariable("PORT") ?? "8080"}");

builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseSqlite("Data Source=payment.db"));

builder.Services.AddDbContext<AccountDbContext>(options =>
    options.UseSqlite("Data Source=account.db"));

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
    var paymentDb = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    paymentDb.Database.EnsureCreated();

    var accountDb = scope.ServiceProvider.GetRequiredService<AccountDbContext>();
    accountDb.Database.EnsureCreated();
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

// 2. リバースプロキシ用ミドルウェア
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

    var googleEmail = context.User.FindFirstValue(ClaimTypes.Email)
                   ?? context.User.FindFirstValue("email")
                   ?? context.User.Claims.FirstOrDefault(c => c.Type.EndsWith("emailaddress", StringComparison.OrdinalIgnoreCase))?.Value;

    if (!string.IsNullOrEmpty(googleEmail))
    {
        var accountDb = context.RequestServices.GetRequiredService<AccountDbContext>();
        var credential = await accountDb.UserLegacyCredentials.FindAsync(googleEmail);

        if (credential == null)
        {
            context.Response.Redirect("/Account/LinkAccount");
            return;
        }

        var legacyAuthService = context.RequestServices.GetRequiredService<LegacyAuthService>();
        var legacyCookie = await legacyAuthService.GetLegacySessionCookieAsync(googleEmail);

        if (!string.IsNullOrEmpty(legacyCookie))
        {
            context.Items["LegacyCookie"] = legacyCookie;

            // ★★★ 決定的な修正ポイント ★★★
            // 代理ログインで得た Cookie (PersonCode=1等) を、ブラウザの JS (document.cookie) でも読めるようにレスポンス発行する！
            var cookieParts = legacyCookie.Split(';');
            foreach (var part in cookieParts)
            {
                var kv = part.Trim().Split('=', 2);
                if (kv.Length == 2)
                {
                    var cName = kv[0].Trim();
                    var cVal = kv[1].Trim();
                    if (!string.IsNullOrEmpty(cName))
                    {
                        context.Response.Cookies.Append(cName, cVal, new CookieOptions
                        {
                            Path = "/",
                            HttpOnly = false, // JSが document.cookie で読み取れるように false に設定！
                            SameSite = SameSiteMode.Lax
                        });
                    }
                }
            }
        }
    }

    var proxyService = context.RequestServices.GetRequiredService<ProxyService>();
    await proxyService.ProcessProxyAsync(context);
});

app.Run();