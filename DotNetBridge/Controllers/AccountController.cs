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

        [HttpGet]
        public async Task<IActionResult> Login()
        {
            if (User.Identity?.IsAuthenticated == true)
            {
                var email = User.FindFirst(ClaimTypes.Email)?.Value;
                var tenant = await _db.TenantSubscriptions
                    .FirstOrDefaultAsync(t => t.GoogleEmail == email);

                // 有効な契約の場合は iframe 脱出スクリプトでトップ画面へ引っこ抜く
                if (tenant != null && tenant.IsActive)
                {
                    return Content("<script>window.top.location.href='/';</script>", "text/html");
                }

                // 未登録または無効アカウントの場合は認証情報を破棄して再ログインへ
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
            var result = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            
            if (!result.Succeeded)
            {
                ViewBag.Error = "Google認証に失敗しました。";
                return View("Login");
            }

            var email = result.Principal?.FindFirst(ClaimTypes.Email)?.Value;

            if (string.IsNullOrEmpty(email))
            {
                ViewBag.Error = "Googleアカウントからメールアドレスを取得できませんでした。";
                return View("Login");
            }

            var tenant = await _db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == email);

            if (tenant == null)
            {
                ViewBag.Error = $"未登録のアカウントです ({email})。HHCアカウントの契約手続きを行ってください。";
                return View("Login");
            }

            if (!tenant.IsActive)
            {
                ViewBag.Error = "サブスクリプション契約が無効または支払いが未完了です。";
                return View("Login");
            }

            HttpContext.Session.SetString("TargetAspUrl", tenant.TargetAspUrl);
            HttpContext.Session.SetString("UserEmail", tenant.GoogleEmail);

            // OAuthログイン完了時も window.top で画面枠を強制更新
            return Content("<script>window.top.location.href='/';</script>", "text/html");
        }

        [HttpGet]
        public async Task<IActionResult> Logout()
        {
            HttpContext.Session.Clear();
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Content("<script>window.top.location.href='/Account/Login';</script>", "text/html");
        }

        // アカウント停止案内画面 (無限リダイレクト防止)
        [HttpGet("Account/Suspended")]
        public IActionResult Suspended()
        {
            return Content("【開発用】アカウント停止判定を検知しました。ProxyDispatcherの設定を確認してください。", "text/plain", System.Text.Encoding.UTF8);
        }
    }
}