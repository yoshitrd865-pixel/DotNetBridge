DotNetBridge - .NET 10 クラシックASP保護リバースプロキシ構成書古いクラシックASPサーバー（hhc-eco11.com）の手前に配置し、Cookie認証による保護およびモダンなセキュリティと中継処理を提供する .NET 10 リバースプロキシの仕様・アーキテクチャドキュメントです。1. システム概要 & 目的フロントエンド / 認証層: .NET 10 Web API / MVC（Cookie認証）バックエンド（本家）: Shift_JIS クラシックASP サーバー (https://hhc-eco11.com/)主要目的:改修が困難な既存のクラシックASPシステムの手前に .NET 10 を配置し、Cookie認証で安全に保護する。未ログインユーザーのアクセスを遮断し、ログイン画面（/Account/Login）へ安全にリダイレクトする。Shift_JIS エンコーディングの保持、セッションCookie（ASPSESSIONID 等）の透過、旧ドメイン置換をリアルタイムで実行する。2. 遭遇したトラブルと解決策（開発履歴）初期開発時に ProxyController（MVCコントローラー） で全パス（/{**path}）をキャッチしようとした際、以下の3つの問題が発生しました。① ルーティングの衝突と無限リダイレクトループ現象: localhost でリダイレクトが繰り返し行われ、URLのクエリ文字列（ReturnUrl）が長大化して ERR_TOO_MANY_REDIRECTS や 414 (URI Too Long) が発生。原因: ProxyController に [Authorize] や全キャッチの [Route("{*path}")] を付与したことで、/Account/Login へのアクセスまでプロキシが横取りし、「未認証のためログイン画面へ転送」の処理が循環した。② 手動コントローラー実行による「白画面（空レスポンス）」現象: ログイン成功後に画面が真っ白（200 OK だがレスポンスボディが空）になる。原因: app.Map 等の内部で ProxyController を手動呼び出ししていたため、MVCパイプライン外で生成された IActionResult（Redirect）がブラウザへのHTTPレスポンスとして正常に書き出されなかった。③ サブフォルダ階層の不一致による 404 エラー現象: ログイン後に login.asp や menu.asp が 404 エラーになる。原因: クラシックASP側の相対パス（login.asp）が、プロキシ側のルート（localhost:5062/login.asp）へ飛ばされたため。本家がサブフォルダ配下（/EcoToubuF3/mobile60_ToubuF/）で動いている構造を TargetBase 側で補完する必要があった。3. アーキテクチャ設計MVCのコントローラー枠組みを外し、「ミドルウェア（app.Use） ＋ 通信サービス（ProxyService）」 に完全分離しました。[クライアント (ブラウザ)]
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│ .NET 10 パイプライン                                       │
│                                                          │
│  ① app.Use (ミドルウェア)  <-- 交通整理・認証ガード        │
│     ├─ /Account 宛て ──> [AccountController] (ログイン画面) │
│     ├─ 未ログイン ───> 302 Redirect (/Account/Login)    │
│     └─ ログイン済み ───> ② ProxyService へ委譲            │
│                                                          │
│  ② ProxyService          <-- HTTP通信・データ変換         │
│     ├─ サブフォルダ補完 & パス整形                        │
│     ├─ HttpClient (NoRedirectClient) 通信                │
│     ├─ Shift_JIS (cp932) デコード & ドメイン置換          │
│     └─ HttpContext.Response へ直接ストリーム書き出し      │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
              [本家クラシックASP サーバー]
この構成を採用するメリットルーティング衝突がゼロ: C# の if 文で明示的にアクセスを振り分けるため、バッティングが絶対に発生しない。レスポンス出力の確実性: HttpContext のレスポンスストリームへ直接出力するため、空レスポンス（白画面）やリダイレクトの消滅が起きない。責務の明確化: 認証・交通整理（ミドルウェア）と HTTP 通信（サービス）が綺麗に分離されている。4. 各ファイルの全ソースコードProgram.csusing Microsoft.AspNetCore.Authentication.Cookies;
using DotNetBridge.Services;

// Shift_JIS（コードページ 932）の登録
System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllersWithViews();
builder.Services.AddScoped<ProxyService>();

// ASP側の302リダイレクトをブラウザに任せるHttpClient
builder.Services.AddHttpClient("NoRedirectClient", client => { })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AllowAutoRedirect = false
    });

// Cookie認証設定
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

// 2. リバースプロキシ用ミドルウェア
app.Use(async (context, next) =>
{
    // /Account 宛ては MVC へ流す
    if (context.Request.Path.StartsWithSegments("/Account", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }

    // 未ログイン時はログイン画面へリダイレクト
    if (context.User.Identity?.IsAuthenticated != true)
    {
        context.Response.Redirect("/Account/Login");
        return;
    }

    // ログイン済みならプロキシ実行
    var proxyService = context.RequestServices.GetRequiredService<ProxyService>();
    await proxyService.ProcessProxyAsync(context);
});

app.Run();
AccountController.csusing System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.Cookies;

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

        [HttpGet]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return RedirectToAction("Login");
        }
    }
}
ProxyService.csusing System.Text;
using System.Text.RegularExpressions;

namespace DotNetBridge.Services
{
    public class ProxyService
    {
        // ★ サブフォルダ階層まで TargetBase に含める
        private const string TargetBase = "https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/";

