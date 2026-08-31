using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Controllers
{
    [Route("admin")]
    public class AdminController : Controller
    {
        private readonly SubscriptionDbContext _db;

        public AdminController(SubscriptionDbContext db)
        {
            _db = db;
        }

        // 一覧表示 (/admin または /admin/index)
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