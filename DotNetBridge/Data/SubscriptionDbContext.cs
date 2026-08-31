using Microsoft.EntityFrameworkCore;

namespace DotNetBridge.Data
{
    // テナント（顧客企業）のサブスク契約情報
    public class TenantSubscription
    {
        public int Id { get; set; }
        
        // Googleログイン時のメールアドレス（1社1アカウントの識別キー）
        public string GoogleEmail { get; set; } = string.Empty;
        
        // 割り当てるエコマスターの個別URL（例: https://hhc-eco1.com/companyA/）
        public string TargetAspUrl { get; set; } = string.Empty;
        
        // Stripe関連情報
        public string? StripeCustomerId { get; set; }
        public string? StripeSubscriptionId { get; set; }
        
        // 契約状態（支払い完了でtrue、未払い・キャンセルでfalse）
        public bool IsActive { get; set; } = true;
        
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class SubscriptionDbContext : DbContext
    {
        public SubscriptionDbContext(DbContextOptions<SubscriptionDbContext> options)
            : base(options) { }

        public DbSet<TenantSubscription> TenantSubscriptions { get; set; }
    }
}