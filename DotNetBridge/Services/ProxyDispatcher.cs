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
            string targetBaseUrl = "https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/";
            string devEmail = "eco@tfkankyo.com";

            // 1. セッションの補完
            context.Session.SetString("TargetAspUrl", targetBaseUrl);
            context.Session.SetString("UserEmail", devEmail);

            // 2. ★ context.User (認証クレーム) を開発用メールアドレスで直接擬装
            // これにより EcoMaster / EcoPro 内部の認証チェックを完全に突破します
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
        }
    }
}