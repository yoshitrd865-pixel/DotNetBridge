using Microsoft.AspNetCore.Mvc;
using Stripe;
using Stripe.Checkout;
using System.Text.Json.Serialization;

namespace DotNetBridge.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class StripePaymentController : ControllerBase
    {
        private readonly IConfiguration _config;
        private readonly ILogger<StripePaymentController> _logger;

        public StripePaymentController(
            IConfiguration config, 
            ILogger<StripePaymentController> logger)
        {
            _config = config;
            _logger = logger;

            var secretKey = Environment.GetEnvironmentVariable("Stripe__SecretKey") 
                            ?? Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY")
                            ?? _config["Stripe:SecretKey"];

            StripeConfiguration.ApiKey = secretKey;
        }       

        // 1. QRコード生成用 Checkout Session 作成 (実装済み)
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

        // 2. Stripeからの Webhook 受信＆署名検証（ログ確認版）
        [HttpPost("webhook")]
        public async Task<IActionResult> ReceiveWebhook()
        {
            var webhookSecret = Environment.GetEnvironmentVariable("STRIPE_WEBHOOK_SECRET")
                                ?? Environment.GetEnvironmentVariable("Stripe__WebhookSecret")
                                ?? _config["Stripe:WebhookSecret"];

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
                // ★ EventTypes.CheckoutSessionCompleted を使用します
                if (stripeEvent.Type == EventTypes.CheckoutSessionCompleted)
                {
                    var session = stripeEvent.Data.Object as Session;

                    if (session != null)
                    {
                        var invoiceNo = session.Metadata?.GetValueOrDefault("invoice_no") ?? "未指定";
                        var customerCode = session.Metadata?.GetValueOrDefault("customer_code") ?? "未指定";

                        // 受信成功ログを出力
                        _logger.LogInformation($"[Stripe Webhook成功] 伝票No: {invoiceNo}, 顧客コード: {customerCode}, 金額: {session.AmountTotal}円");
                    }
                }

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