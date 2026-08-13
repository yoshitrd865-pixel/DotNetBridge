using Microsoft.AspNetCore.Mvc;
using Stripe;
using Stripe.Checkout;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class StripePaymentController : Controller
    {
        private readonly IConfiguration _config;
        private readonly ILogger<StripePaymentController> _logger;
        private readonly PaymentDbContext _dbContext;

        public StripePaymentController(
            IConfiguration config, 
            ILogger<StripePaymentController> logger,
            PaymentDbContext dbContext)
        {
            _config = config;
            _logger = logger;
            _dbContext = dbContext;

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
                    SuccessUrl = $"{domain}/success?session_id={{CHECKOUT_SESSION_ID}}",
                    CancelUrl = $"{domain}/cancel",
                    Metadata = new Dictionary<string, string>
                    {
                        { "customer_code", customerCode },
                        { "customer_name", customerName },
                        { "invoice_no", invoiceNo },
                        { "item_description", itemDescription }
                    },
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
                var stripeEvent = EventUtility.ConstructEvent(
                    json,
                    signatureHeader,
                    webhookSecret
                );

                if (stripeEvent.Type == EventTypes.CheckoutSessionCompleted)
                {
                    var session = stripeEvent.Data.Object as Session;

                    if (session != null)
                    {
                        // 二重書き込みチェック
                        var existingLog = await _dbContext.PaymentLogs
                            .FirstOrDefaultAsync(p => p.StripeSessionId == session.Id);

                        if (existingLog == null)
                        {
                            var invoiceNo = session.Metadata?.GetValueOrDefault("invoice_no") ?? "未指定";
                            var customerCode = session.Metadata?.GetValueOrDefault("customer_code") ?? "未指定";

                            // DB へ消込ログ保存
                            var paymentLog = new PaymentLog
                            {
                                InvoiceNo = invoiceNo,
                                CustomerCode = customerCode,
                                Amount = session.AmountTotal ?? 0,
                                StripeSessionId = session.Id,
                                Status = "completed",
                                PaidAt = DateTime.UtcNow
                            };

                            _dbContext.PaymentLogs.Add(paymentLog);
                            await _dbContext.SaveChangesAsync();

                            _logger.LogInformation($"[DB保存成功] 伝票No: {invoiceNo}, 顧客コード: {customerCode}");
                        }
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

        // 保存された消込データを一覧取得する確認用 API
        [HttpGet("logs")]
        public async Task<IActionResult> GetPaymentLogs()
        {
            var logs = await _dbContext.PaymentLogs
                .OrderByDescending(p => p.PaidAt)
                .ToListAsync();
            return Ok(logs);
        }

        // ─── 以下、Tampermonkey アシストくん用連携 API ───

        // 1. 未処理データ取得 (GET)
        [HttpGet("get_unprocessed")]
        public async Task<IActionResult> GetUnprocessed()
        {
            var logs = await _dbContext.PaymentLogs
                .Where(p => (p.Status == "completed" || p.Status == "PAID") && p.CustomerCode != "未指定" && p.InvoiceNo != "未指定")
                .OrderBy(p => p.Id)
                .Select(p => new
                {
                    id = p.Id,
                    customer_code = p.CustomerCode,
                    invoice_no = p.InvoiceNo,
                    amount_total = p.Amount,
                    status = p.Status
                })
                .ToListAsync();

            return Ok(logs);
        }

        // 2. 消込完了ステータス更新 (POST)
        [HttpPost("get_unprocessed")]
        public async Task<IActionResult> UpdateProcessed([FromBody] ProcessedRequest req)
        {
            if (req.Id <= 0) return BadRequest(new { success = false, error = "Missing ID" });

            var log = await _dbContext.PaymentLogs.FindAsync(req.Id);
            if (log != null)
            {
                log.Status = "processed";
                await _dbContext.SaveChangesAsync();
                return Ok(new { success = true });
            }

            return NotFound(new { success = false, error = "Log not found" });
        }
        /// <summary>
        /// 決済完了画面
        /// </summary>
        [HttpGet("/success")]
        public IActionResult Success([FromQuery] string session_id)
        {
            // Stripeからリダイレクト時に渡される session_id をViewに渡す
            ViewBag.SessionId = session_id;
            return View();
        }

        /// <summary>
        /// 決済キャンセル・失敗画面
        /// </summary>
        [HttpGet("/cancel")]
        public IActionResult Cancel()
        {
            return View();
        }


    }

    public class ProcessedRequest
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }
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