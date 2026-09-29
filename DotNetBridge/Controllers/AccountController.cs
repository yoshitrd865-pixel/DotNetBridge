using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;

namespace DotNetBridge.Controllers
{
    [AllowAnonymous]
    public class AccountController : Controller
    {
        private readonly SubscriptionDbContext _db;

        public AccountController(SubscriptionDbContext db)
        {
            _db = db;
        }

        // テナントの接続先に応じて適切な初期URLを返却
        private string GetDestinationUrl(string targetAspUrl)
        {
            bool isEcoMaster = targetAspUrl.Contains("mobile60", StringComparison.OrdinalIgnoreCase) ||
                               targetAspUrl.Contains("EcoMaster", StringComparison.OrdinalIgnoreCase);
            return isEcoMaster ? "/" : "/Main/FrameMain.asp";
        }

        [HttpGet]
        public async Task<IActionResult> Login()
        {
            if (User.Identity?.IsAuthenticated == true)
            {
                var email = User.FindFirst(ClaimTypes.Email)?.Value 
                            ?? User.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")?.Value;

                var tenant = await _db.TenantSubscriptions
                    .FirstOrDefaultAsync(t => t.GoogleEmail == email);

                if (tenant != null && !string.IsNullOrEmpty(tenant.TargetAspUrl))
                {
                    var dest = GetDestinationUrl(tenant.TargetAspUrl);
                    return Content($"<script>window.top.location.href='{dest}';</script>", "text/html");
                }

                await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                HttpContext.Session.Clear();
            }
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
            // Google OAuth認証情報の取得
            var result = await HttpContext.AuthenticateAsync(GoogleDefaults.AuthenticationScheme);
            
            if (!result.Succeeded || result.Principal == null)
            {
                ViewBag.Error = "Google認証に失敗しました。";
                return View("Login");
            }

            var email = result.Principal.FindFirst(ClaimTypes.Email)?.Value
                        ?? result.Principal.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")?.Value;

            if (string.IsNullOrEmpty(email))
            {
                ViewBag.Error = "Googleアカウントからメールアドレスを取得できませんでした。";
                return View("Login");
            }

            var tenant = await _db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == email);

            if (tenant == null || string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                ViewBag.Error = $"未登録のアカウントです ({email})。管理者に利用申請を行ってください。";
                return View("Login");
            }

            // ★ 修正：Cookie認証プロファイルを構築して明確にログイン(SignIn)を実行
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, email),
                new Claim(ClaimTypes.Email, email),
                new Claim(ClaimTypes.Name, email)
            };

            var claimsIdentity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
            var authProperties = new AuthenticationProperties
            {
                IsPersistent = true,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(8)
            };

            await HttpContext.SignInAsync(
                CookieAuthenticationDefaults.AuthenticationScheme,
                new ClaimsPrincipal(claimsIdentity),
                authProperties
            );

            // 認証成功時、テナントに応じたURLへ動的遷移
            var destinationUrl = GetDestinationUrl(tenant.TargetAspUrl);
            return Content($"<script>window.top.location.href='{destinationUrl}';</script>", "text/html");
        }

        [HttpGet]
        public async Task<IActionResult> Logout()
        {
            HttpContext.Session.Clear();
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Content("<script>window.top.location.href='/Account/Login';</script>", "text/html");
        }
    }
}