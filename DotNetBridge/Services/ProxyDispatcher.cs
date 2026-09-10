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

            string? targetBaseUrl = null;

            // 1. Googleログイン済みの場合はDBから契約情報を検索
            if (!string.IsNullOrEmpty(userEmail))
            {
                var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
                var tenant = await db.TenantSubscriptions
                    .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

                if (tenant != null && tenant.IsActive)
                {
                    targetBaseUrl = tenant.TargetAspUrl;
                }
            }

            // 2. 未ログイン（シークレットモード等）やDB未登録時は Session のデフォルトURLを使用
            if (string.IsNullOrEmpty(targetBaseUrl))
            {
                targetBaseUrl = context.Session.GetString("TargetAspUrl");
            }

            // 3. それでも転送先URLが取得できない場合のみ停止画面へ脱出
            if (string.IsNullOrEmpty(targetBaseUrl))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>window.top.location.href = '/Account/Suspended';</script></body></html>");
                return;
            }

            // 4. URL判定によるプロキシサービスへの転送（mobile60 の有無で分離）
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