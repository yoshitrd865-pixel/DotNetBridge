using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Services
{
    public class ProxyDispatcher
    {
        private readonly EcoMasterProxyService _ecoMaster;
        private readonly EcoProProxyService _ecoPro;

        public ProxyDispatcher(EcoMasterProxyService ecoMaster, EcoProProxyService ecoPro)
        {
            _ecoMaster = ecoMaster;
            _ecoPro = ecoPro;
        }

        public async Task DispatchAsync(HttpContext context)
        {
            var userEmail = context.User.FindFirst(ClaimTypes.Email)?.Value 
                            ?? context.User.Identity?.Name;

            if (string.IsNullOrEmpty(userEmail))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>window.top.location.href = '/Account/Suspended';</script></body></html>");
                return;
            }

            var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
            var tenant = await db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

            if (tenant == null || !tenant.IsActive || string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>window.top.location.href = '/Account/Suspended';</script></body></html>");
                return;
            }

            var targetBaseUrl = tenant.TargetAspUrl;
            bool isEcoMaster = targetBaseUrl.Contains("mobile60", StringComparison.OrdinalIgnoreCase);

            if (isEcoMaster)
            {
                await _ecoMaster.ProcessProxyAsync(context);
            }
            else
            {
                await _ecoPro.ProcessProxyAsync(context);
            }
        }
    }
}