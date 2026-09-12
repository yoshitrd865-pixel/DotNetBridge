// Controllers/StripePaymentController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stripe;
using Stripe.Checkout;
using DotNetBridge.Data;

namespace DotNetBridgeApp.Controllers
{
    // ★ View() を返すため Controller を継承
    public class StripePaymentController : Controller
    {
        private readonly IConfiguration _config;
        private readonly PaymentDbContext _dbContext;
        private readonly ILogger<StripePaymentController> _logger;

        public StripePaymentController(
            IConfiguration config, 
            PaymentDbContext dbContext,
            ILogger<StripePaymentController> logger)
        {
            _config = config;
            _dbContext = dbContext;
            _logger = logger;
            
            StripeConfiguration.ApiKey = _config["Stripe:SecretKey"] 
                ?? Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY");
        }

        /// <summary>
        /// QRコードスキャン時にStripe Checkoutセッションを生成して決済画面へリダイレクト
        /// </summary>
        [HttpGet("api/StripePayment/redirect-checkout")]
        [HttpGet("/EcoToubuF3/mobile60_ToubuF/api/StripePayment/redirect-checkout")]
        public async Task<IActionResult> RedirectCheckout(
            [FromQuery] long amount,
            [FromQuery] string customer_code,
            [FromQuery] string customer_name,
            [FromQuery] string invoice_no,
            [FromQuery] string item_description)
        {
            try
            {
                // ★ 本家IISでの404回避のため、戻り先ドメインをRenderへ固定
                var domain = _config["AppBaseUrl"] 
                    ?? Environment.GetEnvironmentVariable("APP_BASE_URL") 
                    ?? "https://tfk-env.onrender.com";

                var descriptionText = string.IsNullOrEmpty(item_description) ? "浄化槽維持管理費" : item_description;

                var options = new SessionCreateOptions
                {
                    // ★ クレカ・PayPay・コンビニ決済を全て有効化
                    PaymentMethodTypes = new List<string> { "card", "paypay", "konbini" },
                    LineItems = new List<SessionLineItemOptions>
                    {
                        new SessionLineItemOptions
                        {
                            PriceData = new SessionLineItemPriceDataOptions
                            {
                                UnitAmount = amount,
                                Currency = "jpy",
                                ProductData = new SessionLineItemPriceDataProductDataOptions
                                {
                                    Name = descriptionText,
                                },
                            },
                            Quantity = 1,
                        },
                    },
                    Mode = "payment",
                    SuccessUrl = $"{domain}/StripePayment/Success?session_id={{CHECKOUT_SESSION_ID}}",
                    CancelUrl = $"{domain}/StripePayment/Cancel",
                    Metadata = new Dictionary<string, string>
                    {
                        { "invoice_no", invoice_no ?? "" },
                        { "customer_code", customer_code ?? "" },
                        { "customer_name", customer_name ?? "" },
                        { "item_description", descriptionText }
                    }
                };

                var service = new SessionService();
                Session session = await service.CreateAsync(options);

                return Redirect(session.Url);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Stripe Checkout Create Error]");
                return BadRequest($"決済セッション生成失敗: {ex.Message}");
            }
        }

