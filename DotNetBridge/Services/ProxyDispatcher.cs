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
            // Google OAuth や Cookie 認証から Email を柔軟に取得
            var userEmail = context.User.FindFirst(ClaimTypes.Email)?.Value 
                            ?? context.User.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")?.Value
                            ?? context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                            ?? context.User.Identity?.Name;

            // 未認証（メールアドレスが取得できない）時はログイン画面へ強制リダイレクト
            if (string.IsNullOrEmpty(userEmail))
            {
                context.Response.Redirect("/Account/Login");
                return;
            }

            var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
            var tenant = await db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

            // 未登録・転送先未設定時
            if (tenant == null || string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                context.Response.Redirect("/Account/Login");
                return;
            }

            // TargetAspUrl に mobile60 または EcoMaster が含まれていれば EcoMaster 側へルーティング
            var targetBaseUrl = tenant.TargetAspUrl;
            bool isEcoMaster = targetBaseUrl.Contains("mobile60", StringComparison.OrdinalIgnoreCase) ||
                               targetBaseUrl.Contains("EcoMaster", StringComparison.OrdinalIgnoreCase);

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