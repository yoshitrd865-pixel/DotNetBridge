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
            // 1. ログイン中のGoogleメールアドレスを取得
            //var userEmail = context.User.FindFirst(ClaimTypes.Email)?.Value 
            //                ?? context.User.Identity?.Name;
            // 1. 一時テスト用：メールアドレスを直接固定（ログイン省略）
            var userEmail = "yoshi.trd865@gmail.com";
            

            if (string.IsNullOrEmpty(userEmail))
            {
                context.Response.Redirect("/Account/Login");
                return;
            }

            // 2. 元コードと同じ SubscriptionDbContext から契約状態を取得
            var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
            var tenant = await db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

            if (tenant == null || !tenant.IsActive || string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                context.Response.Redirect("/Account/Login");
                return;
            }

            var targetBaseUrl = tenant.TargetAspUrl;
            var path = context.Request.Path.Value ?? string.Empty;

            // 3. TargetAspUrl または リクエストパスに "mobile60" が含まれているかで判定
            bool isEcoMaster = targetBaseUrl.Contains("mobile60", StringComparison.OrdinalIgnoreCase) ||
                               path.Contains("mobile60", StringComparison.OrdinalIgnoreCase);

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