// Shift_JIS（コードページ 932）を.NETで扱えるように登録します
System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

var builder = WebApplication.CreateBuilder(args);

// コントローラー機能の追加
builder.Services.AddControllers();

// セッションCookieを透過させるためのHttpClient設定
builder.Services.AddHttpClient("NoRedirectClient", client => { })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AllowAutoRedirect = false // ASP側の302リダイレクトをブラウザに任せ、Cookieを正常処理させる
    });

var app = builder.Build();

app.MapControllers();

app.Run();
