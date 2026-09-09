using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;
using PuppeteerSharp;
using PuppeteerSharp.Media;

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
            public string Html { get; set; }
            public string InvoiceNo { get; set; }
            public string CustomerCode { get; set; }
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
                // 1. ヘッドレスChromeのブラウザを準備
                using var browserFetcher = new BrowserFetcher();
                await browserFetcher.DownloadAsync();
                
                await using var browser = await Puppeteer.LaunchAsync(new LaunchOptions
                {
                    Headless = true,
                    Args = new[] { "--no-sandbox", "--disable-setuid-sandbox" }
                });

                await using var page = await browser.NewPageAsync();
                
                // 2. 受け取ったHTMLを展開
                await page.SetContentAsync(req.Html, new NavigationOptions
                {
                    WaitUntil = new[] { WaitUntilNavigation.Networkidle0 }
                });

                // 3. ブラウザ標準と同等の完璧なA4 PDFを生成
                var pdfBytes = await page.PdfDataAsync(new PdfOptions
                {
                    Format = PaperFormat.A4,
                    PrintBackground = true,
                    PreferCSSPageSize = true,
                    MarginOptions = new MarginOptions { Top = "0px", Bottom = "0px", Left = "0px", Right = "0px" }
                });

                // 4. Cloudflare R2へ送信
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