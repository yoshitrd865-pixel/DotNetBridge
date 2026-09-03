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
            // 1. 一時テスト用：メールアドレスを直接固定（ログイン省略）
            var userEmail = "yoshi.trd865@gmail.com";

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

            // URL表記ブレ補正
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

            // --- 候補URLリスト（自動フォールバック階層）の生成 ---
            var candidateUris = new List<string>();
            candidateUris.Add(targetBaseUrl + path + context.Request.QueryString.Value);

            string schemeHostPort = $"{uri.Scheme}://{uri.Host}:{uri.Port}";
            string pathOnly = uri.AbsolutePath.Trim('/');
            var segments = pathOnly.Split('/', StringSplitOptions.RemoveEmptyEntries);

            for (int i = segments.Length - 1; i >= 0; i--)
            {
                string subPath = string.Join('/', segments.Take(i));
                if (!string.IsNullOrEmpty(subPath)) subPath += "/";
                string altUri = $"{schemeHostPort}/{subPath}{path}{context.Request.QueryString.Value}";
                if (!candidateUris.Contains(altUri))
                {
                    candidateUris.Add(altUri);
                }
            }

            string rootUri = $"{schemeHostPort}/{path}{context.Request.QueryString.Value}";
            if (!candidateUris.Contains(rootUri))
            {
                candidateUris.Add(rootUri);
            }

            // POSTリクエストボディの取得
            byte[] bodyBytes = Array.Empty<byte>();
            if (HttpMethods.IsPost(context.Request.Method) ||
                HttpMethods.IsPut(context.Request.Method) ||
                HttpMethods.IsPatch(context.Request.Method))
            {
                using var ms = new MemoryStream();
                await context.Request.Body.CopyToAsync(ms);
                bodyBytes = ms.ToArray();
            }

            using var client = _httpClientFactory.CreateClient("NoRedirectClient");
            HttpResponseMessage upstreamResponse = null;

            // 3. 候補URLを順番に通信試行（404なら親階層へフォールバック）
            foreach (var candidateUri in candidateUris)
            {
                var upstreamRequest = new HttpRequestMessage(new HttpMethod(context.Request.Method), candidateUri);

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

                if (bodyBytes.Length > 0)
                {
                    var streamContent = new ByteArrayContent(bodyBytes);
                    if (context.Request.ContentType != null)
                    {
                        streamContent.Headers.TryAddWithoutValidation("Content-Type", context.Request.ContentType);
                    }
                    upstreamRequest.Content = streamContent;
                }

                try
                {
                    var res = await client.SendAsync(upstreamRequest, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
                    if (res.StatusCode != System.Net.HttpStatusCode.NotFound)
                    {
                        upstreamResponse = res;
                        break;
                    }

                    if (candidateUri == candidateUris.Last())
                    {
                        upstreamResponse = res;
                    }
                    else
                    {
                        res.Dispose();
                    }
                }
                catch (TaskCanceledException)
                {
                    return;
                }
            }

            if (upstreamResponse == null) return;

            // 4. レスポンスヘッダー転送
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

            // 5. ドメイン完全置換レスポンス処理
            var contentType = upstreamResponse.Content.Headers.ContentType?.ToString() ?? string.Empty;
            bool isText = contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase) ||
                         contentType.Contains("javascript", StringComparison.OrdinalIgnoreCase) ||
                         contentType.Contains("text/css", StringComparison.OrdinalIgnoreCase);

            if (isText)
            {
                var rawBytes = await upstreamResponse.Content.ReadAsByteArrayAsync();
                
                Encoding encoding;
                try { encoding = Encoding.GetEncoding(932); }
                catch { encoding = Encoding.UTF8; }

                var textContent = encoding.GetString(rawBytes);

                var proxyOrigin = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}";
                var targetHost = uri.Host;

                textContent = textContent.Replace($"https://{targetHost}", proxyOrigin)
                                         .Replace($"http://{targetHost}", proxyOrigin)
                                         .Replace($"//{targetHost}", proxyOrigin.Replace("https:", "").Replace("http:", ""))
                                         .Replace("https://hhc-eco1.com", proxyOrigin)
                                         .Replace("http://hhc-eco1.com", proxyOrigin)
                                         .Replace("//hhc-eco1.com", proxyOrigin.Replace("https:", "").Replace("http:", ""));

                var modifiedBytes = encoding.GetBytes(textContent);
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