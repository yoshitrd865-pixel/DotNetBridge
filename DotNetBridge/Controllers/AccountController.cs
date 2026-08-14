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
            // 復号可能な暗号化プロテクター
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

        [HttpGet]
        public async Task<IActionResult> GoogleResponse()
        {
            var result = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            
            if (!result.Succeeded)
            {
                return RedirectToAction("Login");
            }

            var googleEmail = GetUserEmail(result.Principal ?? User);

            if (string.IsNullOrEmpty(googleEmail))
            {
                await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                ViewBag.Error = "Googleアカウントからメールアドレスを取得できませんでした。";
                return View("Login");
            }

            var credential = await _accountDb.UserLegacyCredentials.FindAsync(googleEmail);

            if (credential == null)
            {
                return RedirectToAction("LinkAccount");
            }

            return Redirect("/");
        }

        // ★ アカウント紐付け・再設定画面（GET）
        [Authorize]
        [HttpGet]
        public async Task<IActionResult> LinkAccount()
        {
            var googleEmail = GetUserEmail(User);

            if (!string.IsNullOrEmpty(googleEmail))
            {
                var credential = await _accountDb.UserLegacyCredentials.FindAsync(googleEmail);
                if (credential != null)
                {
                    // 登録済みの場合は現在のIDを画面に渡し、再設定モードとして表示できるようにする
                    ViewBag.CurrentLegacyUserId = credential.LegacyUserId;
                    ViewBag.IsUpdate = true;
                }
            }

            return View();
        }

        // ★ アカウント紐付け・再設定処理（POST）
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

            var existingCredential = await _accountDb.UserLegacyCredentials.FindAsync(googleEmail);

            if (existingCredential != null)
            {
                // ★ 既存データがある場合は上書き更新（再設定）
                existingCredential.LegacyUserId = legacyUserId;
                existingCredential.EncryptedLegacyPassword = encryptedPassword;
                existingCredential.UpdatedAt = DateTime.UtcNow;

                _accountDb.UserLegacyCredentials.Update(existingCredential);
            }
            else
            {
                // ★ 初回は新規追加
                var credential = new UserLegacyCredential
                {
                    GoogleEmail = googleEmail,
                    LegacyUserId = legacyUserId,
                    EncryptedLegacyPassword = encryptedPassword,
                    UpdatedAt = DateTime.UtcNow
                };

                _accountDb.UserLegacyCredentials.Add(credential);
            }

            await _accountDb.SaveChangesAsync();

            // 保存完了後はトップへ
            return Redirect("/");
        }

        [HttpGet]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return RedirectToAction("Login");
        }

        private string? GetUserEmail(ClaimsPrincipal? principal)
        {
            if (principal == null) return null;

            return principal.FindFirstValue(ClaimTypes.Email)
                ?? principal.FindFirstValue("email")
                ?? principal.Claims.FirstOrDefault(c => c.Type.EndsWith("emailaddress", StringComparison.OrdinalIgnoreCase))?.Value;
        }
    }
}