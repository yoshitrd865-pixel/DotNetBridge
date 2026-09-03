namespace DotNetBridge.Services
{
    public class EcoProProxyService
    {
        public EcoProProxyService(IHttpClientFactory httpClientFactory) { }

        public async Task ProcessProxyAsync(HttpContext context)
        {
            context.Response.ContentType = "text/plain; charset=utf-8";
            await context.Response.WriteAsync("【検証成功】EcoProプロキシに正しくルーティングされました！");
        }
    }
}