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

        /// <summary>
        /// QRコードスキャン時にStripe Checkoutセッションを生成して決済画面へリダイレクト
        /// </summary>
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
                                    Name = string.IsNullOrEmpty(item_description) ? "浄化槽維持管理費" : item_description,
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
                        { "customer_name", customer_name ?? "" }
                    }
                };

                var service = new SessionService();
                Session session = await service.CreateAsync(options);

                return Redirect(session.Url);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Stripe Checkout Create Error]");
                return BadRequest($"決済セッションの生成に失敗しました: {ex.Message}");
            }
        }

        /// <summary>
        /// ★ 追加: Stripe決済完了後のスマホ用リダイレクト画面
        /// </summary>
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
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Stripe Success Page Processing Error]");
            }

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

        /// <summary>
        /// ★ 追加: Stripe決済中断時のスマホ用画面
        /// </summary>
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

        /// <summary>
        /// Stripe Webhook
        /// </summary>
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
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Stripe Webhook Error]");
                return BadRequest();
            }
        }

        /// <summary>
        /// 決済成功時の共通処理（日本時間 JST で記録）
        /// </summary>
        private async Task ProcessPaymentSuccessAsync(Session session)
        {
            var invoiceNo = session.Metadata.ContainsKey("invoice_no") ? session.Metadata["invoice_no"] : "";
            var customerCode = session.Metadata.ContainsKey("customer_code") ? session.Metadata["customer_code"] : "";
            var customerName = session.Metadata.ContainsKey("customer_name") ? session.Metadata["customer_name"] : "";

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

            // ★ 日本時間（JST = UTC + 9時間）で保存
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
            }
            else
            {
                log = new PaymentLog
                {
                    InvoiceNo = string.IsNullOrEmpty(invoiceNo) ? "未指定" : invoiceNo,
                    CustomerCode = string.IsNullOrEmpty(customerCode) ? "未指定" : customerCode,
                    CustomerName = string.IsNullOrEmpty(customerName) ? "お施主様" : customerName,
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
            _logger.LogInformation($"[Stripe決済完了処理完了] 伝票: {invoiceNo}, SessionId: {session.Id}");
        }
    }
}