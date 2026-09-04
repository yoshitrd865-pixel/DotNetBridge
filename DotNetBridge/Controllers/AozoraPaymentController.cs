using Microsoft.AspNetCore.Mvc;
using System.Text.Json.Serialization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace DotNetBridge.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AozoraPaymentController : Controller
    {
        private readonly ILogger<AozoraPaymentController> _logger;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _config;

        public AozoraPaymentController(
            ILogger<AozoraPaymentController> logger,
            IHttpClientFactory httpClientFactory,
            IConfiguration config)
        {
            _logger = logger;
            _httpClientFactory = httpClientFactory;
            _config = config;
        }

        [HttpPost("create-account")]
        public async Task<IActionResult> CreateAccount([FromBody] CreateAozoraAccountRequest req)
        {
            if (req.Amount <= 0) return BadRequest(new { error = "金額が無効です" });

            try
            {
                var accessToken = Environment.GetEnvironmentVariable("GMO_AOZORA_ACCESS_TOKEN") 
                                  ?? _config["GmoAozora:AccessToken"];

                if (string.IsNullOrEmpty(accessToken))
                {
                    _logger.LogError("GMO_AOZORA_ACCESS_TOKEN が設定されていません");
                    return Ok(new { error = "GMO_AOZORA_ACCESS_TOKEN が設定されていません" });
                }

                var client = _httpClientFactory.CreateClient();
                client.DefaultRequestHeaders.Clear();

                // 💡 ヘッダーのキー表記（大文字小文字両対応）
                client.DefaultRequestHeaders.Add("x-access-token", accessToken);
                client.DefaultRequestHeaders.Add("X-Access-Token", accessToken);
                client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                // 💡 クエリパラメータにもトークンを付与してGatewayを通過させる
                var apiUrl = $"https://api.sunabar.gmo-aozora.com/ganb/api/corporation/v1/va/accounts?x-access-token={accessToken}";

                var requestBody = new
                {
                    transferTitle = req.InvoiceNo != "未指定" ? req.InvoiceNo : "HHC",
                    expirationDate = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd")
                };

                var jsonContent = new StringContent(
                    JsonSerializer.Serialize(requestBody),
                    Encoding.UTF8,
                    "application/json"
                );

                var response = await client.PostAsync(apiUrl, jsonContent);
                var responseString = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"あおぞらAPIエラー Status: {response.StatusCode}, Body: {responseString}");
                    return Ok(new { 
                        error = $"あおぞらAPIエラー ({response.StatusCode}): {responseString}" 
                    });
                }

                using var doc = JsonDocument.Parse(responseString);
                var root = doc.RootElement;

                var result = new
                {
                    bankName = "GMOあおぞらネット銀行",
                    branchName = root.TryGetProperty("branchName", out var br) ? br.GetString() : "振込専用支店",
                    accountNumber = root.TryGetProperty("accountNumber", out var ac) ? ac.GetString() : "",
                    accountHolder = root.TryGetProperty("accountName", out var ah) ? ah.GetString() : "ハシモトハイツ",
                    amount = req.Amount
                };

                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "あおぞら口座発行処理例外");
                return Ok(new { error = $"例外発生: {ex.Message}" });
            }
        }
    }

    public class CreateAozoraAccountRequest
    {
        [JsonPropertyName("amount")]
        public long Amount { get; set; }

        [JsonPropertyName("customer_name")]
        public string? CustomerName { get; set; }

        [JsonPropertyName("customer_code")]
        public string? CustomerCode { get; set; }

        [JsonPropertyName("invoice_no")]
        public string? InvoiceNo { get; set; }

        [JsonPropertyName("item_description")]
        public string? ItemDescription { get; set; }
    }
}