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

            // 3. CookieContainer を準備して POST 送信
            var cookieContainer = new CookieContainer();
            using var handler = new HttpClientHandler
            {
                CookieContainer = cookieContainer,
                AllowAutoRedirect = false // リダイレクトさせずに 302 レスポンス時の Set-Cookie を直接奪取する
            };
            using var client = new HttpClient(handler);

            // スクショで確認した正確なパラメータ (txtUserID, txtPassword)
            var content = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("txtUserID", credential.LegacyUserId),
                new KeyValuePair<string, string>("txtPassword", rawPassword)
            });

            try
            {
                var response = await client.PostAsync(LoginUrl, content);

                // 4. レスポンスヘッダーから Set-Cookie を直接すべて抽出（PersonCode, SessionMobile等）
                if (response.Headers.TryGetValues("Set-Cookie", out var rawSetCookies))
                {
                    var cookiePairs = new List<string>();
                    foreach (var setCookie in rawSetCookies)
                    {
                        // "SessionMobile=z1I12mT; Path=/; ..." から "SessionMobile=z1I12mT" だけを取り出す
                        var mainPart = setCookie.Split(';')[0].Trim();
                        if (!string.IsNullOrEmpty(mainPart))
                        {
                            cookiePairs.Add(mainPart);
                        }
                    }

                    if (cookiePairs.Count > 0)
                    {
                        // "PersonCode=1; SessionMobile=z1I12mT; PersonHistoryCode=1" の形式に組み立て
                        return string.Join("; ", cookiePairs);
                    }
                }

                // ヘッダー直接取得で万が一漏れた場合、CookieContainer からも補完
                var uri = new Uri(LoginUrl);
                var cookies = cookieContainer.GetCookies(uri);
                if (cookies.Count > 0)
                {
                    return string.Join("; ", cookies.Cast<Cookie>().Select(c => $"{c.Name}={c.Value}"));
                }

                return null;
            }
            catch
            {
                return null;
            }
        }
    }
}