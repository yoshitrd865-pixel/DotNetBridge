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

        public StripePaymentController(IConfiguration config, ILogger<StripePaymentController> logger)
        {
         _config = config;
         _logger = logger;
         // Renderの環境変数(OS環境変数) または appsettings.json からキーを取得
            var secretKey = Environment.GetEnvironmentVariable("Stripe__SecretKey") 
                            ?? Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY")
                            ?? _config["Stripe:SecretKey"];

             StripeConfiguration.ApiKey = secretKey;
}       

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