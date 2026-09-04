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
                // 環境変数の取得（Render上の設定値）
                var accessToken = Environment.GetEnvironmentVariable("GMO_AOZORA_ACCESS_TOKEN") 
                                  ?? _config["GmoAozora:AccessToken"];

                if (string.IsNullOrEmpty(accessToken))
                {
                    _logger.LogError("GMO_AOZORA_ACCESS_TOKEN が設定されていません");
                    return StatusCode(500, new { error = "アクセストークン未設定" });
                }

                var client = _httpClientFactory.CreateClient();
                
                // ✅ sunabar仕様のヘッダー設定へ書き換え
                client.DefaultRequestHeaders.Add("x-access-token", accessToken);
                client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                // sunabar環境のバーチャル口座発行API URL
                // ※sunabar指定のエンドポイントURLを確認して設定
                var apiUrl = "https://api.sunabar.gmo-aozora.com/ganb/api/corporation/v1/va/accounts";

                // リクエストボディ作成
                var requestBody = new
                {
                    // 伝票番号や顧客コードを取引識別IDとしてセット
                    transferTitle = req.InvoiceNo != "未指定" ? req.InvoiceNo : "HHC",
                    expirationDate = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd") // 有効期限30日
                };

                var jsonContent = new StringContent(
                    JsonSerializer.Serialize(requestBody),
                    Encoding.UTF8,
                    "application/json"
                );

                // API呼び出し
                var response = await client.PostAsync(apiUrl, jsonContent);
                var responseString = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"あおぞらAPIエラー Status: {response.StatusCode}, Body: {responseString}");
                    return StatusCode((int)response.StatusCode, new { 
                        error = $"あおぞらAPI通信エラー ({response.StatusCode})", 
                        details = responseString 
                    });
                }

                // レスポンス解析（APIの返戻JSON構造に合わせて抽出）
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
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
}