using System.Text;
using System.Text.RegularExpressions;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Services
{
    public class ProxyService
    {
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
            // ★ 1. ログイン中のGoogleメールアドレスを取得
            var userEmail = context.User.FindFirst(ClaimTypes.Email)?.Value 
                            ?? context.User.Identity?.Name;

            if (string.IsNullOrEmpty(userEmail))
            {
                context.Response.Redirect("/Account/Login");
                return;
            }

            // ★ 2. 毎リクエストごとにDBを参照し、最新の契約状態と接続先URLを取得
            var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
            var tenant = await db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

            if (tenant == null || !tenant.IsActive)
            {
                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                context.Session.Clear();
                context.Response.Redirect("/Account/Login");
                return;
            }

            var targetBaseUrl = tenant.TargetAspUrl;

            if (string.IsNullOrEmpty(targetBaseUrl))
            {
                context.Response.Redirect("/Account/Login");
                return;
            }

            // ★ URL表記ブレ補正：末尾にファイル名（.html, .asp 等）があれば自動除去してディレクトリパス化
            var uri = new Uri(targetBaseUrl);
            string absolutePath = uri.AbsolutePath;

            if (Path.HasExtension(absolutePath))
            {
                int lastSlash = absolutePath.LastIndexOf('/');
                if (lastSlash >= 0)
                {
                    absolutePath = absolutePath.Substring(0, lastSlash + 1);
                }
            }

            if (!absolutePath.EndsWith("/"))
            {
                absolutePath += "/";
            }

            targetBaseUrl = $"{uri.Scheme}://{uri.Host}:{uri.Port}{absolutePath}";

            // ★ 3. 接続先URLの変更検知
            var lastTargetUrl = context.Session.GetString("LastTargetAspUrl");
            if (!string.IsNullOrEmpty(lastTargetUrl) && lastTargetUrl != targetBaseUrl)
            {
                context.Session.SetString("LastTargetAspUrl", targetBaseUrl);
                context.Response.Redirect("/");
                return;
            }
            context.Session.SetString("LastTargetAspUrl", targetBaseUrl);

            var baseUri = new Uri(targetBaseUrl);
            var parentUri = new Uri(baseUri, "../").AbsoluteUri;

            var path = context.Request.Path.Value?.TrimStart('/') ?? string.Empty;

            if (string.IsNullOrEmpty(path))
            {
                path = "login.html";
            }

            // --- パス正規化ロジック ---
            while (true)
            {
                var prevPath = path;
                if (path.StartsWith("EcoToubuF3/", StringComparison.OrdinalIgnoreCase))
                    path = path.Substring("EcoToubuF3/".Length);

                if (path.StartsWith("mobile60_ToubuF/", StringComparison.OrdinalIgnoreCase))
                    path = path.Substring("mobile60_ToubuF/".Length);

                if (path == prevPath) break;
            }

            path = Regex.Replace(path, @"(?i)(mobile60_ToubuF/|EcoToubuF3/)+", "");

            string targetUri;

            if (path.StartsWith("Mobile60/", StringComparison.OrdinalIgnoreCase))
            {
                targetUri = parentUri + path + context.Request.QueryString.Value;
            }
            else
            {
                targetUri = targetBaseUrl + path + context.Request.QueryString.Value;
            }

            using var client = _httpClientFactory.CreateClient("NoRedirectClient");
            using var upstreamRequest = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUri);

            // --- 1. リクエストヘッダー転送 ---
            foreach (var header in context.Request.Headers)
            {
                var key = header.Key;
                if (key.Equals("Host", StringComparison.OrdinalIgnoreCase)) continue;
                if (key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
                if (key.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
                if (key.StartsWith(":", StringComparison.Ordinal)) continue;
                if (key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) continue;

                if (key.Equals("Referer", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Origin", StringComparison.OrdinalIgnoreCase))
                {
                    var original = header.Value.ToString();
                    var marker = "/proxy/";
                    var idx = original.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
                    var rewrittenValue = idx >= 0
                        ? targetBaseUrl + original.Substring(idx + marker.Length)
                        : targetBaseUrl;

                    upstreamRequest.Headers.TryAddWithoutValidation(key, rewrittenValue);
                    continue;
                }

                upstreamRequest.Headers.TryAddWithoutValidation(key, header.Value.ToArray());
            }

            // --- 2. リクエストボディ転送 ---
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

            // --- 3. 通信実行 ---
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
                    {
                        var c = Regex.Replace(cookie, @"Domain=[^;]+;?", string.Empty, RegexOptions.IgnoreCase);
                        return Regex.Replace(c, @"Path=[^;]+;?", "Path=/;", RegexOptions.IgnoreCase);
                    }).ToArray();
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

            // --- 5. レスポンス処理 ---
            var contentType = upstreamResponse.Content.Headers.ContentType?.ToString() ?? string.Empty;

            bool isHtml = contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase);
            bool isApiCall = path.Contains("json_", StringComparison.OrdinalIgnoreCase);

            if (isHtml && !isApiCall)
            {
                var rawBytes = await upstreamResponse.Content.ReadAsByteArrayAsync();
                
                Encoding encoding;
                try { encoding = Encoding.GetEncoding(932); }
                catch { encoding = Encoding.UTF8; }

                var htmlContent = encoding.GetString(rawBytes);

                htmlContent = htmlContent.Replace("https://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("http://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("//hhc-eco1.com", "//hhc-eco11.com");

                // ★ システム判定: mobile60 が含まれる場合のみ EcoMaster（現場）と判定
                bool isEcoMaster = targetBaseUrl.Contains("mobile60", StringComparison.OrdinalIgnoreCase);

                // ★ <base> タグの動的分岐
                string baseTag;
                if (isEcoMaster)
                {
                    // EcoMaster（現場）: プロキシドメイン宛て
                    var proxyBaseUrl = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}/";
                    baseTag = $"<base href=\"{proxyBaseUrl}\">";
                }
                else
                {
                    // ECOPRO（事務所）: 本家ターゲットURL宛て（/css/ や /Inc/ 等のリソース404を解消）
                    baseTag = $"<base href=\"{targetBaseUrl}\">";
                }

                if (htmlContent.Contains("<head>", StringComparison.OrdinalIgnoreCase))
                {
                    htmlContent = Regex.Replace(htmlContent, "(<head[^>]*>)", $"$1\n    {baseTag}", RegexOptions.IgnoreCase);
                }
                else
                {
                    htmlContent = baseTag + htmlContent;
                }

                // ★ EcoMaster 専用の PWA & JS 注入処理
                if (isEcoMaster)
                {
                    if (htmlContent.Contains("</head>", StringComparison.OrdinalIgnoreCase))
                    {
                        var pwaTags = "<link rel=\"manifest\" href=\"/manifest.json\">\n" +
                                      "<meta name=\"theme-color\" content=\"#000000\">\n";
                        htmlContent = Regex.Replace(htmlContent, "</head>", pwaTags + "</head>", RegexOptions.IgnoreCase);
                    }
                    
                    var scriptTag = "<script type=\"module\" src=\"/js/custom-inject.js\"></script>";
                    if (htmlContent.Contains("</body>", StringComparison.OrdinalIgnoreCase))
                    {
                        htmlContent = htmlContent.Replace("</body>", $"{scriptTag}\n</body>", StringComparison.OrdinalIgnoreCase);
                    }
                    else
                    {
                        htmlContent += scriptTag;
                    }
                }

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