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
                path = "login.html";
            }

            var targetUri = TargetBase + path + context.Request.QueryString.Value;

            using var client = _httpClientFactory.CreateClient("NoRedirectClient");
            using var upstreamRequest = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUri);

            // --- 1. リクエストヘッダー転送 (無加工) ---
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

            // --- 2. リクエストボディ転送 (生バイナリ無加工) ---
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
                    // クッキーのDomainとPath制限を解除してすべてのリクエストで送信可能にする
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

            // --- 5. レスポンス処理 (画面ごとの判定を廃止した極小Pass-through) ---
            var contentType = upstreamResponse.Content.Headers.ContentType?.ToString() ?? string.Empty;

            // json_ や .asp のAPI類は一切触らずそのままバイナリストリーム転送
            bool isHtml = contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase);
            bool isApiCall = path.Contains("json_", StringComparison.OrdinalIgnoreCase);

            if (isHtml && !isApiCall)
            {
                var rawBytes = await upstreamResponse.Content.ReadAsByteArrayAsync();
                
                Encoding encoding;
                try { encoding = Encoding.GetEncoding(932); }
                catch { encoding = Encoding.UTF8; }

                var htmlContent = encoding.GetString(rawBytes);

                // JSタグの挿入のみ実施
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
                // APIや画像などは生データを完全無加工でスルー
                await upstreamResponse.Content.CopyToAsync(context.Response.Body);
            }
        }
    }
}