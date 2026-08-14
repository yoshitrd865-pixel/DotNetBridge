using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection; // ★追加
using DotNetBridge.Data; // ★追加

namespace DotNetBridge.Controllers
{
    [AllowAnonymous]
    public class AccountController : Controller
    {
        private readonly AccountDbContext _accountDb; // ★追加
        private readonly IDataProtector _protector;    // ★追加

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

        // ★ 変更: Google認証レスポンス処理で紐付けチェックを入れる
        [HttpGet]
        public async Task<IActionResult> GoogleResponse()
        {
            var result = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            
            if (!result.Succeeded)
            {
                return RedirectToAction("Login");
            }

            // Googleから取得したメールアドレスを取得
            var googleEmail = User.FindFirstValue(ClaimTypes.Email);

            if (string.IsNullOrEmpty(googleEmail))
            {
                // メールアドレスが取れなかった場合はエラー扱い
                await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                ViewBag.Error = "Googleアカウントからメールアドレスを取得できませんでした。";
                return View("Login");
            }

            // account.db に連携データが存在するか確認
            var credential = await _accountDb.UserLegacyCredentials.FindAsync(googleEmail);

            if (credential == null)
            {
                // 未連携なら紐付け入力画面へ
                return RedirectToAction("LinkAccount");
            }

            // 連携済みならトップページへ
            return Redirect("/");
        }

        // ★ 追加: アカウント紐付け画面（GET）
        [Authorize] // Googleログイン完了済みのユーザーのみアクセス可
        [HttpGet]
        public IActionResult LinkAccount()
        {
            return View();
        }

        // ★ 追加: アカウント紐付け処理（POST）
        [Authorize]
        [HttpPost]
        public async Task<IActionResult> LinkAccount(string legacyUserId, string legacyPassword)
        {
            var googleEmail = User.FindFirstValue(ClaimTypes.Email);

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
    }
}