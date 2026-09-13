using System.Text;
using System.Text.RegularExpressions;
using System.Security.Claims;
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
            var userEmail = context.User.FindFirst(ClaimTypes.Email)?.Value
                            ?? context.User.Identity?.Name;

            if (string.IsNullOrEmpty(userEmail))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>window.top.location.href = '/Account/Login';</script></body></html>");
                return;
            }

            var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
            var tenant = await db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

            if (tenant == null || !tenant.IsActive || string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>window.top.location.href = '/Account/Login';</script></body></html>");
                return;
            }

            var baseUri = new Uri(tenant.TargetAspUrl);
            string schemeHostPort = $"{baseUri.Scheme}://{baseUri.Host}:{baseUri.Port}";
            
            // AppRoot (例: /EcoToubuF3/) と MainPath (例: /EcoToubuF3/Main/) を分離解析
            string absolutePath = baseUri.AbsolutePath.TrimEnd('/');
            string appRootPath;
            string mainPath;

            if (absolutePath.EndsWith("/Main", StringComparison.OrdinalIgnoreCase))
            {
                appRootPath = absolutePath.Substring(0, absolutePath.Length - 4).TrimEnd('/') + "/";
                mainPath = absolutePath + "/";
            }
            else
            {
                appRootPath = absolutePath + "/";
                mainPath = absolutePath + "/";
            }

            string reqPath = context.Request.Path.Value?.TrimStart('/') ?? string.Empty;

            if (string.IsNullOrEmpty(reqPath))
            {
                reqPath = "FrameMain.asp";
            }

            // 静的アセット・共通フォルダ・ルート直下ファイルの判定
            string[] rootAssetFolders = new[] { "css/", "icon/", "icons/", "img/", "images/", "js/", "report/", "printdaily/", "mobile60_hyojun/" };
            bool isRootAsset = rootAssetFolders.Any(f => reqPath.StartsWith(f, StringComparison.OrdinalIgnoreCase)) ||
                               reqPath.Equals("login.html", StringComparison.OrdinalIgnoreCase) ||
                               reqPath.Equals("login.asp", StringComparison.OrdinalIgnoreCase);

            string targetUri;
            if (isRootAsset)
            {
                // アセット類は AppRoot 直下へ送る
                targetUri = $"{schemeHostPort}{appRootPath}{reqPath}{context.Request.QueryString.Value}";
            }
            else
            {
                // 業務画面パスから重複する Main/ を除去して MainPath へ送る
                if (reqPath.StartsWith("Main/", StringComparison.OrdinalIgnoreCase))
                {
                    reqPath = reqPath.Substring(5);
                }

                string appDirName = appRootPath.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
                if (!string.IsNullOrEmpty(appDirName) && reqPath.StartsWith(appDirName + "/", StringComparison.OrdinalIgnoreCase))
                {
                    targetUri = $"{schemeHostPort}/{reqPath}{context.Request.QueryString.Value}";
                }
                else
                {
                    targetUri = $"{schemeHostPort}{mainPath}{reqPath}{context.Request.QueryString.Value}";
                }
            }

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
            using var upstreamRequest = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUri);

            var proxyOrigin = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}";

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
                        .Where(c => !string.IsNullOrEmpty(c))
                        .Distinct();

                    string formattedCookie = string.Join("; ", cookieValues);
                    upstreamRequest.Headers.TryAddWithoutValidation("Cookie", formattedCookie);
                    continue;
                }

                if (key.Equals("Referer", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Origin", StringComparison.OrdinalIgnoreCase))
                {
                    var val = header.Value.ToString().Replace(proxyOrigin, schemeHostPort);
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

            HttpResponseMessage upstreamResponse;
            try
            {
                upstreamResponse = await client.SendAsync(upstreamRequest, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
            }
            catch (TaskCanceledException)
            {
                return;
            }

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
                        c = Regex.Replace(c, @"Path=[^;]+;?", "Path=/;", RegexOptions.IgnoreCase);
                        if (!c.Contains("SameSite", StringComparison.OrdinalIgnoreCase))
                        {
                            c += "; SameSite=Lax";
                        }
                        return c;
                    }).ToArray();
                    context.Response.Headers[key] = modifiedCookies;
                    continue;
                }

                if (key.Equals("Location", StringComparison.OrdinalIgnoreCase))
                {
                    var loc = header.Value.FirstOrDefault() ?? "";
                    loc = loc.Replace($"https://{baseUri.Host}", proxyOrigin)
                             .Replace($"http://{baseUri.Host}", proxyOrigin)
                             .Replace($"//{baseUri.Host}", proxyOrigin.Replace("https:", "").Replace("http:", ""));
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

            var contentType = upstreamResponse.Content.Headers.ContentType?.ToString() ?? string.Empty;
            bool isText = contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase) ||
                         contentType.Contains("javascript", StringComparison.OrdinalIgnoreCase) ||
                         contentType.Contains("text/css", StringComparison.OrdinalIgnoreCase) ||
                         reqPath.EndsWith(".htm", StringComparison.OrdinalIgnoreCase) ||
                         reqPath.EndsWith(".html", StringComparison.OrdinalIgnoreCase) ||
                         reqPath.EndsWith(".asp", StringComparison.OrdinalIgnoreCase);

            if (isText)
            {
                var rawBytes = await upstreamResponse.Content.ReadAsByteArrayAsync();
                Encoding encoding;
                try { encoding = Encoding.GetEncoding(932); }
                catch { encoding = Encoding.UTF8; }

                var textContent = encoding.GetString(rawBytes);

                textContent = textContent.Replace($"https://{baseUri.Host}", proxyOrigin)
                                         .Replace($"http://{baseUri.Host}", proxyOrigin)
                                         .Replace($"//{baseUri.Host}", proxyOrigin.Replace("https:", "").Replace("http:", ""));

                if (contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
                {
                    var scriptTag = "<script type=\"module\" src=\"/js/ecopro-inject.js\"></script>";
                    if (textContent.Contains("</body>", StringComparison.OrdinalIgnoreCase))
                    {
                        textContent = Regex.Replace(textContent, "</body>", $"{scriptTag}\n</body>", RegexOptions.IgnoreCase);
                    }
                    else
                    {
                        textContent += scriptTag;
                    }
                }

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