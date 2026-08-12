using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace DotNetBridge.Tests
{
    public class ProxyIntegrationTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly HttpClient _client;

        public ProxyIntegrationTests(WebApplicationFactory<Program> factory)
        {
            // 自動リダイレクトをオフにしたテスト用 Client
            _client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false
            });
        }

        [Fact]
        public async Task UnauthenticatedUser_RedirectsToLogin()
        {
            // 未ログインでアクセスした場合、ログイン画面へ 302 リダイレクトされるかテスト
            var response = await _client.GetAsync("/");

            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            Assert.Equal("/Account/Login", response.Headers.Location?.OriginalString);
        }

        [Fact]
        public async Task AccountLoginPath_IsAccessibleWithoutAuth()
        {
            // ログイン画面（/Account/Login）には未ログインでもアクセスできるかテスト
            var response = await _client.GetAsync("/Account/Login");

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }
}