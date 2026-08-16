namespace DotNetBridge.Models
{
    public class FusenStore
    {
        public int Id { get; set; }
        public string DomainKey { get; set; } = string.Empty; // 例: "hhc-eco11.com_ecopro"
        public string DataJson { get; set; } = "{}"; // JSONをそのままテキストで保存
    }
}