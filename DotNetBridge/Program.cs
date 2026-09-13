using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Services;
using DotNetBridge.Data;

Environment.SetEnvironmentVariable("DOTNET_USE_POLLING_FILE_WATCHER", "1");
System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args });

builder.Configuration.Sources.Clear();
builder.Configuration.AddJsonFile("appsettings.json", optional: true, reloadOnChange: false);
builder.Configuration.AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true, reloadOnChange: false);
builder.Configuration.AddEnvironmentVariables();

builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(@"./keys"));

builder.Services.AddControllersWithViews();
builder.Services.AddScoped<EcoMasterProxyService>();
builder.Services.AddScoped<EcoProProxyService>();
builder.Services.AddScoped<ProxyDispatcher>();

builder.Services.AddSession(options =>
{
    options.IdleTimeout = TimeSpan.FromHours(8);
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
});

builder.Services.AddHttpClient("NoRedirectClient", client => { })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false
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

builder.WebHost.UseUrls($"http://*:{Environment.GetEnvironmentVariable("PORT") ?? "8080"}");

builder.Services.AddDbContext<PaymentDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("PaymentConnection")));

builder.Services.AddDbContext<FusenDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("FusenConnection")));

builder.Services.AddDbContext<SubscriptionDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("SubscriptionConnection") 
        ?? builder.Configuration.GetConnectionString("PaymentConnection")));

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
    void EnsureColumnExists(DbContext dbContext, string tableName, string columnName, string columnDef)
    {
        try
        {
            var conn = dbContext.Database.GetDbConnection();
            bool wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) conn.Open();

            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"PRAGMA table_info(\"{tableName}\");";
            using var reader = cmd.ExecuteReader();
            bool exists = false;
            while (reader.Read())
            {
                if (string.Equals(reader["name"]?.ToString(), columnName, StringComparison.OrdinalIgnoreCase))
                {
                    exists = true;
                    break;
                }
            }
            reader.Close();

            if (!exists)
            {
                using var alterCmd = conn.CreateCommand();
                alterCmd.CommandText = $"ALTER TABLE \"{tableName}\" ADD COLUMN \"{columnName}\" {columnDef};";
                alterCmd.ExecuteNonQuery();
            }

            if (!wasOpen) conn.Close();
        }
        catch { }
    }

    var db = scope.ServiceProvider.GetRequiredService<PaymentDbContext>();
    db.Database.EnsureCreated();

    EnsureColumnExists(db, "PaymentLogs", "CustomerName", "TEXT NULL");
    EnsureColumnExists(db, "PaymentLogs", "IssuedBy", "TEXT NULL");
    EnsureColumnExists(db, "PaymentLogs", "IssuedAt", "TEXT NOT NULL DEFAULT '0001-01-01 00:00:00'");
    EnsureColumnExists(db, "PaymentLogs", "PdfFileName", "TEXT NULL");
    EnsureColumnExists(db, "PaymentLogs", "ItemDescription", "TEXT NULL");

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

    EnsureColumnExists(subDb, "TenantSubscriptions", "PaidAt", "TEXT NOT NULL DEFAULT '0001-01-01 00:00:00'");

    try
    {
        subDb.Database.ExecuteSqlRaw(@"
            INSERT INTO ""TenantSubscriptions"" (""GoogleEmail"", ""TargetAspUrl"", ""IsActive"", ""CreatedAt"")
            SELECT 'eco@tfkankyo.com', 'https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/', 1, '2026-01-01 00:00:00'
            WHERE NOT EXISTS (SELECT 1 FROM ""TenantSubscriptions"" WHERE ""GoogleEmail"" = 'eco@tfkankyo.com');

            INSERT INTO ""TenantSubscriptions"" (""GoogleEmail"", ""TargetAspUrl"", ""IsActive"", ""CreatedAt"")
            SELECT 'ecopro@tfkankyo.com', 'https://hhc-eco11.com/EcoToubuF3/Main/', 1, '2026-01-01 00:00:00'
            WHERE NOT EXISTS (SELECT 1 FROM ""TenantSubscriptions"" WHERE ""GoogleEmail"" = 'ecopro@tfkankyo.com');
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
// プロキシバイパス・ガード付きミドルウェア (完全補正)
// --------------------------------------------------
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";

    // C#専用ルート・OAuth・決済結果のみプロキシをバイパス
    if (path.StartsWith("/Account", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/admin", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/Subscription", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/api", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/success", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/cancel", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/signin-google", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }

    var dispatcher = context.RequestServices.GetRequiredService<ProxyDispatcher>();
    await dispatcher.DispatchAsync(context);

    if (!context.Response.HasStarted)
    {
        await next();
    }
});

app.Run();