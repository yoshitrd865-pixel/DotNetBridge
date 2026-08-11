using Xunit;

namespace DotNetBridge.Tests
{
    public class ProxyLogicTests
    {
        [Fact]
        public void Test_OldDomainReplacement()
        {
            // テストデータ
            string inputHtml = "<a href='https://hhc-eco1.com/index.asp'>Link</a>";
            string expectedHtml = "<a href='https://hhc-eco11.com/index.asp'>Link</a>";

            // 置換処理のテスト
            string resultHtml = inputHtml.Replace("https://hhc-eco1.com", "https://hhc-eco11.com");

            // 検証
            Assert.Equal(expectedHtml, resultHtml);
        }
    }
}