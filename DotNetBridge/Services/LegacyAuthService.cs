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

        // EcoMaster のログインURL (相対パスから絶対URLに組み立て)
        private const string LoginUrl = "https://hhc-eco11.com/EcoToubuF3/mobile60_ToubuF/login.asp";

        public LegacyAuthService(
            AccountDbContext accountDb, 
            IDataProtectionProvider provider,
            IHttpClientFactory httpClientFactory)
        {
            _accountDb = accountDb;
            _protector = provider.CreateProtector("DotNetBridge.LegacyCredentials");
            _httpClientFactory = httpClientFactory;
        }

        /// <summary>
        /// GoogleのEmailに対応するレガシー認証情報を取得し、EcoMasterへ代理ログインして Cookie ヘッダー文字列を返します。
        /// </summary>
        public async Task<string?> GetLegacySessionCookieAsync(string googleEmail)
        {
            // 1. account.db から暗号化されたログイン情報を取得
            var credential = await _accountDb.UserLegacyCredentials.FindAsync(googleEmail);
            if (credential == null)
            {
                return null; // 紐付け情報なし
            }

            // 2. パスワードを復号
            string rawPassword;
            try
            {
                rawPassword = _protector.Unprotect(credential.EncryptedLegacyPassword);
            }
            catch
            {
                // 暗号化キーの不一致等で復号失敗した場合
                return null;
            }

            // 3. HttpClient で CookieContainer を準備して POST 送信
            var cookieContainer = new CookieContainer();
            using var handler = new HttpClientHandler
            {
                CookieContainer = cookieContainer,
                AllowAutoRedirect = false // リダイレクト追従させずレスポンスCookieを取得
            };
            using var client = new HttpClient(handler);

            // スクショから特定したパラメータ名 (txtUserID, txtPassword)
            var content = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("txtUserID", credential.LegacyUserId),
                new KeyValuePair<string, string>("txtPassword", rawPassword)
            });

            try
            {
                var response = await client.PostAsync(LoginUrl, content);

                // 4. 発行された Cookie をヘッダー用文字列 (例: ASPSESSIONID...=xxx; path=/) に整形
                Uri uri = new Uri(LoginUrl);
                var cookies = cookieContainer.GetCookies(uri);
                if (cookies.Count == 0)
                {
                    return null;
                }

                var cookieHeader = string.Join("; ", cookies.Cast<Cookie>().Select(c => $"{c.Name}={c.Value}"));
                return cookieHeader;
            }
            catch
            {
                return null;
            }
        }
    }
}