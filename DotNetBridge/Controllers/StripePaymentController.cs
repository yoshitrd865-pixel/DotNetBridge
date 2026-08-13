using Microsoft.AspNetCore.Mvc;
using Stripe;
using Stripe.Checkout;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore; // DB連携用

namespace DotNetBridge.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class StripePaymentController : ControllerBase
    {
        private readonly IConfiguration _config;
        private readonly ILogger<StripePaymentController> _logger;
        private readonly PaymentDbContext _dbContext; // DB文脈をインジェクション

        public StripePaymentController(
            IConfiguration config, 
            ILogger<StripePaymentController> logger,
            PaymentDbContext dbContext)
        {
            _config = config;
            _logger = logger;
            _dbContext = dbContext;

            // Renderの環境変数(OS環境変数) または appsettings.json からAPIキーを取得
            var secretKey = Environment.GetEnvironmentVariable("Stripe__SecretKey") 
                            ?? Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY")
                            ?? _config["Stripe:SecretKey"];

            StripeConfiguration.ApiKey = secretKey;
        }       

        // ==========================================
        // 1. QRコード生成用 Checkout Session 作成 (実装済み)
        // ==========================================
        [HttpPost("create-checkout")]
        public async Task<IActionResult> CreateCheckout([FromBody] CreateCheckoutRequest req)
        {
            if (req.Amount <= 0) return BadRequest(new { error = "金額が無効です" });

            try
            {
                var domain = $"{Request.Scheme}://{Request.Host}";
                var customerName = string.IsNullOrWhiteSpace(req.CustomerName) ? "お施主様" : req.CustomerName.Trim();
                if (!customerName.EndsWith("様") && !customerName.EndsWith("様邸"))
                {
                    customerName += " 様";
                }

                var itemDescription = string.IsNullOrWhiteSpace(req.ItemDescription) ? "浄化槽維持管理費" : req.ItemDescription.Trim();
                var invoiceNo = string.IsNullOrWhiteSpace(req.InvoiceNo) ? "未指定" : req.InvoiceNo.Trim();
                var customerCode = string.IsNullOrWhiteSpace(req.CustomerCode) ? "未指定" : req.CustomerCode.Trim();

                var options = new SessionCreateOptions
                {
                    PaymentMethodTypes = new List<string> { "card" },
                    LineItems = new List<SessionLineItemOptions>
                    {
                        new SessionLineItemOptions
                        {
                            PriceData = new SessionLineItemPriceDataOptions
                            {
                                Currency = "jpy",
                                UnitAmount = req.Amount,
                                ProductData = new SessionLineItemPriceDataProductDataOptions
                                {
                                    Name = itemDescription,
                                    Description = $"お施主様: {customerName} (伝票No: {invoiceNo})"
                                }
                            },
                            Quantity = 1,
                        }
                    },
                    Mode = "payment",
                    SuccessUrl = $"{domain}/success",
                    CancelUrl = $"{domain}/cancel",
                    Metadata = new Dictionary<string, string>
                    {
                        { "customer_code", customerCode },
                        { "customer_name", customerName },
                        { "invoice_no", invoiceNo },
                        { "item_description", itemDescription }
                    }
                };

                var service = new SessionService();
                Session session = await service.CreateAsync(options);

                return Ok(new { url = session.Url });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Stripe Checkout生成エラー");
                return StatusCode(500, new { error = ex.Message });
            }
        }

        // ==========================================
        // 2. Stripeからの Webhook 受信＆署名検証＆DB消込処理 (新規追加)
        // ==========================================
        [HttpPost("webhook")]
        public async Task<IActionResult> ReceiveWebhook()
        {
            // Render環境変数 (STRIPE_WEBHOOK_SECRET) または appsettings.json から署名シークレットを取得
            var webhookSecret = Environment.GetEnvironmentVariable("STRIPE_WEBHOOK_SECRET")
                                ?? Environment.GetEnvironmentVariable("Stripe__WebhookSecret")
                                ?? _config["Stripe:WebhookSecret"];

            // Raw Body（生のJSON文字列）を取得
            var json = await new StreamReader(HttpContext.Request.Body).ReadToEndAsync();
            var signatureHeader = Request.Headers["Stripe-Signature"];

            try
            {
                // ① Stripe.net による公式の改ざん・署名チェック
                var stripeEvent = EventUtility.ConstructEvent(
                    json,
                    signatureHeader,
                    webhookSecret
                );

                // ② 決済完了（checkout.session.completed）の場合
                if (stripeEvent.Type == Events.CheckoutSessionCompleted)
                {
                    var session = stripeEvent.Data.Object as Session;

                    if (session != null)
                    {
                        // 二重処理防止チェック
                        var existingLog = await _dbContext.PaymentLogs
                            .FirstOrDefaultAsync(p => p.StripeSessionId == session.Id);

                        if (existingLog == null)
                        {
                            // Metadataから伝票番号・顧客コードを抽出
                            var invoiceNo = session.Metadata?.GetValueOrDefault("invoice_no") ?? "未指定";
                            var customerCode = session.Metadata?.GetValueOrDefault("customer_code") ?? "未指定";

                            // ③ PaymentDbContext へ決済ログ保存（消込処理）
                            var paymentLog = new PaymentLog
                            {
                                InvoiceNo = invoiceNo,
                                CustomerCode = customerCode,
                                Amount = session.AmountTotal ?? 0,
                                StripeSessionId = session.Id,
                                Status = "PAID",
                                PaidAt = DateTime.UtcNow
                            };

                            _dbContext.PaymentLogs.Add(paymentLog);
                            await _dbContext.SaveChangesAsync();

                            _logger.LogInformation($"[Stripe Webhook] 決済成功＆DB保存完了: 伝票No={invoiceNo}, 顧客コード={customerCode}");
                        }
                    }
                }

                // Stripeへ成功レスポンスを返答
                return Ok();
            }
            catch (StripeException ex)
            {
                _logger.LogError(ex, "Stripe Webhook 署名検証エラー");
                return BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Stripe Webhook 処理内部エラー");
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }

    public class CreateCheckoutRequest
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