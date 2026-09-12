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
        
        public string? InvoiceNo { get; set; }
        public string? CustomerCode { get; set; }
        public string? CustomerName { get; set; }
        public long Amount { get; set; }

        public string? StripeSessionId { get; set; }
        public string? Status { get; set; } = "unpaid";

        // ★ 既存データの NULL 読み込み落ちを防ぐためすべて Nullable (?) 化
        public string? IssuedBy { get; set; }
        public DateTime? IssuedAt { get; set; }
        public DateTime? PaidAt { get; set; }
        public string? PdfFileName { get; set; }
    }
}