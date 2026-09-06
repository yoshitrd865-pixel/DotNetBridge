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

                client.DefaultRequestHeaders.Add("x-access-token", accessToken);
                client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                // 🎯 仕様書通りの完全なメインURL + POST /va/issue
                var apiUrl = "https://api.sunabar.gmo-aozora.com/ganb/api/corporation/v1/va/issue";

                // 仕様書通りのリクエストボディパラメータ
                var requestBody = new
                {
                    vaTypeCode = "1",            // 1:期限型, 2:継続型
                    issueRequestCount = "1",     // 発行件数 1件
                    raId = "6921371458"          // sunabarの法人口座ID(ログインID)
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

                // レスポンスの解析 (vaList配列から取得)
                string branchCode = "";
                string accountNumber = "";

                if (root.TryGetProperty("vaList", out var vaList) && vaList.GetArrayLength() > 0)
                {
                    var firstVa = vaList[0];
                    branchCode = firstVa.TryGetProperty("vaBranchCode", out var bc) ? bc.GetString() ?? "" : "";
                    accountNumber = firstVa.TryGetProperty("vaAccountNumber", out var ac) ? ac.GetString() ?? "" : "";
                }

                var accountHolder = root.TryGetProperty("vaHolderNameKana", out var ah) ? ah.GetString() : "ハシモトハイツ";

                var result = new
                {
                    bankName = "GMOあおぞらネット銀行",
                    branchName = $"支店コード({branchCode})",
                    accountNumber = accountNumber,
                    accountHolder = accountHolder,
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