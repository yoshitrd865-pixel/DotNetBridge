using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;

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

        [HttpPost("upload")]
        public async Task<IActionResult> UploadPdf(
            [FromForm] IFormFile file,
            [FromForm] string invoiceNo,
            [FromForm] string customerCode)
        {
            if (file == null || file.Length == 0)
            {
                return BadRequest(new { success = false, error = "ファイルが空です。" });
            }

            try
            {
                var accountId = _config["CloudflareR2:AccountId"];
                var accessKeyId = _config["CloudflareR2:AccessKeyId"];
                var secretAccessKey = _config["CloudflareR2:SecretAccessKey"];
                var bucketName = _config["CloudflareR2:BucketName"];

                // ─── R2接続設定 ───
                var s3Config = new AmazonS3Config
                {
                    ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com"
                };

                using var s3Client = new AmazonS3Client(accessKeyId, secretAccessKey, s3Config);

                // ファイル名の構築
                var fileName = string.IsNullOrEmpty(file.FileName)
                    ? $"invoice_{customerCode}_{invoiceNo}_{DateTime.Now:yyyyMMddHHmmss}.pdf"
                    : file.FileName;

                using var stream = file.OpenReadStream();

                // ─── R2互換アップロード設定 ───
                // R2特有のエラー(STREAMING-AWS4-HMAC-SHA256...)を回避するため
                // チャンクエンコーディングを無効化し、ペイロード署名をオフにする
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