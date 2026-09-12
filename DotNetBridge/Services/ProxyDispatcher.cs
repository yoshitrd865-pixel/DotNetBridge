// Services/ProxyDispatcher.cs
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Services
{
    /// <summary>
    /// リバースプロキシの振り分けおよび開発用認証バイパスを担当するディスパッチャー
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
            // ★ C# ローカルエンドポイントは false を返して Controller へ引き継ぐ
            // --------------------------------------------------
            if (path.StartsWith("/admin") || 
                path.StartsWith("/api") || 
                path.StartsWith("/account") || 
                path.StartsWith("/success") || 
                path.StartsWith("/cancel") || 
                path.StartsWith("/signin-google") ||
                path.Contains("stripepayment")) // ★ 追加: Stripe決済関連のURLはプロキシせずにC#で処理
            {
                return false; // プロキシしない
            }

            string targetBaseUrl = "https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/";
            string devEmail = "eco@tfkankyo.com";

            // 1. セッション情報の補完
            context.Session.SetString("TargetAspUrl", targetBaseUrl);
            context.Session.SetString("UserEmail", devEmail);

            // 2. 開発用認証クレームの動的擬装生成
            if (context.User.Identity?.IsAuthenticated != true)
            {
                var claims = new[]
                {
                    new Claim(ClaimTypes.Name, devEmail),
                    new Claim(ClaimTypes.Email, devEmail)
                };
                var identity = new ClaimsIdentity(claims, "DevBypassAuth");
                context.User = new ClaimsPrincipal(identity);
            }

            // 3. 転送先の判別と実行
            bool isEcoMaster = targetBaseUrl.Contains("mobile60", StringComparison.OrdinalIgnoreCase);

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