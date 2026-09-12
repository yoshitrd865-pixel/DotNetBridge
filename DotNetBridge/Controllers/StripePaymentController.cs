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
            
            // Stripe APIキーの設定
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
        /// Stripe Webhook (決済完了イベント checkout.session.completed の受信)
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

                if (stripeEvent.Type == Events.CheckoutSessionCompleted)
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
        /// 画面リダイレクト時の成功ハンドラ（Webhookが遅延した場合のフォールバック）
        /// </summary>
        [HttpGet("process-success")]
        public async Task<IActionResult> ProcessSuccess([FromQuery] string session_id)
        {
            try
            {
                var service = new SessionService();
                var session = await service.GetAsync(session_id);

                if (session != null && session.PaymentStatus == "paid")
                {
                    await ProcessPaymentSuccessAsync(session);
                    return Ok(new { success = true });
                }

                return BadRequest("未決済のセッションです。");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Process Success Error]");
                return StatusCode(500, ex.Message);
            }
        }

        /// <summary>
        /// 決済成功時の共通処理（既存のunpaidレコードを優先更新）
        /// </summary>
        private async Task ProcessPaymentSuccessAsync(Session session)
        {
            var invoiceNo = session.Metadata.ContainsKey("invoice_no") ? session.Metadata["invoice_no"] : "";
            var customerCode = session.Metadata.ContainsKey("customer_code") ? session.Metadata["customer_code"] : "";
            var customerName = session.Metadata.ContainsKey("customer_name") ? session.Metadata["customer_name"] : "";

            // 1. まず「伝票番号 ＋ 顧客コード」で事前作成された未決済ログを探す
            PaymentLog? log = null;
            if (!string.IsNullOrEmpty(invoiceNo) && invoiceNo != "未指定")
            {
                log = await _dbContext.PaymentLogs
                    .FirstOrDefaultAsync(p => p.InvoiceNo == invoiceNo && p.CustomerCode == customerCode);
            }

            // 2. 見つからない場合は StripeSessionId で検索
            if (log == null)
            {
                log = await _dbContext.PaymentLogs
                    .FirstOrDefaultAsync(p => p.StripeSessionId == session.Id);
            }

            var now = DateTime.UtcNow;

            if (log != null)
            {
                // ★ 既存の未決済レコード（ID 10など）を「Stripe決済済」に更新
                log.StripeSessionId = session.Id;
                log.Status = "completed"; // Stripe決済完了ステータス
                log.PaidAt = now;
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
                // 印刷を経由せずに直接決済された場合の新規作成
                log = new PaymentLog
                {
                    InvoiceNo = string.IsNullOrEmpty(invoiceNo) ? "未指定" : invoiceNo,
                    CustomerCode = string.IsNullOrEmpty(customerCode) ? "未指定" : customerCode,
                    CustomerName = string.IsNullOrEmpty(customerName) ? "お施主様" : customerName,
                    Amount = session.AmountTotal ?? 0,
                    StripeSessionId = session.Id,
                    Status = "completed",
                    IssuedBy = "Stripe直接決済",
                    IssuedAt = now,
                    PaidAt = now,
                    PdfFileName = null
                };
                _dbContext.PaymentLogs.Add(log);
            }

            await _dbContext.SaveChangesAsync();
            _logger.LogInformation($"[Stripe決済完了処理完了] 伝票: {invoiceNo}, SessionId: {session.Id}");
        }
    }
}