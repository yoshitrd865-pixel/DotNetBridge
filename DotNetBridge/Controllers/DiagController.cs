using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DotNetBridge.Controllers
{
    // 一時的な診断用: Cloud Run の実際の送信元IPと、上流への到達性を確認する
    [Authorize]
    [ApiController]
    [Route("api/diag")]
    public class DiagController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;

        public DiagController(IHttpClientFactory httpClientFactory)
        {
            _httpClientFactory = httpClientFactory;
        }

        [HttpGet("egress")]
        public async Task<IActionResult> Egress()
        {
            var ip = await Probe("https://api.ipify.org", null);
            var bare = await Probe("https://hhc-eco11.com/", null);
            var browser = await Probe("https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/login.html",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36");

            return Ok(new { egressIp = ip, hhcRoot = bare, hhcLogin = browser });
        }

        private async Task<object> Probe(string url, string? userAgent)
        {
            var client = _httpClientFactory.CreateClient("NoRedirectClient");
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.AcceptEncoding.Clear();
            if (userAgent != null) req.Headers.TryAddWithoutValidation("User-Agent", userAgent);

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using var res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                var body = url.Contains("ipify") ? await res.Content.ReadAsStringAsync(cts.Token) : null;
                return new { url, status = (int)res.StatusCode, ms = sw.ElapsedMilliseconds, body };
            }
            catch (Exception ex)
            {
                return new { url, error = ex.GetType().Name, message = ex.InnerException?.Message ?? ex.Message, ms = sw.ElapsedMilliseconds };
            }
        }
    }
}
