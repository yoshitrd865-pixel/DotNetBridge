using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

namespace DotNetBridge.Data
{
    public class AccountDbContext : DbContext
    {
        public AccountDbContext(DbContextOptions<AccountDbContext> options) : base(options) { }

        // Googleアカウントとレガシーシステムの認証情報紐付けテーブル
        public DbSet<UserLegacyCredential> UserLegacyCredentials { get; set; }
    }

    public class UserLegacyCredential
    {
        [Key]
        public string GoogleEmail { get; set; } = string.Empty;     // キー：Googleのメールアドレス
        public string LegacyUserId { get; set; } = string.Empty;     // クラシックASPのログインID
        public string EncryptedLegacyPassword { get; set; } = string.Empty; // 暗号化されたパスワード
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;   // 最終更新日時
    }
}