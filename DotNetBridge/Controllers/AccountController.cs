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
[HttpGet("Account/Suspended")]
public async Task<IActionResult> Suspended()
{
    // セッションと認証クッキーを完全に消去
    await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    HttpContext.Session.Clear();

    string html = @"
    <!DOCTYPE html>
    <html lang='ja'>
    <head>
        <meta charset='UTF-8'>
        <meta name='viewport' content='width=device-width, initial-scale=1.0'>
        <title>アカウント停止中 - ECOPRO</title>
        <link href='https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css' rel='stylesheet'>
    </head>
    <body class='bg-light d-flex align-items-center justify-content-center vh-100'>
        <div class='card shadow p-4 text-center' style='max-width: 440px; border-radius: 12px;'>
            <div class='mb-3 text-danger'>
                <svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' fill='currentColor' class='bi bi-slash-circle' viewBox='0 0 16 16'>
                    <path d='M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z'/>
                    <path d='M11.354 4.646a.5.5 0 0 0-.708 0l-6 6a.5.5 0 0 0 .708.708l6-6a.5.5 0 0 0 0-.708z'/>
                </svg>
            </div>
            <h4 class='fw-bold mb-2'>アカウントが停止されています</h4>
            <p class='text-muted small mb-4'>現在このアカウントでのシステム利用は停止されています。<br>ご利用を再開する場合は管理者にお問い合わせください。</p>
            <a href='/Account/Login' class='btn btn-primary w-100 py-2 fw-bold'>別のアカウントでログイン</a>
        </div>
    </body>
    </html>";

    return Content(html, "text/html", System.Text.Encoding.UTF8);
}
    }
}