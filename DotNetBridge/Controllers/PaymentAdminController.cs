using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Controllers
{
    public class PaymentAdminController : Controller
    {
        private readonly PaymentDbContext _dbContext;

        public PaymentAdminController(PaymentDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        // 管理画面: 入金消込データ一覧
        [HttpGet("/admin/payments")]
        public async Task<IActionResult> Index()
        {
            var logs = await _dbContext.PaymentLogs
                .OrderByDescending(p => p.PaidAt)
                .ToListAsync();

            return View(logs);
        }
    }
}