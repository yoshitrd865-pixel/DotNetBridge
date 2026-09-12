// Data/PaymentDbContext.cs
using System;
using Microsoft.EntityFrameworkCore;

namespace DotNetBridge.Data
{
    public class PaymentDbContext : DbContext
    {
        public PaymentDbContext(DbContextOptions<PaymentDbContext> options) : base(options) { }

        public DbSet<PaymentLog> PaymentLogs => Set<PaymentLog>();
    }

    /// <summary>
    /// 現場請求・Stripe決済・PDF保管メタデータを統合管理するエンティティ
    /// </summary>
    public class PaymentLog
    {
        public int Id { get; set; }
        
        // 伝票番号 & 顧客情報
        public string InvoiceNo { get; set; } = string.Empty;
        public string CustomerCode { get; set; } = string.Empty;
        public string CustomerName { get; set; } = "お施主様";
        public long Amount { get; set; }

        // Stripe 決済識別子 & ステータス (unpaid / completed / processed)
        public string StripeSessionId { get; set; } = string.Empty;
        public string Status { get; set; } = "unpaid";

        // ★ ビルドエラーの原因となっていた拡張プロパティ
        public string IssuedBy { get; set; } = string.Empty;      // 発行担当者名（例: 柏木芳光）
        public DateTime IssuedAt { get; set; } = DateTime.UtcNow; // 請求書発行（PDF作成）日時
        public DateTime PaidAt { get; set; }                      // Stripe決済完了日時
        public string? PdfFileName { get; set; }                  // R2のPDFファイル名
    }
}