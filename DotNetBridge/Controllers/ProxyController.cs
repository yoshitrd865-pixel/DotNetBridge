using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

namespace DotNetBridge.Controllers
{
    [Route("proxy")]
    public class ProxyController : ControllerBase
    {
        private const string TargetBase = "https://hhc-eco11.com/";

        private static readonly string[] HopByHopHeaders =
        {
            "transfer-encoding", "content-length", "content-encoding", "connection", "keep-alive"
        };

        private readonly IHttpClientFactory _httpClientFactory;

        public ProxyController(IHttpClientFactory httpClientFactory)
        {
            _httpClientFactory = httpClientFactory;
        }

        // ⚠️重要: アクションに引数(string catchAll等)を持たせると、
        // ASP.NET Core が POST ボディを自動消費してしまうため、引数は「絶対になし」にする。
        [AcceptVerbs("GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH")]
        [Route("")]
        public Task ProxyRootAsync() => ProxyAsync();

        [AcceptVerbs("GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH")]
        [Route("{**path}")]
        public async Task ProxyAsync()
        {
            // パスは RouteData から手動取得してボディの自動バインド・消費を防止
            var path = RouteData.Values["path"] as string ?? string.Empty;
            var targetUri = TargetBase + path + Request.QueryString.Value;

            using var client = _httpClientFactory.CreateClient("NoRedirectClient");
            using var upstreamRequest = new HttpRequestMessage(new HttpMethod(Request.Method), targetUri);

            // --- 1. リクエストヘッダーの転送 ＆ 変換 ---
            foreach (var header in Request.Headers)
            {
                var key = header.Key;
                if (key.Equals("Host", StringComparison.OrdinalIgnoreCase)) continue;
                if (key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
                if (key.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
                if (key.StartsWith(":", StringComparison.Ordinal)) continue;
                if (key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) continue;

                // Cookie（ASPSESSIONID等）の転送
                if (key.Equals("Cookie", StringComparison.OrdinalIgnoreCase))
                {
                    upstreamRequest.Headers.TryAddWithoutValidation(key, header.Value.ToArray());
                    continue;
                }

                // Referer / Origin の本家ドメイン書き換え（ASP側の直アクセス拒否を回避）
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

            // --- 2. リクエストボディの転送（バイト列をそのまま生転送） ---
            if (HttpMethods.IsPost(Request.Method) ||
                HttpMethods.IsPut(Request.Method) ||
                HttpMethods.IsPatch(Request.Method))
            {
                var memoryStream = new MemoryStream();
                await Request.Body.CopyToAsync(memoryStream);
                memoryStream.Position = 0;

                var streamContent = new StreamContent(memoryStream);
                if (Request.ContentType != null)
                {
                    streamContent.Headers.TryAddWithoutValidation("Content-Type", Request.ContentType);
                }
                upstreamRequest.Content = streamContent;
            }

            // --- 3. アップストリーム通信の実行 ---
            HttpResponseMessage upstreamResponse;
            try
            {
                upstreamResponse = await client.SendAsync(upstreamRequest, HttpCompletionOption.ResponseHeadersRead, HttpContext.RequestAborted);
            }
            catch (TaskCanceledException)
            {
                return;
            }

            // --- 4. レスポンスステータス ＆ ヘッダーの転送 ---
            Response.StatusCode = (int)upstreamResponse.StatusCode;

            foreach (var header in upstreamResponse.Headers)
            {
                var key = header.Key;
                if (HopByHopHeaders.Contains(key.ToLowerInvariant())) continue;

                // Cookieのドメイン制限解除
                if (key.Equals("Set-Cookie", StringComparison.OrdinalIgnoreCase))
                {
                    var modifiedCookies = header.Value.Select(cookie =>
                        Regex.Replace(cookie, @"Domain=[^;]+;", string.Empty, RegexOptions.IgnoreCase)
                    ).ToArray();
                    Response.Headers[key] = modifiedCookies;
                    continue;
                }

                Response.Headers[key] = header.Value.ToArray();
            }

            foreach (var header in upstreamResponse.Content.Headers)
            {
                var key = header.Key;
                if (HopByHopHeaders.Contains(key.ToLowerInvariant())) continue;
                Response.Headers[key] = header.Value.ToArray();
            }

            // --- 5. レスポンスボディの返却（旧ドメイン置換） ---
            var contentType = upstreamResponse.Content.Headers.ContentType?.ToString() ?? string.Empty;

            if (contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
            {
                var rawBytes = await upstreamResponse.Content.ReadAsByteArrayAsync();
                
                // Shift_JIS で読み込み
                Encoding encoding;
                try { encoding = Encoding.GetEncoding(932); }
                catch { encoding = Encoding.UTF8; }

                var htmlContent = encoding.GetString(rawBytes);

                // 旧ドメイン(hhc-eco1.com)の遅延用置換
                htmlContent = htmlContent.Replace("https://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("http://hhc-eco1.com", "https://hhc-eco11.com")
                                         .Replace("//hhc-eco1.com", "//hhc-eco11.com");

                var modifiedBytes = encoding.GetBytes(htmlContent);
                Response.ContentLength = modifiedBytes.Length;

                await Response.Body.WriteAsync(modifiedBytes, 0, modifiedBytes.Length);
            }
            else
            {
                await upstreamResponse.Content.CopyToAsync(Response.Body);
            }
        }
    }
}