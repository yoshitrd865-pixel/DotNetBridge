using System.Net;
using Microsoft.AspNetCore.DataProtection;
using DotNetBridge.Data;

namespace DotNetBridge.Services
{
    public class LegacyAuthService
    {
        private readonly AccountDbContext _accountDb;
        private readonly IDataProtector _protector;
        private readonly IHttpClientFactory _httpClientFactory;

        // EcoMaster のログイン処理 URL
        private const string LoginUrl = "https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/login.asp";
        private const string BaseDomainUri = "https://hhc-eco11.com";

        public LegacyAuthService(
            AccountDbContext accountDb, 
            IDataProtectionProvider provider,
            IHttpClientFactory httpClientFactory)
        {
            _accountDb = accountDb;
            _protector = provider.CreateProtector("DotNetBridge.LegacyCredentials");
            _httpClientFactory = httpClientFactory;
        }

        public async Task<string?> GetLegacySessionCookieAsync(string googleEmail)
        {
            // 1. account.db から暗号化されたログイン情報を取得
            var credential = await _accountDb.UserLegacyCredentials.FindAsync(googleEmail);
            if (credential == null) return null;

            // 2. パスワードを復号
            string rawPassword;
            try
            {
                rawPassword = _protector.Unprotect(credential.EncryptedLegacyPassword);
            }
            catch
            {
                return null;
            }

            // 3. CookieContainer を準備して POST 送信
            var cookieContainer = new CookieContainer();
            using var handler = new HttpClientHandler
            {
                CookieContainer = cookieContainer,
                AllowAutoRedirect = true // ★ リダイレクト追従を許可してセッションCookieを確実に確定させる
            };
            using var client = new HttpClient(handler);

            // POSTフォームデータ (ボタン押下パラメータも追加)
            var content = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("txtUserID", credential.LegacyUserId),
                new KeyValuePair<string, string>("txtPassword", rawPassword),
                new KeyValuePair<string, string>("btnLogin", "ログイン") // ★ 追加
            });

            try
            {
                var response = await client.PostAsync(LoginUrl, content);

                // 4. 発行された Cookie をドメイン全体から取得
                var baseUri = new Uri(BaseDomainUri);
                var loginUri = new Uri(LoginUrl);

                var cookies = cookieContainer.GetCookies(baseUri);
                var loginCookies = cookieContainer.GetCookies(loginUri);

                // 両方のCookieをマージ
                var allCookies = cookies.Cast<Cookie>()
                    .Concat(loginCookies.Cast<Cookie>())
                    .GroupBy(c => c.Name)
                    .Select(g => g.First())
                    .ToList();

                if (allCookies.Count == 0) return null;

                // Cookieヘッダー文字列を生成
                var cookieHeader = string.Join("; ", allCookies.Select(c => $"{c.Name}={c.Value}"));
                return cookieHeader;
            }
            catch
            {
                return null;
            }
        }
    }
}