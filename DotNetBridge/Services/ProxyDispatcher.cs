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
            // ガードレール遵守: ClaimTypes.Email からログインユーザーのメールアドレスを取得
            var userEmail = context.User.FindFirst(ClaimTypes.Email)?.Value 
                            ?? context.User.Identity?.Name;

            // 1. 未認証・アドレス取得不可の場合は画面外枠ごとログイン/停止案内へ脱出
            if (string.IsNullOrEmpty(userEmail))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>window.top.location.href = '/Account/Suspended';</script></body></html>");
                return;
            }

            var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
            var tenant = await db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

            // 2. 契約レコードが存在しない、または未課金 (IsActive == false) の場合
            if (tenant == null || !tenant.IsActive)
            {
                // AJAX通信等の場合は 402 Payment Required を返却
                if (context.Request.Headers["X-Requested-With"] == "XMLHttpRequest" || context.Request.Path.StartsWithSegments("/api"))
                {
                    context.Response.StatusCode = StatusCodes.Status402PaymentRequired;
                    return;
                }

                // frameset/iframe 内の画面破損を防ぐ window.top 脱出処理で Stripe 課金画面へ誘導
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>window.top.location.href = '/Subscription/Checkout';</script></body></html>");
                return;
            }

            // 3. 転送先URLが未設定の場合
            if (string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>window.top.location.href = '/Account/Suspended';</script></body></html>");
                return;
            }

            // 4. 契約有効時：TargetAspUrl (mobile60 の有無) に応じてプロキシサービスへ自動中継
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