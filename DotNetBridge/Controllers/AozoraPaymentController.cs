using Microsoft.AspNetCore.Mvc;
using System.Text.Json.Serialization;

namespace DotNetBridge.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AozoraPaymentController : Controller
    {
        private readonly ILogger<AozoraPaymentController> _logger;

        public AozoraPaymentController(ILogger<AozoraPaymentController> logger)
        {
            _logger = logger;
        }

        [HttpPost("create-account")]
        public async Task<IActionResult> CreateAccount([FromBody] CreateAozoraAccountRequest req)
        {
            if (req.Amount <= 0) return BadRequest(new { error = "金額が無効です" });

            try
            {
                // TODO: ここでGMOあおぞらAPI（sunabar）を呼び出して動的口座を発行
                // 現在は通信疎通確認用にテスト用のダミーデータを返します
                
                var mockResult = new
                {
                    bankName = "GMOあおぞらネット銀行",
                    branchName = "サンシャイン支店",
                    accountNumber = "1234567",
                    accountHolder = "ハシモトハイツ",
                    amount = req.Amount
                };

                return Ok(mockResult);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "あおぞら口座発行エラー");
                return StatusCode(500, new { error = ex.Message });
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