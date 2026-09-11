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

        /**
         * コンストラクター: 各プロキシ実行サービスの依存性注入
         */
        public ProxyDispatcher(EcoMasterProxyService ecoMaster, EcoProProxyService ecoPro)
        {
            _ecoMaster = ecoMaster;
            _ecoPro = ecoPro;
        }

        /**
         * プロキシ転送の判定および実行メイン処理
         */
        public async Task DispatchAsync(HttpContext context)
        {
            // 判定用にリクエストパスを取得（小文字化）
            var path = context.Request.Path.Value?.ToLower() ?? "";

            // --------------------------------------------------
            // ★【バイパスガード】C# 側のローカルエンドポイントの保護
            // 管理画面 (/admin)、API (/api)、アカウント (/account)、決済完了画面 (/success, /cancel) など
            // ASP.NET Core 側で処理すべき URL が本家 IIS へ誤転送（素通り）されるのを阻止します
            // --------------------------------------------------
            if (path.StartsWith("/admin") || 
                path.StartsWith("/api") || 
                path.StartsWith("/account") || 
                path.StartsWith("/success") || 
                path.StartsWith("/cancel") || 
                path.StartsWith("/signin-google"))
            {
                return; // プロキシ処理を行わずに抜け、後続の ASP.NET Core ルーティングに委ねる
            }

            // 転送対象の本家 ASP ベース URL および開発用ユーザーメールアドレス
            string targetBaseUrl = "https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/";
            string devEmail = "eco@tfkankyo.com";

            // --------------------------------------------------
            // 1. セッション情報の補完
            // --------------------------------------------------
            // 後続のプロキシサービスが参照するターゲット URL とユーザーメールアドレスをセッションに格納
            context.Session.SetString("TargetAspUrl", targetBaseUrl);
            context.Session.SetString("UserEmail", devEmail);

            // --------------------------------------------------
            // 2. 開発環境用 認証クレームの動的擬装生成
            // --------------------------------------------------
            // 未ログイン状態であっても context.User に開発用 Identity クレームを差し込むことで
            // EcoMaster / EcoPro 内部のアクセス権限チェックを通過させます
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

            // --------------------------------------------------
            // 3. 転送先の判別とプロキシ実行
            // --------------------------------------------------
            // ターゲット URL に "mobile60" が含まれる場合は現場用 (EcoMaster)、それ以外は事務所用 (EcoPro) へ振り分け
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