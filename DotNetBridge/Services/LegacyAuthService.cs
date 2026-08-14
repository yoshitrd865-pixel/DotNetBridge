using System.Net;
using Microsoft.AspNetCore.DataProtection;
using DotNetBridge.Data;

namespace DotNetBridge.Services
{
    public class LegacyAuthService
    {
        private readonly AccountDbContext _accountDb;
        private readonly IDataProtector _protector;

        // EcoMaster のログイン処理 URL
        private const string LoginUrl = "https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/login.asp";

        public LegacyAuthService(
            AccountDbContext accountDb, 
            IDataProtectionProvider provider)
        {
            _accountDb = accountDb;
            _protector = provider.CreateProtector("DotNetBridge.LegacyCredentials");
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

            // 3. CookieContainer を準備 (リダイレクト追従でセッションCookieを確実に確定させる)
            var cookieContainer = new CookieContainer();
            using var handler = new HttpClientHandler
            {
                CookieContainer = cookieContainer,
                AllowAutoRedirect = true // ★ リダイレクトを許可して Cookie を確実に確立させる
            };
            using var client = new HttpClient(handler);

            var content = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("txtUserID", credential.LegacyUserId),
                new KeyValuePair<string, string>("txtPassword", rawPassword)
            });

            try
            {
                var response = await client.PostAsync(LoginUrl, content);

                // 4. ログイン完了後に発行されたすべての Cookie を一括取得
                var baseUri = new Uri("https://hhc-eco11.com");
                var loginUri = new Uri(LoginUrl);

                var cookies = cookieContainer.GetCookies(baseUri).Cast<Cookie>()
                    .Concat(cookieContainer.GetCookies(loginUri).Cast<Cookie>())
                    .GroupBy(c => c.Name)
                    .Select(g => g.First())
                    .ToList();

                if (cookies.Count == 0) return null;

                // Cookie ヘッダー文字列 (PersonCode=1; SessionMobile=... 等) を生成
                return string.Join("; ", cookies.Select(c => $"{c.Name}={c.Value}"));
            }
            catch
            {
                return null;
            }
        }
    }
}