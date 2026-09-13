// Services/ProxyDispatcher.cs
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Services
{
    /// <summary>
    /// リバースプロキシの振り分けおよびGoogleログインユーザー認証を担当するディスパッチャー
    /// </summary>
    public class ProxyDispatcher
    {
        private readonly EcoMasterProxyService _ecoMaster;
        private readonly EcoProProxyService _ecoPro;

        public ProxyDispatcher(EcoMasterProxyService ecoMaster, EcoProProxyService ecoPro)
        {
            _ecoMaster = ecoMaster;
            _ecoPro = ecoPro;
        }

        /// <summary>
        /// プロキシ転送の判定および実行処理
        /// </summary>
        /// <returns>プロキシを実行した場合は true、C# ローカル処理へ流す場合は false</returns>
        public async Task<bool> DispatchAsync(HttpContext context)
        {
            var path = context.Request.Path.Value?.ToLower() ?? "";

            // --------------------------------------------------
            // 1. C# ローカルエンドポイントは false を返して Controller へ引き継ぐ
            // --------------------------------------------------
            if (path.StartsWith("/admin") || 
                path.StartsWith("/api") || 
                path.StartsWith("/account") || 
                path.StartsWith("/success") || 
                path.StartsWith("/cancel") || 
                path.StartsWith("/signin-google") ||
                path.Contains("stripepayment"))
            {
                return false; // プロキシ処理をせずローカルルーティングへ
            }

            // --------------------------------------------------
            // 2. Googleログイン情報（Claim）からメールアドレスを取得
            // --------------------------------------------------
            var userEmail = context.User.FindFirst(ClaimTypes.Email)?.Value
                            ?? context.User.Identity?.Name;

            // 未認証（Google未ログイン）の場合はログイン画面へ誘導
            if (string.IsNullOrEmpty(userEmail) || context.User.Identity?.IsAuthenticated != true)
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>window.top.location.href = '/Account/Login';</script></body></html>");
                return true;
            }

            // --------------------------------------------------
            // 3. DBからログインユーザーのテナント契約情報を取得
            // --------------------------------------------------
            var db = context.RequestServices.GetRequiredService<SubscriptionDbContext>();
            var tenant = await db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == userEmail);

            if (tenant == null || !tenant.IsActive || string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<html><body><script>alert('有効なサブスクリプション契約が見つかりません'); window.top.location.href = '/Account/Login';</script></body></html>");
                return true;
            }

            // セッション情報の更新
            context.Session.SetString("UserEmail", userEmail);
            context.Session.SetString("TargetAspUrl", tenant.TargetAspUrl);

            // --------------------------------------------------
            // 4. アクセスパスに応じた EcoMaster / EcoPro の自動振り分け
            // --------------------------------------------------
            bool isEcoMaster = path.Contains("mobile60");

            if (isEcoMaster)
            {
                await _ecoMaster.ProcessProxyAsync(context);
            }
            else
            {
                await _ecoPro.ProcessProxyAsync(context);
            }

            return true; // プロキシ実行完了
        }
    }
}