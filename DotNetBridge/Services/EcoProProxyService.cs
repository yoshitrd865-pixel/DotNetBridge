using System.Text;
using System.Text.RegularExpressions;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Services
{
    public class EcoProProxyService
    {
        private static readonly string[] HopByHopHeaders =
        {
            "transfer-encoding", "content-length", "content-encoding", "connection", "keep-alive"
        };

        private readonly IHttpClientFactory _httpClientFactory;

        public EcoProProxyService(IHttpClientFactory httpClientFactory)
        {
            _httpClientFactory = httpClientFactory;
        }

        public async Task ProcessProxyAsync(HttpContext context)
        {
            // 1. ログイン中のGoogleメールアドレスを取得
            var userEmail = context.User.FindFirst(ClaimTypes.Email)?.Value 
                            ?? context.User.Identity?.Name;

            if (string.IsNullOrEmpty(userEmail))
            {
                context.Response.Redirect("/Account/Login");
                return;
            }

            // 2. DBを参照し接続先URLを取得
            var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
            var tenant = await db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

            if (tenant == null || !tenant.IsActive || string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                context.Session.Clear();
                context.Response.Redirect("/Account/Login");
                return;
            }

            var targetBaseUrl = tenant.TargetAspUrl;

            // URL表記ブレ補正：末尾をディレクトリ化
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

            var path = context.Request.Path.Value?.TrimStart('/') ?? string.Empty;
            if (string.IsNullOrEmpty(path))
            {
                path = "login.html";
            }

            var targetUri = targetBaseUrl + path + context.Request.QueryString.Value;

            using var client = _httpClientFactory.CreateClient("NoRedirectClient");
            using var upstreamRequest = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUri);

            // --- 1. リクエストヘッダー転送 ---
            foreach (var header in context.Request.Headers)
            {
                var key = header.Key;
                if (key.Equals("Host", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase) ||
                    key.StartsWith(":", StringComparison.Ordinal) ||
                    key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (key.Equals("Referer", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Origin", StringComparison.OrdinalIgnoreCase))
                {
                    upstreamRequest.Headers.TryAddWithoutValidation(key, targetBaseUrl);
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

            // --- 5. ECOPRO専用レスポンス処理 ---
            var contentType = upstreamResponse.Content.Headers.ContentType?.ToString() ?? string.Empty;
            bool isHtml = contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase);

            if (isHtml)
            {
                var rawBytes = await upstreamResponse.Content.ReadAsByteArrayAsync();
                
                Encoding encoding;
                try { encoding = Encoding.GetEncoding(932); }
                catch { encoding = Encoding.UTF8; }

                var htmlContent = encoding.GetString(rawBytes);

                // 旧ドメイン置換
                htmlContent = htmlContent.Replace("https://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("http://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("//hhc-eco1.com", "//hhc-eco11.com");

                // ECOPRO用 <base> タグ差し込み（本家サーバー宛てにしてCSS/画像崩れを防止）
                var proxyBaseUrl = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}/";
                string baseTag = $"<base href=\"{proxyBaseUrl}\">";
                if (htmlContent.Contains("<head>", StringComparison.OrdinalIgnoreCase))
                {
                    htmlContent = Regex.Replace(htmlContent, "(<head[^>]*>)", $"$1\n    {baseTag}", RegexOptions.IgnoreCase);
                }
                else
                {
                    htmlContent = baseTag + htmlContent;
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