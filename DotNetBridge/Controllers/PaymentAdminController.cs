// Controllers/PaymentAdminController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridgeApp.Controllers
{
    [Route("admin/payments")]
    public class PaymentAdminController : Controller
    {
        private readonly PaymentDbContext _dbContext;

        public PaymentAdminController(PaymentDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        [HttpGet]
        public async Task<IActionResult> Index()
        {
            // 最新発行順（ID降順）で一覧を取得
            var logs = await _dbContext.PaymentLogs
                .OrderByDescending(p => p.Id)
                .ToListAsync();

            return View("~/Views/PaymentAdmin/Index.cshtml", logs);
        }
    }
}