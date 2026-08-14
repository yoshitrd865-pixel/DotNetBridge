using System.Text;
using System.Text.RegularExpressions;

namespace DotNetBridge.Services
{
    public class ProxyService
    {
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

            if (string.IsNullOrEmpty(path))
            {
                path = "menu.asp"; // ログイン成功後の初期画面
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
                targetUri = "https://hhc-eco11.com/EcoToubuF3/" + path + context.Request.QueryString.Value;
            }
            else
            {
                targetUri = TargetBase + path + context.Request.QueryString.Value;
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
                        ? TargetBase + original.Substring(idx + marker.Length)
                        : TargetBase;

                    upstreamRequest.Headers.TryAddWithoutValidation(key, rewrittenValue);
                    continue;
                }

                upstreamRequest.Headers.TryAddWithoutValidation(key, header.Value.ToArray());
            }

            // ★★★ 修正: ブラウザの既存Cookieと代理ログインCookieを合成して両方生かす ★★★
            var clientCookies = context.Request.Headers["Cookie"].ToString();
            if (context.Items.TryGetValue("LegacyCookie", out var cookieObj) && cookieObj is string legacyCookie)
            {
                var mergedCookie = string.IsNullOrEmpty(clientCookies) 
                    ? legacyCookie 
                    : $"{clientCookies}; {legacyCookie}";

                upstreamRequest.Headers.Remove("Cookie");
                upstreamRequest.Headers.TryAddWithoutValidation("Cookie", mergedCookie);
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

            // --- 4. レスポンスヘッダー転送 (★ CookieのDomain/Path書き換えを厳修) ---
            context.Response.StatusCode = (int)upstreamResponse.StatusCode;

            foreach (var header in upstreamResponse.Headers)
            {
                var key = header.Key;
                if (HopByHopHeaders.Contains(key.ToLowerInvariant())) continue;

                if (key.Equals("Set-Cookie", StringComparison.OrdinalIgnoreCase))
                {
                    // 設計方針通り: Domainを消去し Path=/; に統一して全パスでセッションを有効化
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

            // --- 5. レスポンス処理 (設計方針①: 完全Pass-through制御) ---
            var contentType = upstreamResponse.Content.Headers.ContentType?.ToString() ?? string.Empty;

            bool isHtml = contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase);
            
            // ★ json_ から始まるAPI通信はレスポンスヘッダーに関わらず絶対加工禁止（Pass-through）
            bool isJsonApi = path.Contains("json_", StringComparison.OrdinalIgnoreCase) || 
                             path.StartsWith("json", StringComparison.OrdinalIgnoreCase);

            if (isHtml && !isJsonApi)
            {
                // 純粋なHTML画面のみ: Shift_JIS(CP932)解読 ➔ ドメイン補正 ➔ script注入
                var rawBytes = await upstreamResponse.Content.ReadAsByteArrayAsync();
                
                Encoding encoding;
                try { encoding = Encoding.GetEncoding(932); }
                catch { encoding = Encoding.UTF8; }

                var htmlContent = encoding.GetString(rawBytes);

                htmlContent = htmlContent.Replace("https://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("http://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("//hhc-eco1.com", "//hhc-eco11.com");

                var scriptTag = "<script type=\"module\" src=\"/js/custom-inject.js\"></script>";
                if (htmlContent.Contains("</body>", StringComparison.OrdinalIgnoreCase))
                {
                    htmlContent = htmlContent.Replace("</body>", $"{scriptTag}\n</body>", StringComparison.OrdinalIgnoreCase);
                }
                else
                {
                    htmlContent += scriptTag;
                }

                var modifiedBytes = encoding.GetBytes(htmlContent);
                context.Response.ContentLength = modifiedBytes.Length;
                await context.Response.Body.WriteAsync(modifiedBytes, 0, modifiedBytes.Length);
            }
            else
            {
                // API・画像・JS等は一切加工せず生のバイトデータをそのまま流す (Pass-through)
                await upstreamResponse.Content.CopyToAsync(context.Response.Body);
            }
        }
    }
}