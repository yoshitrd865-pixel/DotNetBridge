// Controllers/PdfArchiveController.cs
using System.Text.RegularExpressions;
using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PuppeteerSharp;
using DotNetBridge.Data;

namespace DotNetBridgeApp.Controllers
{
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
            public string? ItemDescription { get; set; } // 明細項目
            public long Amount { get; set; }
            public string? IssuedBy { get; set; }
        }

        [HttpPost("upload")]
        public async Task<IActionResult> UploadPdf([FromBody] HtmlUploadRequest req)
        {
            if (string.IsNullOrEmpty(req.Html))
            {
                return BadRequest("HTMLデータが空です。");
            }

            var accountId = _config["CloudflareR2:AccountId"] ?? Environment.GetEnvironmentVariable("R2_ACCOUNT_ID");
            var accessKeyId = _config["CloudflareR2:AccessKeyId"] ?? Environment.GetEnvironmentVariable("R2_ACCESS_KEY_ID");
            var secretAccessKey = _config["CloudflareR2:SecretAccessKey"] ?? Environment.GetEnvironmentVariable("R2_SECRET_ACCESS_KEY");
            var bucketName = _config["CloudflareR2:BucketName"] ?? Environment.GetEnvironmentVariable("R2_BUCKET_NAME") ?? "hhc-pdf-archive";

            if (string.IsNullOrEmpty(accountId) || string.IsNullOrEmpty(accessKeyId) || string.IsNullOrEmpty(secretAccessKey))
            {
                return StatusCode(500, "R2の設定情報(AccountId/AccessKey)が未設定です。");
            }

            byte[] pdfBytes;
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
                await page.SetContentAsync(req.Html, new SetContentOptions
                {
                    WaitUntil = new[] { WaitUntilNavigation.DOMContentLoaded }
                });

                pdfBytes = await page.PdfDataAsync(new PdfOptions
                {
                    Format = PuppeteerSharp.Media.PaperFormat.A4,
                    PrintBackground = true,
                    PreferCSSPageSize = true
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"PDF生成失敗: {ex.Message}");
            }

            var nowJst = DateTime.UtcNow.AddHours(9);
            var fileName = $"invoice_{req.CustomerCode}_{req.InvoiceNo}_{nowJst:yyyyMMddHHmmss}.pdf";

            try
            {
                var s3Config = new AmazonS3Config
                {
                    ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com"
                };

                using var s3Client = new AmazonS3Client(accessKeyId, secretAccessKey, s3Config);
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
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"R2アップロード失敗: {ex.Message}");
            }

            try
            {
                var issuerEmail = !string.IsNullOrEmpty(req.IssuedBy) 
                    ? req.IssuedBy 
                    : (HttpContext.Session.GetString("UserEmail") ?? "未指定");

                // ★ 明細項目の自動補正ロジック（リクエストが空の場合はHTMLから解析して抽出）
                var itemDesc = !string.IsNullOrWhiteSpace(req.ItemDescription)
                    ? req.ItemDescription
                    : ExtractItemDescriptionFromHtml(req.Html);

                if (string.IsNullOrWhiteSpace(itemDesc))
                {
                    itemDesc = "維持管理・清掃作業料";
                }

                PaymentLog? log = null;
                if (!string.IsNullOrEmpty(req.InvoiceNo) && req.InvoiceNo != "未指定")
                {
                    log = await _dbContext.PaymentLogs
                        .FirstOrDefaultAsync(p => p.InvoiceNo == req.InvoiceNo && p.CustomerCode == req.CustomerCode);
                }

                if (log != null)
                {
                    log.PdfFileName = fileName;
                    log.IssuedBy = issuerEmail;
                    log.IssuedAt = nowJst;
                    if (req.Amount > 0) log.Amount = req.Amount;
                    if (!string.IsNullOrEmpty(req.CustomerName)) log.CustomerName = req.CustomerName;
                    log.ItemDescription = itemDesc;
                }
                else
                {
                    log = new PaymentLog
                    {
                        InvoiceNo = string.IsNullOrEmpty(req.InvoiceNo) ? "未指定" : req.InvoiceNo,
                        CustomerCode = string.IsNullOrEmpty(req.CustomerCode) ? "未指定" : req.CustomerCode,
                        CustomerName = string.IsNullOrEmpty(req.CustomerName) ? "お施主様" : req.CustomerName,
                        ItemDescription = itemDesc,
                        Amount = req.Amount,
                        StripeSessionId = "",
                        Status = "unpaid",
                        IssuedBy = issuerEmail,
                        IssuedAt = nowJst,
                        PaidAt = new DateTime(1970, 1, 1),
                        PdfFileName = fileName
                    };
                    _dbContext.PaymentLogs.Add(log);
                }

                await _dbContext.SaveChangesAsync();
                return Ok(new { success = true, fileName = fileName });
            }
            catch (Exception ex)
            {
                var innerMsg = ex.InnerException != null ? ex.InnerException.Message : ex.Message;
                return StatusCode(500, $"DB登録失敗: {innerMsg}");
            }
        }

        [HttpGet("view/{fileName}")]
        public async Task<IActionResult> ViewPdf(string fileName)
        {
            try
            {
                var accountId = _config["CloudflareR2:AccountId"] ?? Environment.GetEnvironmentVariable("R2_ACCOUNT_ID");
                var accessKeyId = _config["CloudflareR2:AccessKeyId"] ?? Environment.GetEnvironmentVariable("R2_ACCESS_KEY_ID");
                var secretAccessKey = _config["CloudflareR2:SecretAccessKey"] ?? Environment.GetEnvironmentVariable("R2_SECRET_ACCESS_KEY");
                var bucketName = _config["CloudflareR2:BucketName"] ?? Environment.GetEnvironmentVariable("R2_BUCKET_NAME") ?? "hhc-pdf-archive";

                var s3Config = new AmazonS3Config
                {
                    ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com"
                };

                using var s3Client = new AmazonS3Client(accessKeyId, secretAccessKey, s3Config);
                var response = await s3Client.GetObjectAsync(new GetObjectRequest
                {
                    BucketName = bucketName,
                    Key = fileName
                });

                return File(response.ResponseStream, "application/pdf");
            }
            catch
            {
                return NotFound("指定されたPDFファイルが見つかりません。");
            }
        }

        [HttpPost("clear-all")]
        public async Task<IActionResult> ClearAllLogs()
        {
            try
            {
            // 1. 全レコードの削除
            _dbContext.PaymentLogs.RemoveRange(_dbContext.PaymentLogs);
            await _dbContext.SaveChangesAsync();

            // 2. SQLiteの AUTOINCREMENT カウンターを 0 にリセット
            await _dbContext.Database.ExecuteSqlRawAsync("DELETE FROM sqlite_sequence WHERE name='PaymentLogs';");

            return Ok(new { success = true, message = "すべてのデータとIDカウンターをリセットしました。" });
            }
            catch (Exception ex)
            {
            return StatusCode(500, new { success = false, error = ex.Message });
            }
        }
        /// <summary>
        /// 請求書HTMLのDOM構造から、設置先・日付・金額・消費税を除外して純粋な明細品目テキストを抽出
        /// </summary>
        private static string ExtractItemDescriptionFromHtml(string html)
        {
            if (string.IsNullOrEmpty(html)) return string.Empty;

            var items = new List<string>();
            var matches = Regex.Matches(
                html, 
                @"<td\s+[^>]*class=""[^""]*detail[^""]*""[^>]*>(.*?)</td>", 
                RegexOptions.Singleline | RegexOptions.IgnoreCase
            );

            foreach (Match match in matches)
            {
                var rawText = match.Groups[1].Value;
                var cleanText = Regex.Replace(rawText, @"<[^>]+>", string.Empty);
                cleanText = WebUtility.HtmlDecode(cleanText);
                cleanText = cleanText.Replace("\u00a0", " ").Trim();
                cleanText = Regex.Replace(cleanText, @"\s+", " ");

                if (string.IsNullOrWhiteSpace(cleanText)) continue;
                if (cleanText.Contains("設置先：") || cleanText.Contains("設置先:")) continue;
                if (cleanText == "消費税" || cleanText == "地方消費税" || cleanText == "小計" || cleanText == "合計" || cleanText == "内税合計" || cleanText == "外税合計" || cleanText == "明細項目") continue;
                if (Regex.IsMatch(cleanText, @"^\d{4}/\d{2}/\d{2}$")) continue;
                if (Regex.IsMatch(cleanText, @"^[\d,]+$")) continue;

                if (!items.Contains(cleanText))
                {
                    items.Add(cleanText);
                }
            }

            return items.Count > 0 ? string.Join(" / ", items) : string.Empty;
        }
    }
}