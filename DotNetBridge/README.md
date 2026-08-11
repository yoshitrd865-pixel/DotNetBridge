# DotNetBridge (透過プロキシラッパー)

古いクラシックASPサーバー (hhc-eco11.com) の手前に配置し、モダンなセキュリティと高速化を提供するASP.NET Coreプロキシです。

## 主な機能と解決済みの仕様
- **透過プロキシ処理**: 全HTTPメソッド（GET, POST, PUT等）をそのまま中継
- **POSTボディ自動消費の防止**: `ProxyController` のアクション引数をあえて空にし、`RouteData` からパスを取得することでPOSTデータを生保持
- **ドメイン・ヘッダー偽装**: `Referer` / `Origin` を本家ドメインに置換して直アクセス拒否を回避
- **セッション維持**: `Set-Cookie` から `Domain` 属性を削除し、`localhost` 環境でのログイン保持を実現
- **HTMLレスポンス書き換え**: Shift_JIS(cp932) で解析し、タイムアウト要因となる旧ドメイン (`hhc-eco1.com`) を新ドメインへ置換

## 動作確認・テスト方法
```bash
dotnet test
dotnet run