        /// <summary>
        /// Stripe決済完了後の画面表示（Views/StripePayment/Success.cshtml をレンダリング）
        /// </summary>
        [HttpGet("/StripePayment/Success")]
        [HttpGet("/EcoToubuF3/mobile60_ToubuF/StripePayment/Success")]
        public async Task<IActionResult> Success([FromQuery] string session_id)
        {
            try
            {
                if (!string.IsNullOrEmpty(session_id))
                {
                    var service = new SessionService();
                    var session = await service.GetAsync(session_id);
                    if (session != null && session.PaymentStatus == "paid")
                    {
                        await ProcessPaymentSuccessAsync(session);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Stripe Success Page Processing Error]");
            }

            // ★ Views/StripePayment/Success.cshtml を表示
            return View("~/Views/StripePayment/Success.cshtml");
        }

        /// <summary>
        /// Stripe決済キャンセル画面（Views/StripePayment/Cancel.cshtml を表示）
        /// </summary>
        [HttpGet("/StripePayment/Cancel")]
        [HttpGet("/EcoToubuF3/mobile60_ToubuF/StripePayment/Cancel")]
        public IActionResult Cancel()
        {
            // ★ Views/StripePayment/Cancel.cshtml を表示
            return View("~/Views/StripePayment/Cancel.cshtml");
        }

        /// <summary>
        /// Stripe Webhook
        /// </summary>
        [HttpPost("api/StripePayment/webhook")]
        [HttpPost("/EcoToubuF3/mobile60_ToubuF/api/StripePayment/webhook")]
        public async Task<IActionResult> Webhook()
        {
            var json = await new StreamReader(HttpContext.Request.Body).ReadToEndAsync();
            var webhookSecret = _config["Stripe:WebhookSecret"] 
                ?? Environment.GetEnvironmentVariable("STRIPE_WEBHOOK_SECRET");

            try
            {
                var stripeEvent = EventUtility.ConstructEvent(
                    json,
                    Request.Headers["Stripe-Signature"],
                    webhookSecret
                );

                if (stripeEvent.Type == EventTypes.CheckoutSessionCompleted || stripeEvent.Type == "checkout.session.completed")
                {
                    var session = stripeEvent.Data.Object as Session;
                    if (session != null)
                    {
                        await ProcessPaymentSuccessAsync(session);
                    }
                }

                return Ok();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Stripe Webhook Error]");
                return BadRequest();
            }
        }

        private async Task ProcessPaymentSuccessAsync(Session session)
        {
            var invoiceNo = session.Metadata.ContainsKey("invoice_no") ? session.Metadata["invoice_no"] : "";
            var customerCode = session.Metadata.ContainsKey("customer_code") ? session.Metadata["customer_code"] : "";
            var customerName = session.Metadata.ContainsKey("customer_name") ? session.Metadata["customer_name"] : "";
            var itemDesc = session.Metadata.ContainsKey("item_description") ? session.Metadata["item_description"] : "";

            PaymentLog? log = null;
            if (!string.IsNullOrEmpty(invoiceNo) && invoiceNo != "未指定")
            {
                log = await _dbContext.PaymentLogs
                    .FirstOrDefaultAsync(p => p.InvoiceNo == invoiceNo && p.CustomerCode == customerCode);
            }

            if (log == null)
            {
                log = await _dbContext.PaymentLogs
                    .FirstOrDefaultAsync(p => p.StripeSessionId == session.Id);
            }

            var nowJst = DateTime.UtcNow.AddHours(9);

            if (log != null)
            {
                log.StripeSessionId = session.Id;
                log.Status = "completed";
                log.PaidAt = nowJst;
                if (session.AmountTotal.HasValue && session.AmountTotal.Value > 0)
                {
                    log.Amount = session.AmountTotal.Value;
                }
                if (!string.IsNullOrEmpty(customerName) && customerName != "未指定")
                {
                    log.CustomerName = customerName;
                }
                if (!string.IsNullOrEmpty(itemDesc) && string.IsNullOrEmpty(log.ItemDescription))
                {
                    log.ItemDescription = itemDesc;
                }
            }
            else
            {
                log = new PaymentLog
                {
                    InvoiceNo = string.IsNullOrEmpty(invoiceNo) ? "未指定" : invoiceNo,
                    CustomerCode = string.IsNullOrEmpty(customerCode) ? "未指定" : customerCode,
                    CustomerName = string.IsNullOrEmpty(customerName) ? "お施主様" : customerName,
                    ItemDescription = string.IsNullOrEmpty(itemDesc) ? "維持管理・清掃作業料" : itemDesc,
                    Amount = session.AmountTotal ?? 0,
                    StripeSessionId = session.Id,
                    Status = "completed",
                    IssuedBy = "Stripe直接決済",
                    IssuedAt = nowJst,
                    PaidAt = nowJst,
                    PdfFileName = null
                };
                _dbContext.PaymentLogs.Add(log);
            }

            await _dbContext.SaveChangesAsync();
        }
    }
}