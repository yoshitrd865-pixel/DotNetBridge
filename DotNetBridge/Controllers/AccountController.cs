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

                if (tenant != null && !string.IsNullOrEmpty(tenant.TargetAspUrl))
                {
                    // URL階層を /Main/FrameMain.asp に固定してトップ画面へ引っこ抜く
                    return Content("<script>window.top.location.href='/Main/FrameMain.asp';</script>", "text/html");
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

            if (tenant == null || string.IsNullOrEmpty(tenant.TargetAspUrl))
            {
                ViewBag.Error = $"未登録のアカウントです ({email})。管理者に利用申請を行ってください。";
                return View("Login");
            }

            HttpContext.Session.SetString("TargetAspUrl", tenant.TargetAspUrl);
            HttpContext.Session.SetString("UserEmail", tenant.GoogleEmail);

            // 認証成功時も /Main/FrameMain.asp へ遷移
            return Content("<script>window.top.location.href='/Main/FrameMain.asp';</script>", "text/html");
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