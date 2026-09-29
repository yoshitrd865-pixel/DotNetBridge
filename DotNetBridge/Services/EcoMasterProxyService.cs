using System.Text;
using System.Text.RegularExpressions;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Services
{
    public class EcoMasterProxyService
    {
        private static readonly string[] HopByHopHeaders =
        {
            "transfer-encoding", "content-length", "content-encoding", "connection", "keep-alive"
        };

        private readonly IHttpClientFactory _httpClientFactory;

        public EcoMasterProxyService(IHttpClientFactory httpClientFactory)
        {
            _httpClientFactory = httpClientFactory;
        }

        public async Task ProcessProxyAsync(HttpContext context)
        {
            var userEmail = context.User.FindFirst(ClaimTypes.Email)?.Value 
                            ?? context.User.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")?.Value
                            ?? context.User.Identity?.Name;

            if (string.IsNullOrEmpty(userEmail))
            {
                context.Response.Redirect("/Account/Login");
                return;
            }

            var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
            var tenant = await db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

            if (tenant == null || string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                context.Session.Clear();
                context.Response.Redirect("/Account/Login");
                return;
            }

            var targetBaseUrl = tenant.TargetAspUrl;
            var uri = new Uri(targetBaseUrl);
            
            string schemeHostPort = uri.IsDefaultPort 
                ? $"{uri.Scheme}://{uri.Host}" 
                : $"{uri.Scheme}://{uri.Host}:{uri.Port}";

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

            targetBaseUrl = $"{schemeHostPort}{absolutePath}";

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

            byte[] bodyBytes = [];
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

            // ★ 追加：さくらサーバーにgzip/br/zstd圧縮させず生のShift-JIS HTMLを返させる
            upstreamRequest.Headers.AcceptEncoding.Clear();

            var proxyOrigin = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}";

            // ★ リクエストヘッダー転送（さくらが拒絶するヘッダーをカット）
            foreach (var header in context.Request.Headers)
            {
                var key = header.Key;

                if (key.StartsWith(":", StringComparison.Ordinal)) continue;

                // Cloud Run や Chrome から送られる不要・危険ヘッダーを除外
                if (key.StartsWith("Sec-", StringComparison.OrdinalIgnoreCase) ||
                    key.StartsWith("X-", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Host", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Via", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Forwarded", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (key.Equals("Cookie", StringComparison.OrdinalIgnoreCase))
                {
                    var cookieValues = header.Value
                        .SelectMany(v => v.Split(';'))
                        .Select(c => c.Trim())
                        .Where(c => !string.IsNullOrEmpty(c) && !c.StartsWith(".AspNetCore", StringComparison.OrdinalIgnoreCase))
                        .Distinct();

                    string formattedCookie = string.Join("; ", cookieValues);
                    if (!string.IsNullOrEmpty(formattedCookie))
                    {
                        upstreamRequest.Headers.TryAddWithoutValidation("Cookie", formattedCookie);
                    }
                    continue;
                }

                if (key.Equals("Referer", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("Origin", StringComparison.OrdinalIgnoreCase))
                {
                    var original = header.Value.ToString();
                    var rewrittenValue = original.Replace(proxyOrigin, schemeHostPort);
                    upstreamRequest.Headers.TryAddWithoutValidation(key, rewrittenValue);
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
            var sw = System.Diagnostics.Stopwatch.StartNew();
            Console.WriteLine($"[PROXY-REQ] {context.Request.Method} {targetUri}");
            try
            {
                upstreamResponse = await client.SendAsync(upstreamRequest, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
                Console.WriteLine($"[PROXY-RES] {(int)upstreamResponse.StatusCode} {targetUri} headers in {sw.ElapsedMilliseconds}ms");
            }
            catch (Exception ex) when (ex is TaskCanceledException || ex is HttpRequestException)
            {
                if (context.RequestAborted.IsCancellationRequested) return;
                Console.WriteLine($"[PROXY-ERR] {targetUri} after {sw.ElapsedMilliseconds}ms: {ex.GetType().Name}: {ex.Message} / {ex.InnerException?.Message}");
                context.Response.StatusCode = StatusCodes.Status504GatewayTimeout;
                await context.Response.WriteAsync($"Upstream error: {ex.GetType().Name}");
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

                bool isEcoMaster = targetBaseUrl.Contains("mobile60", StringComparison.OrdinalIgnoreCase);

                string baseTag;
                if (isEcoMaster)
                {
                    var proxyBaseUrl = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}/";
                    baseTag = $"<base href=\"{proxyBaseUrl}\">";
                }
                else
                {
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