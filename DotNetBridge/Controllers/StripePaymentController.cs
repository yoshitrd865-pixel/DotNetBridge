// Controllers/StripePaymentController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stripe;
using Stripe.Checkout;
using DotNetBridge.Data;

namespace DotNetBridgeApp.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class StripePaymentController : ControllerBase
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

        [HttpGet("redirect-checkout")]
        public async Task<IActionResult> RedirectCheckout(
            [FromQuery] long amount,
            [FromQuery] string customer_code,
            [FromQuery] string customer_name,
            [FromQuery] string invoice_no,
            [FromQuery] string item_description)
        {
            try
            {
                var domain = $"{Request.Scheme}://{Request.Host}";
                var descriptionText = string.IsNullOrEmpty(item_description) ? "浄化槽維持管理費" : item_description;

                var options = new SessionCreateOptions
                {
                    PaymentMethodTypes = new List<string> { "card" },
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
                return BadRequest($"決済セッション生成失敗: {ex.Message}");
            }
        }

        [HttpGet("/StripePayment/Success")]
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
            catch { }

            var html = @"<!DOCTYPE html>
            <html lang='ja'>
            <head>
                <meta charset='utf-8'>
                <meta name='viewport' content='width=device-width, initial-scale=1.0'>
                <title>決済完了</title>
                <link href='https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css' rel='stylesheet'>
                <link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css'>
            </head>
            <body class='bg-light d-flex align-items-center justify-content-center min-vh-100 py-4'>
                <div class='card shadow-lg border-0 text-center p-4 m-3' style='max-width: 420px; border-radius: 16px;'>
                    <div class='card-body'>
                        <div class='text-success mb-3'>
                            <i class='bi bi-check-circle-fill' style='font-size: 4.5rem;'></i>
                        </div>
                        <h3 class='fw-bold text-dark mb-2'>お支払い完了</h3>
                        <p class='text-muted mb-4'>クレジットカードでの決済が正常に完了いたしました。<br>ご協力ありがとうございました。</p>
                        <button onclick='window.close()' class='btn btn-success btn-lg w-100 shadow-sm rounded-pill'>画面を閉じる</button>
                    </div>
                </div>
            </body>
            </html>";

            return Content(html, "text/html; charset=utf-8");
        }

        [HttpGet("/StripePayment/Cancel")]
        public IActionResult Cancel()
        {
            var html = @"<!DOCTYPE html>
            <html lang='ja'>
            <head>
                <meta charset='utf-8'>
                <meta name='viewport' content='width=device-width, initial-scale=1.0'>
                <title>決済キャンセル</title>
                <link href='https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css' rel='stylesheet'>
                <link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css'>
            </head>
            <body class='bg-light d-flex align-items-center justify-content-center min-vh-100 py-4'>
                <div class='card shadow-lg border-0 text-center p-4 m-3' style='max-width: 420px; border-radius: 16px;'>
                    <div class='card-body'>
                        <div class='text-warning mb-3'>
                            <i class='bi bi-exclamation-triangle-fill' style='font-size: 4.5rem;'></i>
                        </div>
                        <h3 class='fw-bold text-dark mb-2'>決済が中断されました</h3>
                        <p class='text-muted mb-4'>お支払い手続きが完了していません。</p>
                        <button onclick='window.close()' class='btn btn-secondary btn-lg w-100 shadow-sm rounded-pill'>画面を閉じる</button>
                    </div>
                </div>
            </body>
            </html>";

            return Content(html, "text/html; charset=utf-8");
        }

        [HttpPost("webhook")]
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
            catch
            {
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