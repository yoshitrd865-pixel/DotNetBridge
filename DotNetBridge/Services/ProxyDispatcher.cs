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

            // 1. Googleログイン済みの場合はDBからURLを取得
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

            // 2. 未ログイン（シークレットモード等）の場合はデフォルトURLとダミーEmailをセット
            if (string.IsNullOrEmpty(targetBaseUrl))
            {
                targetBaseUrl = context.Session.GetString("TargetAspUrl") 
                                ?? "https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/";

                // ★ セッションへURLと開発用メールアドレスをセット（これで内部リダイレクトを防ぎます）
                context.Session.SetString("TargetAspUrl", targetBaseUrl);
                context.Session.SetString("UserEmail", "eco@tfkankyo.com");
            }

            // 3. プロキシ中継の実行
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