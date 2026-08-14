using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google; // ★ Google認証用に追加

namespace DotNetBridge.Controllers
{
    [AllowAnonymous]
    public class AccountController : Controller
    {
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

        // ★ 1. 「Googleでログイン」ボタンが押された時の処理
        [HttpGet]
        public IActionResult GoogleLogin()
        {
            var properties = new AuthenticationProperties
            {
                // 認証成功後に戻ってくるアクション（GoogleResponse）を指定
                RedirectUri = Url.Action("GoogleResponse")
            };
            // Googleのログイン画面へリダイレクト（チャレンジ）
            return Challenge(properties, GoogleDefaults.AuthenticationScheme);
        }

        // ★ 2. Google側の認証完了後に戻ってくる場所
        [HttpGet]
        public async Task<IActionResult> GoogleResponse()
        {
            // Cookie認証の結果を取得して成功したか確認
            var result = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            
            if (!result.Succeeded)
            {
                // 認証失敗した場合は再度ログイン画面へ
                return RedirectToAction("Login");
            }

            // 成功したらトップページ（プロキシ画面等）へ転送
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