        private static readonly string[] HopByHopHeaders =
        {
            "transfer-encoding", "content-length", "content-encoding", "connection", "keep-alive"
        };

        private readonly IHttpClientFactory _httpClientFactory;

        public ProxyService(IHttpClientFactory httpClientFactory)
        {
            _httpClientFactory = httpClientFactory;
        }

        public async Task ProcessProxyAsync(HttpContext context)
        {
            var path = context.Request.Path.Value?.TrimStart('/') ?? string.Empty;

            // トップページアクセス時は初期画面を補完
            if (string.IsNullOrEmpty(path))
            {
                path = "login.html";
            }

            var targetUri = TargetBase + path + context.Request.QueryString.Value;

            using var client = _httpClientFactory.CreateClient("NoRedirectClient");
            using var upstreamRequest = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUri);

            // --- 1. ヘッダー転送 ---
            foreach (var header in context.Request.Headers)
            {
                var key = header.Key;
                if (key.Equals("Host", StringComparison.OrdinalIgnoreCase)) continue;
                if (key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
                if (key.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
                if (key.StartsWith(":", StringComparison.Ordinal)) continue;
                if (key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) continue;

                if (key.Equals("Cookie", StringComparison.OrdinalIgnoreCase))
                {
                    upstreamRequest.Headers.TryAddWithoutValidation(key, header.Value.ToArray());
                    continue;
                }

                if (key.Equals("Referer", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Origin", StringComparison.OrdinalIgnoreCase))
                {
                    var original = header.Value.ToString();
                    var marker = "/proxy/";
                    var idx = original.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
                    var rewrittenValue = idx >= 0
                        ? TargetBase + original.Substring(idx + marker.Length)
                        : TargetBase;

                    upstreamRequest.Headers.TryAddWithoutValidation(key, rewrittenValue);
                    continue;
                }

                upstreamRequest.Headers.TryAddWithoutValidation(key, header.Value.ToArray());
            }

            // --- 2. ボディ転送 ---
            if (HttpMethods.IsPost(context.Request.Method) ||
                HttpMethods.IsPut(context.Request.Method) ||
                HttpMethods.IsPatch(context.Request.Method))
            {
                var memoryStream = new MemoryStream();
                await context.Request.Body.CopyToAsync(memoryStream);
                memoryStream.Position = 0;

                var streamContent = new StreamContent(memoryStream);
                if (context.Request.ContentType != null)
                {
                    streamContent.Headers.TryAddWithoutValidation("Content-Type", context.Request.ContentType);
                }
                upstreamRequest.Content = streamContent;
            }

            // --- 3. アップストリーム通信 ---
            HttpResponseMessage upstreamResponse;
            try
            {
                upstreamResponse = await client.SendAsync(upstreamRequest, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
            }
            catch (TaskCanceledException)
            {
                return;
            }

            // --- 4. レスポンスヘッダー転送 ---
            context.Response.StatusCode = (int)upstreamResponse.StatusCode;

            foreach (var header in upstreamResponse.Headers)
            {
                var key = header.Key;
                if (HopByHopHeaders.Contains(key.ToLowerInvariant())) continue;

                if (key.Equals("Set-Cookie", StringComparison.OrdinalIgnoreCase))
                {
                    var modifiedCookies = header.Value.Select(cookie =>
                        Regex.Replace(cookie, @"Domain=[^;]+;", string.Empty, RegexOptions.IgnoreCase)
                    ).ToArray();
                    context.Response.Headers[key] = modifiedCookies;
                    continue;
                }

                context.Response.Headers[key] = header.Value.ToArray();
            }

            foreach (var header in upstreamResponse.Content.Headers)
            {
                var key = header.Key;
                if (HopByHopHeaders.Contains(key.ToLowerInvariant())) continue;
                context.Response.Headers[key] = header.Value.ToArray();
            }

            // --- 5. レスポンスボディ転送 (Shift_JIS デコード) ---
            var contentType = upstreamResponse.Content.Headers.ContentType?.ToString() ?? string.Empty;

            if (contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
            {
                var rawBytes = await upstreamResponse.Content.ReadAsByteArrayAsync();
                
                Encoding encoding;
                try { encoding = Encoding.GetEncoding(932); } // Shift_JIS
                catch { encoding = Encoding.UTF8; }

                var htmlContent = encoding.GetString(rawBytes);

                // 旧ドメイン置換
                htmlContent = htmlContent.Replace("https://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("http://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("//hhc-eco1.com", "//hhc-eco11.com");

                var modifiedBytes = encoding.GetBytes(htmlContent);
                context.Response.ContentLength = modifiedBytes.Length;

                await context.Response.Body.WriteAsync(modifiedBytes, 0, modifiedBytes.Length);
            }
            else
            {
                await upstreamResponse.Content.CopyToAsync(context.Response.Body);
            }
        }
    }
}
5. 次世代AI・開発者への申し送り事項プロキシを MVC コントローラー（ProxyController）に戻さないことMVC の抽象化により、全キャッチとログイン画面のバッティング（リダイレクトループ）が再発します。ルーティングは app.Use の条件分岐で直接制御し続けること属性ルーティング（[Route]）や MapFallback に頼らず、ミドルウェアの if 文判定が最も安全です。TargetBase の末尾スラッシュとサブフォルダ構造に注意すること相対パス（login.asp 等）の解決が崩れるため、サブフォルダ直下（https://.../mobile60_ToubuF/）までをベース URL としてください。