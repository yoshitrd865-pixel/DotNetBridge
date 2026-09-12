// Controllers/PdfArchiveController.cs
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PuppeteerSharp;
using DotNetBridge.Data;

namespace DotNetBridgeApp.Controllers
{
    /// <summary>
    /// 請求書PDFのR2自動アーカイブおよび発行ログ管理API
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class PdfArchiveController : ControllerBase
    {
        private readonly IConfiguration _config;
        private readonly PaymentDbContext _dbContext;
        private readonly ILogger<PdfArchiveController> _logger;

        public PdfArchiveController(
            IConfiguration config, 
            PaymentDbContext dbContext,
            ILogger<PdfArchiveController> logger)
        {
            _config = config;
            _dbContext = dbContext;
            _logger = logger;
        }

        public class HtmlUploadRequest
        {
            public string Html { get; set; } = string.Empty;
            public string InvoiceNo { get; set; } = string.Empty;
            public string CustomerCode { get; set; } = string.Empty;
            public string? CustomerName { get; set; }
            public long Amount { get; set; }
            public string? IssuedBy { get; set; }
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
                // 1. PuppeteerでのPDF化処理
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

                await page.SetContentAsync(req.Html, new SetContentOptions
                {
                    WaitUntil = new[] { WaitUntilNavigation.DOMContentLoaded }
                });

                var pdfBytes = await page.PdfDataAsync(new PdfOptions
                {
                    Format = PuppeteerSharp.Media.PaperFormat.A4,
                    PrintBackground = true,
                    PreferCSSPageSize = true,
                    MarginOptions = new PuppeteerSharp.Media.MarginOptions
                    {
                        Top = "0px",
                        Bottom = "0px",
                        Left = "0px",
                        Right = "0px"
                    }
                });

                // 2. Cloudflare R2 ストレージ書き込み
                var accountId = _config["CloudflareR2:AccountId"];
                var accessKeyId = _config["CloudflareR2:AccessKeyId"];
                var secretAccessKey = _config["CloudflareR2:SecretAccessKey"];
                var bucketName = _config["CloudflareR2:BucketName"];

                var s3Config = new AmazonS3Config
                {
                    ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com"
                };

                using var s3Client = new AmazonS3Client(accessKeyId, secretAccessKey, s3Config);
                
                var now = DateTime.UtcNow;
                var fileName = $"invoice_{req.CustomerCode}_{req.InvoiceNo}_{now:yyyyMMddHHmmss}.pdf";

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

                // --------------------------------------------------
                // 3. DB (PaymentLog) への保存（NOT NULL制約回避ロジック追加）
                // --------------------------------------------------
                var issuerEmail = !string.IsNullOrEmpty(req.IssuedBy) 
                    ? req.IssuedBy 
                    : (HttpContext.Session.GetString("UserEmail") ?? "未指定");

                // 有効な伝票番号・顧客コードがある場合は既存ログを検索
                PaymentLog? log = null;
                if (!string.IsNullOrEmpty(req.InvoiceNo) && req.InvoiceNo != "未指定")
                {
                    log = await _dbContext.PaymentLogs
                        .FirstOrDefaultAsync(p => p.InvoiceNo == req.InvoiceNo && p.CustomerCode == req.CustomerCode);
                }

                if (log != null)
                {
                    // 既存ログの更新
                    log.PdfFileName = fileName;
                    log.IssuedBy = issuerEmail;
                    log.IssuedAt = now;
                    if (req.Amount > 0) log.Amount = req.Amount;
                    if (!string.IsNullOrEmpty(req.CustomerName)) log.CustomerName = req.CustomerName;
                }
                else
                {
                    // 新規作成（SQLite NOT NULL 制約エラーを防ぐため StripeSessionId に空文字をセット）
                    log = new PaymentLog
                    {
                        InvoiceNo = string.IsNullOrEmpty(req.InvoiceNo) ? "未指定" : req.InvoiceNo,
                        CustomerCode = string.IsNullOrEmpty(req.CustomerCode) ? "未指定" : req.CustomerCode,
                        CustomerName = string.IsNullOrEmpty(req.CustomerName) ? "お施主様" : req.CustomerName,
                        Amount = req.Amount,
                        StripeSessionId = "", // ★ SQLite NOT NULL 制約落ち防止
                        Status = "unpaid",
                        IssuedBy = issuerEmail,
                        IssuedAt = now,
                        PaidAt = null,
                        PdfFileName = fileName
                    };
                    _dbContext.PaymentLogs.Add(log);
                }

                await _dbContext.SaveChangesAsync();
                _logger.LogInformation($"[PDFアーカイブ成功] 伝票: {req.InvoiceNo}, 発行者: {issuerEmail}, ファイル: {fileName}");

                return Ok(new { success = true, fileName = fileName });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[PDF Archive Error]");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        [HttpGet("view/{fileName}")]
        public async Task<IActionResult> ViewPdf(string fileName)
        {
            try
            {
                var accountId = _config["CloudflareR2:AccountId"];
                var accessKeyId = _config["CloudflareR2:AccessKeyId"];
                var secretAccessKey = _config["CloudflareR2:SecretAccessKey"];
                var bucketName = _config["CloudflareR2:BucketName"];

                var s3Config = new AmazonS3Config
                {
                    ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com"
                };

                using var s3Client = new AmazonS3Client(accessKeyId, secretAccessKey, s3Config);
                
                var getRequest = new GetObjectRequest
                {
                    BucketName = bucketName,
                    Key = fileName
                };

                var response = await s3Client.GetObjectAsync(getRequest);
                return File(response.ResponseStream, "application/pdf");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"[PDF View Error] ファイル取得失敗: {fileName}");
                return NotFound("指定されたPDFファイルが見つかりません。");
            }
        }
    }
}