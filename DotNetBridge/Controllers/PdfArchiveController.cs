using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;

namespace DotNetBridge.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PdfArchiveController : ControllerBase
    {
        private readonly IConfiguration _config;
        private readonly ILogger<PdfArchiveController> _logger;

        public PdfArchiveController(IConfiguration config, ILogger<PdfArchiveController> logger)
        {
            _config = config;
            _logger = logger;
        }

        private IAmazonS3 GetR2Client()
        {
            var accountId = Environment.GetEnvironmentVariable("CloudflareR2__AccountId") 
                            ?? _config["CloudflareR2:AccountId"];
            var accessKey = Environment.GetEnvironmentVariable("CloudflareR2__AccessKeyId") 
                            ?? _config["CloudflareR2:AccessKeyId"];
            var secretKey = Environment.GetEnvironmentVariable("CloudflareR2__SecretAccessKey") 
                            ?? _config["CloudflareR2:SecretAccessKey"];

            // Cloudflare R2 の S3 互換エンドポイント URL
            var serviceUrl = $"https://{accountId}.r2.cloudflarestorage.com";

            var config = new AmazonS3Config
            {
                ServiceURL = serviceUrl,
                ForcePathStyle = true // R2 必須設定
            };

            return new AmazonS3Client(accessKey, secretKey, config);
        }

        /// <summary>
        /// JavaScript (プロキシ注入) から送信された PDF を Cloudflare R2 へ保存する API
        /// </summary>
        [HttpPost("upload")]
        public async Task<IActionResult> UploadPdf([FromForm] IFormFile file, [FromForm] string invoiceNo, [FromForm] string customerCode)
        {
            if (file == null || file.Length == 0)
            {
                return BadRequest(new { success = false, error = "ファイルが空です" });
            }

            try
            {
                var bucketName = Environment.GetEnvironmentVariable("CloudflareR2__BucketName") 
                                 ?? _config["CloudflareR2:BucketName"];

                // R2 上でのファイル名設計: 「西暦年月/顧客コード_伝票No_タイムスタンプ.pdf」
                var dateFolder = DateTime.Now.ToString("yyyyMM");
                var timeStamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
                var cleanInvoiceNo = string.IsNullOrWhiteSpace(invoiceNo) ? "NO_INVOICE" : invoiceNo.Trim();
                var cleanCustomerCode = string.IsNullOrWhiteSpace(customerCode) ? "NO_CUSTOMER" : customerCode.Trim();

                var objectKey = $"invoices/{dateFolder}/{cleanCustomerCode}_{cleanInvoiceNo}_{timeStamp}.pdf";

                using var s3Client = GetR2Client();
                using var stream = file.OpenReadStream();

                var putRequest = new PutObjectRequest
                {
                    BucketName = bucketName,
                    Key = objectKey,
                    InputStream = stream,
                    ContentType = "application/pdf"
                };

                await s3Client.PutObjectAsync(putRequest);

                _logger.LogInformation($"[R2保存成功] KEY: {objectKey}");

                return Ok(new
                {
                    success = true,
                    key = objectKey,
                    fileName = $"{cleanCustomerCode}_{cleanInvoiceNo}_{timeStamp}.pdf"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Cloudflare R2 PDF アップロードエラー");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }
    }
}