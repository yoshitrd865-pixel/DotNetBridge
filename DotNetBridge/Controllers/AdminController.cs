using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Controllers
{
    [Route("admin")]
    public class AdminController : Controller
    {
        private readonly SubscriptionDbContext _db;
        private readonly IConfiguration _config;

        public AdminController(SubscriptionDbContext db, IConfiguration config)
        {
            _db = db;
            _config = config;
        }

        public override void OnActionExecuting(ActionExecutingContext context)
        {
            var actionName = context.ActionDescriptor.RouteValues["action"]?.ToLower();
            
            if (actionName == "login" || actionName == "auth")
            {
                base.OnActionExecuting(context);
                return;
            }

            if (HttpContext.Session.GetString("IsAdminAuthenticated") != "true")
            {
                context.Result = new RedirectToActionResult("Login", "Admin", null);
                return;
            }

            base.OnActionExecuting(context);
        }

        [HttpGet("login")]
        public IActionResult Login() => View();

        [HttpPost("auth")]
        public IActionResult Auth(string password)
        {
            var adminPassword = _config["ADMIN_PASSWORD"] ?? "admin1234";

            if (password == adminPassword)
            {
                HttpContext.Session.SetString("IsAdminAuthenticated", "true");
                return RedirectToAction(nameof(Index));
            }

            TempData["Error"] = "パスワードが正しくありません。";
            return RedirectToAction(nameof(Login));
        }

        [HttpPost("logout")]
        public IActionResult Logout()
        {
            HttpContext.Session.Remove("IsAdminAuthenticated");
            return RedirectToAction(nameof(Login));
        }

        [HttpGet]
        [HttpGet("index")]
        public async Task<IActionResult> Index()
        {
            var tenants = await _db.TenantSubscriptions
                .OrderByDescending(t => t.CreatedAt)
                .ToListAsync();

            return View(tenants);
        }

        [HttpPost("save")]
        public async Task<IActionResult> Save(TenantSubscription model)
        {
            if (string.IsNullOrWhiteSpace(model.GoogleEmail) || string.IsNullOrWhiteSpace(model.TargetAspUrl))
            {
                TempData["Error"] = "メールアドレスと接続先URLは必須です。";
                return RedirectToAction(nameof(Index));
            }

            if (model.Id == 0)
            {
                model.CreatedAt = DateTime.UtcNow;
                _db.TenantSubscriptions.Add(model);
            }
            else
            {
                var tenant = await _db.TenantSubscriptions.FindAsync(model.Id);
                if (tenant != null)
                {
                    tenant.GoogleEmail = model.GoogleEmail;
                    tenant.TargetAspUrl = model.TargetAspUrl;
                }
            }

            await _db.SaveChangesAsync();
            TempData["Success"] = "保存しました。";
            return RedirectToAction(nameof(Index));
        }

        [HttpPost("delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var tenant = await _db.TenantSubscriptions.FindAsync(id);
            if (tenant != null)
            {
                _db.TenantSubscriptions.Remove(tenant);
                await _db.SaveChangesAsync();
            }
            return RedirectToAction(nameof(Index));
        }
    }
}