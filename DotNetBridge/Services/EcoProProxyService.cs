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

            // URL構造解析 (例: http://hhc-eco13.com/EcoHHCDemo/main/)
            var uri = new Uri(targetBaseUrl);
            string schemeHostPort = $"{uri.Scheme}://{uri.Host}:{uri.Port}";
            
            var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            string appRootName = segments.FirstOrDefault() ?? ""; // 例: EcoHHCDemo
            string appRootUrl = !string.IsNullOrEmpty(appRootName) 
                ? $"{schemeHostPort}/{appRootName}/" 
                : $"{schemeHostPort}/";

            if (!targetBaseUrl.EndsWith("/"))
            {
                targetBaseUrl += "/";
            }

            string reqPath = context.Request.Path.Value?.TrimStart('/') ?? string.Empty;
            if (string.IsNullOrEmpty(reqPath))
            {
                reqPath = "login.html";
            }

            // --- 3. ルーティング & フォールバック候補の生成 ---
            var candidateUris = new List<string>();
            var ext = Path.GetExtension(reqPath)?.ToLowerInvariant() ?? "";
            
            // 静的アセット（CSS, JS, 画像）の判定
            bool isStaticAsset = ext == ".css" || ext == ".js" || ext == ".png" || ext == ".jpg" || 
                                 ext == ".jpeg" || ext == ".gif" || ext == ".svg" || ext == ".ico" || 
                                 ext == ".woff" || ext == ".woff2" || ext == ".ttf";

            string firstDir = reqPath.Contains('/') ? reqPath.Split('/')[0] : "";

            // 本家 AppRoot (/EcoHHCDemo/) 直下に存在するフォルダ群
            var rootFolders = new[] { 
                "report", "printdaily", "mobile60_hyojun", 
                "icon", "css", "img", "images", "js" 
            };

            if (!string.IsNullOrEmpty(appRootName) && reqPath.StartsWith(appRootName, StringComparison.OrdinalIgnoreCase))
            {
                candidateUris.Add($"{schemeHostPort}/{reqPath}{context.Request.QueryString.Value}");
            }
            else if (!string.IsNullOrEmpty(firstDir) && rootFolders.Contains(firstDir.ToLowerInvariant()))
            {
                // AppRoot 直下フォルダ (icon/, Css/, Report/ 等)
                candidateUris.Add(appRootUrl + reqPath + context.Request.QueryString.Value);
                candidateUris.Add(targetBaseUrl + reqPath + context.Request.QueryString.Value);
            }
            else if (isStaticAsset)
            {
                // ルート直下の CSS/JS/画像など
                candidateUris.Add(appRootUrl + reqPath + context.Request.QueryString.Value);
                candidateUris.Add(targetBaseUrl + reqPath + context.Request.QueryString.Value);
            }
            else
            {
                // 通常のASP画面 (Check/..., Master/..., FrameMain.asp 等)
                if (reqPath.StartsWith("main/", StringComparison.OrdinalIgnoreCase))
                {
                    candidateUris.Add(appRootUrl + reqPath + context.Request.QueryString.Value);
                }
                else
                {
                    candidateUris.Add(targetBaseUrl + reqPath + context.Request.QueryString.Value);
                }
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

            // 候補URLを試行（静的アセットの404救出）
            foreach (var candidateUri in candidateUris)
            {
                using var upstreamRequest = new HttpRequestMessage(new HttpMethod(context.Request.Method), candidateUri);

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

                    if (key.Equals("Cookie", StringComparison.OrdinalIgnoreCase))
                    {
                        var cookieValues = header.Value
                            .SelectMany(v => v.Split(';'))
                            .Select(c => c.Trim())
                            .Where(c => !string.IsNullOrEmpty(c) &&
                                        !c.StartsWith(".AspNetCore", StringComparison.OrdinalIgnoreCase) &&
                                        !c.StartsWith("Session", StringComparison.OrdinalIgnoreCase))
                            .Distinct();

                        if (cookieValues.Any())
                        {
                            string formattedCookie = string.Join("; ", cookieValues);
                            upstreamRequest.Headers.TryAddWithoutValidation("Cookie", formattedCookie);
                        }
                        continue;
                    }

                    if (key.Equals("Referer", StringComparison.OrdinalIgnoreCase) ||
                        key.Equals("Origin", StringComparison.OrdinalIgnoreCase))
                    {
                        var proxyOriginHost = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}";
                        var val = header.Value.ToString().Replace(proxyOriginHost, schemeHostPort);
                        upstreamRequest.Headers.TryAddWithoutValidation(key, val);
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

            // --- 4. レスポンスヘッダー転送 ---
            context.Response.StatusCode = (int)upstreamResponse.StatusCode;
            var proxyOrigin = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}";

            foreach (var header in upstreamResponse.Headers)
            {
                var key = header.Key;
                if (HopByHopHeaders.Contains(key.ToLowerInvariant())) continue;

                if (key.Equals("Set-Cookie", StringComparison.OrdinalIgnoreCase))
                {
                    foreach (var cookie in header.Value)
                    {
                        var c = Regex.Replace(cookie, @"Domain=[^;]+;?", string.Empty, RegexOptions.IgnoreCase);
                        c = Regex.Replace(c, @"Path=[^;]+;?", "Path=/;", RegexOptions.IgnoreCase);
                        if (!c.Contains("SameSite", StringComparison.OrdinalIgnoreCase))
                        {
                            c += "; SameSite=Lax";
                        }
                        context.Response.Headers.Append("Set-Cookie", c);
                    }
                    continue;
                }

                if (key.Equals("Location", StringComparison.OrdinalIgnoreCase))
                {
                    var loc = header.Value.FirstOrDefault() ?? "";
                    loc = loc.Replace($"https://{uri.Host}", proxyOrigin)
                             .Replace($"http://{uri.Host}", proxyOrigin)
                             .Replace($"//{uri.Host}", proxyOrigin.Replace("https:", "").Replace("http:", ""))
                             .Replace("https://hhc-eco1.com", proxyOrigin)
                             .Replace("http://hhc-eco1.com", proxyOrigin)
                             .Replace("//hhc-eco1.com", proxyOrigin.Replace("https:", "").Replace("http:", ""));
                    context.Response.Headers[key] = loc;
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

            // --- 5. レスポンス本文処理 ---
            var contentType = upstreamResponse.Content.Headers.ContentType?.ToString() ?? string.Empty;
            bool isText = contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase) ||
                         contentType.Contains("javascript", StringComparison.OrdinalIgnoreCase) ||
                         contentType.Contains("text/css", StringComparison.OrdinalIgnoreCase) ||
                         reqPath.EndsWith(".htm", StringComparison.OrdinalIgnoreCase) ||
                         reqPath.EndsWith(".html", StringComparison.OrdinalIgnoreCase);

            if (isText)
            {
                var rawBytes = await upstreamResponse.Content.ReadAsByteArrayAsync();
                
                Encoding encoding;
                try { encoding = Encoding.GetEncoding(932); }
                catch { encoding = Encoding.UTF8; }

                var textContent = encoding.GetString(rawBytes);

                textContent = textContent.Replace($"https://{uri.Host}", proxyOrigin)
                                         .Replace($"http://{uri.Host}", proxyOrigin)
                                         .Replace($"//{uri.Host}", proxyOrigin.Replace("https:", "").Replace("http:", ""))
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