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

        // ログイン画面表示
        [HttpGet]
        public IActionResult Login()
        {
            if (User.Identity?.IsAuthenticated == true)
            {
                return Redirect("/");
            }
            return View();
        }

        // 1. 「Googleでログイン」ボタンが押された時の処理
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

        // 2. Google側の認証完了後に戻ってくる場所（DB照合・URL割り当て）
        [HttpGet]
        public async Task<IActionResult> GoogleResponse()
        {
            var result = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            
            if (!result.Succeeded)
            {
                ViewBag.Error = "Google認証に失敗しました。";
                return View("Login");
            }

            // Googleアカウントからメールアドレスを取得
            var email = result.Principal?.FindFirst(ClaimTypes.Email)?.Value;

            if (string.IsNullOrEmpty(email))
            {
                ViewBag.Error = "Googleアカウントからメールアドレスを取得できませんでした。";
                return View("Login");
            }

            // DBから該当メールアドレスのアカウント＆契約情報を検索
            var tenant = await _db.TenantSubscriptions
                .FirstOrDefaultAsync(t => t.GoogleEmail == email);

            // ① 未登録ユーザーの弾き
            if (tenant == null)
            {
                ViewBag.Error = $"未登録のアカウントです ({email})。HHCアカウントの契約手続きを行ってください。";
                return View("Login");
            }

            // ② サブスク未払い・停止中の弾き
            if (!tenant.IsActive)
            {
                ViewBag.Error = "サブスクリプション契約が無効または支払いが未完了です。";
                return View("Login");
            }

            // ③ 認証＆契約OK：会社専用のASP URLとメールアドレスをセッションに保持
            HttpContext.Session.SetString("TargetAspUrl", tenant.TargetAspUrl);
            HttpContext.Session.SetString("UserEmail", tenant.GoogleEmail);

            return Redirect("/");
        }

        [HttpGet]
        public async Task<IActionResult> Logout()
        {
            HttpContext.Session.Clear(); // セッション情報をクリア
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return RedirectToAction("Login");
        }
    }
}