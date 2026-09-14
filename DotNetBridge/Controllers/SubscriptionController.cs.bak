using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stripe;
using Stripe.Checkout;
using DotNetBridge.Data;
using System.Security.Claims;

namespace DotNetBridge.Controllers
{
    public class SubscriptionController : Controller
    {
        private readonly SubscriptionDbContext _subContext;
        private readonly IConfiguration _config;

        public SubscriptionController(SubscriptionDbContext subContext, IConfiguration config)
        {
            _subContext = subContext;
            _config = config;
            // システム提供者用のStripe API Keyを設定
            StripeConfiguration.ApiKey = _config["SYSTEM_STRIPE_SECRET_KEY"];
        }

        [HttpGet("/Subscription/Checkout")]
        public async Task<IActionResult> Checkout()
        {
            var email = User.FindFirstValue(ClaimTypes.Email);
            if (string.IsNullOrEmpty(email)) return RedirectToAction("Login", "Account");

            var sub = await _subContext.TenantSubscriptions.FirstOrDefaultAsync(s => s.GoogleEmail == email);
            if (sub != null && sub.IsActive)
            {
                return Redirect("/");
            }

            // DBから管理者設定の金額を取得 (未設定時は5,000円をデフォルトに指定)
            var priceSetting = await _subContext.SystemSettings.FirstOrDefaultAsync(s => s.Key == "MonthlyPrice");
            long amount = long.TryParse(priceSetting?.Value, out long parsedAmount) ? parsedAmount : 5000;

            var domain = $"{Request.Scheme}://{Request.Host}";
            var options = new SessionCreateOptions
            {
                CustomerEmail = email,
                PaymentMethodTypes = new List<string> { "card" },
                LineItems = new List<SessionLineItemOptions>
                {
                    new SessionLineItemOptions
                    {
                        PriceData = new SessionLineItemPriceDataOptions
                        {
                            Currency = "jpy",
                            UnitAmount = amount, // 管理画面で指定した金額を動的にセット
                            Recurring = new SessionLineItemPriceDataRecurringOptions
                            {
                                Interval = "month" // 月額サブスクリプション
                            },
                            ProductData = new SessionLineItemPriceDataProductDataOptions
                            {
                                Name = "DotNetBridge SaaSシステム月額利用料",
                            },
                        },
                        Quantity = 1,
                    },
                },
                Mode = "subscription",
                SuccessUrl = $"{domain}/Subscription/Success?session_id={{CHECKOUT_SESSION_ID}}",
                CancelUrl = $"{domain}/Subscription/Cancel",
            };

            var service = new SessionService();
            Session session = await service.CreateAsync(options);

            return Redirect(session.Url);
        }

        [HttpGet("/Subscription/Success")]
        public async Task<IActionResult> Success(string session_id)
        {
            var email = User.FindFirstValue(ClaimTypes.Email);
            if (string.IsNullOrEmpty(email)) return RedirectToAction("Login", "Account");

            var sessionService = new SessionService();
            var session = await sessionService.GetAsync(session_id);

            if (session.PaymentStatus == "paid" || session.Status == "complete")
            {
                var sub = await _subContext.TenantSubscriptions.FirstOrDefaultAsync(s => s.GoogleEmail == email);
                if (sub == null)
                {
                    sub = new TenantSubscription
                    {
                        GoogleEmail = email,
                        TargetAspUrl = _config["DEFAULT_ASP_URL"] ?? "http://example.com/main/",
                        IsActive = true,
                        StripeCustomerId = session.CustomerId,
                        StripeSubscriptionId = session.SubscriptionId,
                        PaidAt = DateTime.UtcNow,
                        CreatedAt = DateTime.UtcNow
                    };
                    _subContext.TenantSubscriptions.Add(sub);
                }
                else
                {
                    sub.IsActive = true;
                    sub.StripeCustomerId = session.CustomerId;
                    sub.StripeSubscriptionId = session.SubscriptionId;
                    sub.PaidAt = DateTime.UtcNow;
                }

                await _subContext.SaveChangesAsync();
                return Redirect("/");
            }

            return RedirectToAction("Checkout");
        }

        [HttpGet("/Subscription/Cancel")]
        public IActionResult Cancel()
        {
            return View();
        }
    }
}