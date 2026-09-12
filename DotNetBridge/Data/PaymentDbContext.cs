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

    public class PaymentLog
    {
        public int Id { get; set; }
        
        public string? InvoiceNo { get; set; }
        public string? CustomerCode { get; set; }
        public string? CustomerName { get; set; }
        public string? ItemDescription { get; set; } // ★ 明細・請求内容（例: マンホール 450Φ / 清掃代など）
        public long Amount { get; set; }

        public string? StripeSessionId { get; set; }
        public string? Status { get; set; } = "unpaid";

        public string? IssuedBy { get; set; }
        public DateTime? IssuedAt { get; set; }
        public DateTime? PaidAt { get; set; }
        public string? PdfFileName { get; set; }
    }
}