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
        public string InvoiceNo { get; set; } = string.Empty;
        public string CustomerCode { get; set; } = string.Empty;
        public long Amount { get; set; }
        public string StripeSessionId { get; set; } = string.Empty;
        public string Status { get; set; } = "PAID";
        public DateTime PaidAt { get; set; } = DateTime.UtcNow;
    }
}