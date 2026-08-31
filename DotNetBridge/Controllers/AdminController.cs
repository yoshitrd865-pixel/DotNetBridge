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

        // 管理者認証チェック（未認証時はログイン画面へ）
        public override void OnActionExecuting(ActionExecutingContext context)
        {
            var actionName = context.ActionDescriptor.RouteValues["action"]?.ToLower();
            
            // ログイン画面・認証処理自体はチェック対象外
            if (actionName == "login" || actionName == "auth")
            {
                base.OnActionExecuting(context);
                return;
            }

            // セッションに認証フラグがない場合は /admin/login へ強制リダイレクト
            if (HttpContext.Session.GetString("IsAdminAuthenticated") != "true")
            {
                context.Result = new RedirectToActionResult("Login", "Admin", null);
                return;
            }

            base.OnActionExecuting(context);
        }

        // 管理者ログイン画面 (/admin/login)
        [HttpGet("login")]
        public IActionResult Login()
        {
            return View();
        }

        // 認証処理 (/admin/auth)
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

        // ログアウト (/admin/logout)
        [HttpPost("logout")]
        public IActionResult Logout()
        {
            HttpContext.Session.Remove("IsAdminAuthenticated");
            return RedirectToAction(nameof(Login));
        }

        // 一覧表示 (/admin)
        [HttpGet("")]
        [HttpGet("index")]
        public async Task<IActionResult> Index()
        {
            var tenants = await _db.TenantSubscriptions
                .OrderByDescending(t => t.CreatedAt)
                .ToListAsync();
            return View(tenants);
        }

        // 新規登録・既存編集 (/admin/save)
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
                    tenant.IsActive = model.IsActive;
                }
            }

            await _db.SaveChangesAsync();
            TempData["Success"] = "保存しました。";
            return RedirectToAction(nameof(Index));
        }

        // アカウントの停止 / 有効化 切り替え (/admin/toggleactive)
        [HttpPost("toggleactive")]
        public async Task<IActionResult> ToggleActive(int id)
        {
            var tenant = await _db.TenantSubscriptions.FindAsync(id);
            if (tenant != null)
            {
                tenant.IsActive = !tenant.IsActive;
                await _db.SaveChangesAsync();
            }
            return RedirectToAction(nameof(Index));
        }

        // アカウント削除 (/admin/delete)
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