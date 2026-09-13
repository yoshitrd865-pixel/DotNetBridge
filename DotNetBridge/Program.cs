using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
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

// 起動時に DB テーブルおよびカラムの自動生成・初期アカウント作成を実行
using (var scope = app.Services.CreateScope())
{
    // 事前にSQLiteカラム存在確認を行ってから ALTER TABLE する安全関数
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

    // PaymentLogs カラム補正（事前存在チェック付き）
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

    // ★ 完全新規起動時（テーブルが空の場合）のみ初期レコードを作成。一度でも存在すれば変更しない
    try
    {
        subDb.Database.ExecuteSqlRaw(@"
            INSERT INTO ""TenantSubscriptions"" (""GoogleEmail"", ""TargetAspUrl"", ""IsActive"", ""CreatedAt"")
            SELECT 'eco@tfkankyo.com', 'https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/', 1, '2026-01-01 00:00:00'
            WHERE NOT EXISTS (SELECT 1 FROM ""TenantSubscriptions"" WHERE ""GoogleEmail"" = 'eco@tfkankyo.com');
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
    await dispatcher.DispatchAsync(context);

    // プロキシ側でレスポンスが開始されていない場合（/admin や /api など）は C# のコントローラーへ回す
    if (!context.Response.HasStarted)
    {
        await next();
    }
});
// ★ Webサーバーの起動・待機処理（これが必要です）
app.Run();