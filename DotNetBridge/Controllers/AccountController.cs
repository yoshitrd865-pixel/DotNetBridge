using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using DotNetBridge.Data;

namespace DotNetBridge.Controllers
{
    [AllowAnonymous]
    public class AccountController : Controller
    {
        private readonly AccountDbContext _accountDb;
        private readonly IDataProtector _protector;

        // DIコンストラクタ
        public AccountController(AccountDbContext accountDb, IDataProtectionProvider provider)
        {
            _accountDb = accountDb;
            // 復号可能な暗号化プロテクター（用途識別子を指定）
            _protector = provider.CreateProtector("DotNetBridge.LegacyCredentials");
        }

        [HttpGet]
        public IActionResult Login()
        {
            if (User.Identity?.IsAuthenticated == true)
            {
                return Redirect("/");
            }
            return View();
        }

        [HttpPost]
        public async Task<IActionResult> Login(string username, string password)
        {
            if (username == "admin" && password == "password123")
            {
                var claims = new List<Claim>
                {
                    new Claim(ClaimTypes.Name, username),
                    new Claim(ClaimTypes.Role, "User")
                };

                var claimsIdentity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);

                await HttpContext.SignInAsync(
                    CookieAuthenticationDefaults.AuthenticationScheme, 
                    new ClaimsPrincipal(claimsIdentity));

                return Redirect("/");
            }

            ViewBag.Error = "ユーザー名またはパスワードが違います。";
            return View();
        }

        [HttpGet]
        public IActionResult GoogleLogin()
        {
            var properties = new AuthenticationProperties
            {
                RedirectUri = Url.Action("GoogleResponse")
            };
            properties.Items["prompt"] = "select_account";

            return Challenge(properties, GoogleDefaults.AuthenticationScheme);
        }

        // ★ 修正: Emailの取得精度を上げ、紐付けチェックを確実に実行する
        [HttpGet]
        public async Task<IActionResult> GoogleResponse()
        {
            var result = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            
            if (!result.Succeeded)
            {
                return RedirectToAction("Login");
            }

            // Googleから取得したメールアドレスを取得（複数パターンで確実にチェック）
            var googleEmail = GetUserEmail(result.Principal ?? User);

            if (string.IsNullOrEmpty(googleEmail))
            {
                // メールアドレスが取れなかった場合はエラーを表示してログインへ
                await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                ViewBag.Error = "Googleアカウントからメールアドレスを取得できませんでした。";
                return View("Login");
            }

            // account.db に連携データが存在するか確認
            var credential = await _accountDb.UserLegacyCredentials.FindAsync(googleEmail);

            if (credential == null)
            {
                // 未連携なら紐付け入力画面へ転送
                return RedirectToAction("LinkAccount");
            }

            // 連携済みならトップページへ
            return Redirect("/");
        }

        // ★ アカウント紐付け画面（GET）
        [Authorize]
        [HttpGet]
        public async Task<IActionResult> LinkAccount()
        {
            var googleEmail = GetUserEmail(User);

            // すでに連携済みの場合はトップ画面へ
            if (!string.IsNullOrEmpty(googleEmail))
            {
                var credential = await _accountDb.UserLegacyCredentials.FindAsync(googleEmail);
                if (credential != null)
                {
                    return Redirect("/");
                }
            }

            return View();
        }

        // ★ アカウント紐付け処理（POST）
        [Authorize]
        [HttpPost]
        public async Task<IActionResult> LinkAccount(string legacyUserId, string legacyPassword)
        {
            var googleEmail = GetUserEmail(User);

            if (string.IsNullOrEmpty(googleEmail))
            {
                return RedirectToAction("Login");
            }

            if (string.IsNullOrWhiteSpace(legacyUserId) || string.IsNullOrWhiteSpace(legacyPassword))
            {
                ViewBag.Error = "IDとパスワードの両方を入力してください。";
                return View();
            }

            // パスワードを可逆暗号化
            var encryptedPassword = _protector.Protect(legacyPassword);

            var credential = new UserLegacyCredential
            {
                GoogleEmail = googleEmail,
                LegacyUserId = legacyUserId,
                EncryptedLegacyPassword = encryptedPassword,
                UpdatedAt = DateTime.UtcNow
            };

            _accountDb.UserLegacyCredentials.Add(credential);
            await _accountDb.SaveChangesAsync();

            // 登録完了後トップへ
            return Redirect("/");
        }

        [HttpGet]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return RedirectToAction("Login");
        }

        // 💡 共通ヘルパー: Claimからメールアドレスを強力に探して取得する
        private string? GetUserEmail(ClaimsPrincipal? principal)
        {
            if (principal == null) return null;

            return principal.FindFirstValue(ClaimTypes.Email)
                ?? principal.FindFirstValue("email")
                ?? principal.Claims.FirstOrDefault(c => c.Type.EndsWith("emailaddress", StringComparison.OrdinalIgnoreCase))?.Value;
        }
    }
}