using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;
using PuppeteerSharp;

namespace DotNetBridgeApp.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PdfArchiveController : ControllerBase
    {
        private readonly IConfiguration _config;

        public PdfArchiveController(IConfiguration config)
        {
            _config = config;
        }

        public class HtmlUploadRequest
        {
            public string Html { get; set; } = string.Empty;
            public string InvoiceNo { get; set; } = string.Empty;
            public string CustomerCode { get; set; } = string.Empty;
        }

        [HttpPost("upload")]
        public async Task<IActionResult> UploadPdf([FromBody] HtmlUploadRequest req)
        {
            if (string.IsNullOrEmpty(req.Html))
            {
                return BadRequest(new { success = false, error = "HTMLデータが空です。" });
            }

            try
            {
                var browserFetcher = new BrowserFetcher();
                await browserFetcher.DownloadAsync();

                await using var browser = await Puppeteer.LaunchAsync(new LaunchOptions
                {
                    Headless = true,
                    Args = new[]
                    {
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--no-zygote",
                        "--single-process"
                    }
                });

                await using var page = await browser.NewPageAsync();

                // 画像（角印など）の読み込み完了まで確実に待機するオプションを指定
                await page.SetContentAsync(req.Html, new SetContentOptions
                {
                    WaitUntil = new[] { WaitUntilNavigation.DOMContentLoaded, WaitUntilNavigation.Networkidle0 }
                });

                // ★ 印刷用CSS (@media print) を適用させて不要UIを非表示にする
                await page.EmulateMediaTypeAsync(PuppeteerSharp.Media.MediaType.Print);

                var pdfBytes = await page.PdfDataAsync(new PdfOptions
                {
                    Format = PuppeteerSharp.Media.PaperFormat.A4,
                    PrintBackground = true, // 背景画像・角印画像を確実に描画
                    PreferCSSPageSize = true,
                    MarginOptions = new PuppeteerSharp.Media.MarginOptions
                    {
                        Top = "0px",
                        Bottom = "0px",
                        Left = "0px",
                        Right = "0px"
                    }
                });

                var accountId = _config["CloudflareR2:AccountId"];
                var accessKeyId = _config["CloudflareR2:AccessKeyId"];
                var secretAccessKey = _config["CloudflareR2:SecretAccessKey"];
                var bucketName = _config["CloudflareR2:BucketName"];

                var s3Config = new AmazonS3Config
                {
                    ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com"
                };

                using var s3Client = new AmazonS3Client(accessKeyId, secretAccessKey, s3Config);
                var fileName = $"invoice_{req.CustomerCode}_{req.InvoiceNo}_{DateTime.Now:yyyyMMddHHmmss}.pdf";

                using var stream = new MemoryStream(pdfBytes);
                var putRequest = new PutObjectRequest
                {
                    BucketName = bucketName,
                    Key = fileName,
                    InputStream = stream,
                    ContentType = "application/pdf",
                    UseChunkEncoding = false,
                    DisablePayloadSigning = true
                };

                await s3Client.PutObjectAsync(putRequest);

                return Ok(new { success = true, fileName = fileName });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }
    }
}