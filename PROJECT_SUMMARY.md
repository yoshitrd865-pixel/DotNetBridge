DotNetBridge プロジェクト概要・仕様書 (PROJECT_SUMMARY.md)

本ドキュメントは、DotNetBridge（ASP.NET Core Webアプリケーション）の全体アーキテクチャ、マルチテナント・リバースプロキシ仕様、ルーティング、Stripe決済連携、各種拡張モジュール（クラウド付箋くん・清掃オートリンク機能等）、データベース永続化仕様、および開発ガードレールについてまとめた完全版プロジェクトサマリーです。

1. プロジェクト概要・技術スタック

概要

DotNetBridge は、外部のレガシーWebシステム（Classic ASP / IIS環境で稼働する ECOPRO3 および EcoMaster）へのアクセスを独自認証（Cookie認証 ＋ Google OAuth 2.0）で保護しながらリバースプロキシ経由で中継し、特定のページ（請求画面、点検入力画面等）に対して自動的に JavaScript（Stripe決済QR生成機能、クラウド付箋くん、清掃オートリンク機能等）をインジェクション・統合するマルチテナント・リバースプロキシ基盤です。

また、Stripe Checkoutを用いたクレジットカード決済のWebhook処理、業務効率化アシスタント（Tampermonkey「アシストくん」）向けの消込データ連携API、およびテナントごとの契約管理ポータルを提供します。

技術スタック

フレームワーク: ASP.NET Core (C# / .NET 8.0)

データベース: SQLite (FusenDbContext, PaymentDbContext, SubscriptionDbContext) ※Render Persistent Disk により /var/data に永続化

ORマッパー: Entity Framework Core 8.0

認証: ASP.NET Core Cookie認証 (/Account/Login) ＋ Google OAuth 2.0 (/signin-google)

決済プラットフォーム: Stripe API (Stripe.net SDK, Checkout Sessions, Webhooks)

インフラ・デプロイ: Render Persistent Disk対応（Mount path: /var/data, Size: 1GB）、Docker/Linux対応 (PORT 環境変数対応、DOTNET_USE_POLLING_FILE_WATCHER 設定済)

フロントエンド / 拡張: バニラJavaScript (ES Modules)、動的インジェクション (custom-inject.js)

文字コード: CP932 (Shift-JIS) 相互エンコーディング（System.Text.CodePagesEncodingProvider 登録済）

2. 開発の歴史と絶対ルール（重要）

🚨 1. 現在のステータスと変更経緯

マルチテナント・スマートリバースプロキシ基盤の完成:

ProxyDispatcher.cs による動的ディスパッチ: ログインユーザーの Google メールアドレス（ClaimTypes.Email）から DB (SubscriptionDbContext) を検索し、テナントごとの接続先 (TargetAspUrl) に応じて EcoProProxyService (ECOPRO) と EcoMasterProxyService (EcoMaster/mobile60) へ動的に振分け。

スマートパス判定 (404フォールバック全廃): 本家IISへの存在しないパス試し打ち（404応答）による ASPSESSIONID 破棄事故を完封。/EcoHHCDemo/ 直下のアセット・帳票フォルダ（Report/, PrintDaily/, icon/, css/ 等）と /EcoHHCDemo/main/ 直下の業務画面を事前のパス解析で1発直撃生成。

IIS互換Cookie成形: プロキシ内部用クッキー（.AspNetCore, Session）を分離・除外の上、本家IISが受容できるセミコロン＋スペース（; ）区切りに統一して透過転送。レスポンスの Set-Cookie は Append で個別ヘッダーとして返却しセッションの破棄を防止。

window.top による画面全体脱出 & 無限ループ防止: Classic ASP 特有の frameset/iframe 内で認証切れや契約停止（IsActive == false）が発生した際、HTTP 302 リダイレクトではなく JavaScript（window.top.location.href = '/Account/Suspended'）を出力して画面外枠ごと一括脱出。Google OAuth の自動再認証による無限リダイレクト（白画面ループ）を防ぐため、専用のアカウント停止画面 /Account/Suspended へ直接誘導する仕様を確立。

帳票出力 & CP932 (Shift-JIS) 文字コード保持: 帳票ポップアップ（/Report/*.htm）の Same-Origin 属性を維持し、文字化けやパラメータ破壊を防ぐ相互エンコーディング処理を実装。

データベース永続化の確立:

Render上に Persistent Disk（Mount path: /var/data）を導入し、fusen.db, payment.db, subscription.db を永続化。再起動やデプロイによるデータ消失を防止。

付箋データの移行完了:

旧サーバーの本番データ（hhc-eco11.com_EcoToubuF3 / 21KB）を取得し、/var/data/fusen.db への一括移行・永続保存が完了。

クラウド付箋くん（fusen-kun.js）のアップデート:

ハイブリッド画面判定の強化（DOM要素や listcheck.asp の存在検知）、ブルー系UI（#0284C7 / #007AFF）へのテーマカラー統一、旧データ移行ユーティリティ（window.migrateFusenData）の実装。

清掃オートリンク機能（clean-autolink.js）の新規構築・完元:

点検入力画面（check.asp）での操作から清掃実績（clean.asp）または清掃予定（cleanPlan.asp）を非同期自動連携する機能を確立。隠し iframe の onload（Promise）による完了検知で親画面遷移による強制切断事故を100%防止。

🚫 2. 絶対的な設計方針と禁止事項（厳守ガードレール）

無差別な404フォールバック通信の絶対禁止:

本家IISへ存在しないURLを送信して404エラーを受け取ると、IIS側で ASPSESSIONID が即座に無効化される。リクエスト送信前に必ずパス形式を判定し、1発で正確な Target URI を生成すること。

IIS互換Cookie整形の維持:

本家ASPへリクエストを転送する際、プロキシ自身の内部Cookie（.AspNetCore, Session 等）は除去し、有効なクッキーは必ず ; （セミコロン＋スペース）で連結して転送すること。

画面リダイレクト時の window.top 徹底:

frameset/iframe 内での画面崩れを防ぐため、未認証・契約停止時の脱出は HTTP 302 ではなく window.top.location.href = '/Account/Suspended' を使用すること。

契約停止時の転送先制限:

Google OAuth の自動再認証による無限リダイレクトループ（白画面）を回避するため、停止時の転送先は /Account/Login ではなく必ず専用の静的案内画面 /Account/Suspended とすること。

CP932 (Shift-JIS) エンコーディング保持:

テキストレスポンス書き換え時はバイナリ破損や文字化けを防ぐため、常に Encoding.GetEncoding(932) を基準とすること。

認証情報の動的取得:

コード内にテスト目的のメールアドレスをハードコードせず、常に context.User.FindFirst(ClaimTypes.Email)?.Value から動的に取得すること。

サーバー側（C#）での代理ログイン実装は絶対厳禁！:

プロキシ基盤は「完全ステートレスな土管」として聖域化し、レガシーASPへのログインやセッション維持はフロントエンド（JS）に100%任せる。

DOM監視（MutationObserver）の無限ループ・ピクつき防止:

observeDOM 下でテキストやDOMを変更する際、要素や親要素に dataset.copyInjected = "true" などの処理済みフラグを刻み、再描画・上書きループを完封すること。

非同期通信の同期制御（async/await + iframe.onload）:

不確定なタイマー待機ではなく、隠し iframe の load イベント（Promise化）を利用して ASP サーバーからの POST 完了レスポンスをリアルタイム検出し、親画面の予期せぬ遷移切れ（キャンセル）を防ぐこと。

3. ルーティング・エンドポイント一覧

パス / パターン

HTTP メソッド

コントローラー / ハンドラー

説明

/

GET

ProxyDispatcher

認証済みユーザーのルートアクセスを各プロキシサービスへ振り分け（未認証時は /Account/Login へリダイレクト）

/Account/Login

GET / POST

AccountController

独自のログイン画面および認証処理 (admin / password123) ＋ Google OAuthログイン

/Account/Logout

GET

AccountController

ログアウト処理およびCookie破棄

/Account/Suspended

GET

AccountController

契約停止ユーザー専用の案内画面（無限リダイレクトループ防止用）

/admin/payments

GET

PaymentAdminController (Index)

入金消込データ一覧の管理画面（DB保存されたStripe決済ログの確認）

/admin

GET

AdminController 等

テナント契約管理ポータル（Googleメールアドレス、接続先URL、契約状態の変更）

/api/fusen/*

GET / POST

FusenApiController

クラウド付箋くん用の付箋データ保存・取得API (/api/fusen/get, /api/fusen/save)

/api/StripePayment/create-checkout

POST

StripePaymentController

Stripe Checkout Sessionを生成し、決済用URLを返すAPI

/api/StripePayment/webhook

POST

StripePaymentController

StripeからのWebhookを受信し、決済完了時にDBへ消込ログ (PaymentLog) を保存

/api/StripePayment/logs

GET

StripePaymentController

保存された消込データ一覧をJSON形式で取得する確認用API

/api/StripePayment/get_unprocessed

GET / POST

StripePaymentController

未処理の消込データをTampermonkey（アシストくん）向けに返却・ステータス更新

その他すべての業務パス

ALL

ProxyDispatcher

/Account, /api, /admin, /success, /cancel, /signin-google 以外の全パスを中継

4. データベース構成・永続化仕様

データベースエンジン: SQLite

ストレージパス: Render Persistent Disk (/var/data/)

付箋データベース: FusenDbContext → Data Source=/var/data/fusen.db

決済データベース: PaymentDbContext → Data Source=/var/data/payment.db

契約管理データベース: SubscriptionDbContext → Data Source=/var/data/subscription.db

テーブル定義:

TenantSubscriptions: Id, GoogleEmail, TargetAspUrl, IsActive, CreatedAt, UpdatedAt

PaymentLog: Id, CustomerNumber, Amount, SessionId, IsProcessed, CreatedAt

FusenData: Id, TargetDomain, Key, DataJson, UpdatedAt

5. プロキシサービス詳細アーキテクチャ

① ProxyDispatcher.cs

役割: ログイン中のGoogleメールアドレスに基づき DB を参照し、適切なプロキシサービスへ中継するディスパッチャー。

振り分け規則: TargetAspUrl に mobile60 が含まれている場合は EcoMasterProxyService、含まれない場合は EcoProProxyService へ振り分け。

停止制御: テナント未登録または IsActive == false の場合、window.top による画面全体脱出スクリプトを出力して停止画面へ誘導。

② EcoProProxyService.cs (ECOPRO専用プロキシ)

役割: 事務所用Classic ASPシステムの透過中継。

スマートパスルーティング:

/EcoHHCDemo/ 直下フォルダ（report, printdaily, mobile60_hyojun, icon, css, img, images, js）は AppRoot 宛てに結合。

業務画面フォルダ（Check/, Master/, main/ 等）および直下ファイルは targetBaseUrl (.../main/) 宛てに直撃結合。

セッション維持: プロキシ内部Cookieを除去した上で ;  区切りの有効Cookieを透過転送し、レスポンスの Set-Cookie は1件ずつ独立したヘッダー（Append）でブラウザへ返送。

③ EcoMasterProxyService.cs (EcoMaster専用プロキシ)

役割: 現場モバイル向けClassic ASPシステムの透過中継。

パス正規化: 重複する EcoToubuF3/ や mobile60_ToubuF/ を自動除去。

機能拡張: <base> タグの動的挿入、PWAマニフェスト、および custom-inject.js の動的注入。

6. フロントエンド拡張モジュール一覧 (wwwroot/js/modules/)

settings.js: 設定状態の保持（localStorage）と設定UI・機能ON/OFFトグルの管理。

router.js: URLパス解析とページ判定（pathname.includes による堅牢な部分一致）。

custom-inject.js: 全体制御ハブ（インジェクションと各モジュールの遅延読み込み・ガード制御）。

auto-login.js: クラシックASP向け自動ログイン機能。

stripe-pay.js: QR決済・Stripe連携機能。

continuous-upload.js: viewFile.asp / viewInfo.asp での連続写真アップロードUI。

inspection-warp.js: 顧客BOX横の空きマス乗っ取り点検BOXワープボタン ＆ viewFile.asp の window.close 戻るボタン修復。

zandaka-copy.js: 伝票・残高情報のクリップボードコピー＆自動整理機能。

fusen-kun.js: クラウド付箋くん（ハイブリッド画面判定、ブルー系統一UI、旧データ移行機能付き）。

clean-autolink.js: 清掃オートリンク機能

顧客名の動的キャッチとセッション保持: menuCheck.asp / menuclean.asp から顧客名を自動取得し sessionStorage (clean_autolink_customer_name) に保持。最終完了画面まで確実に引き継ぐ。

清掃実績（汚泥量入力時）の自動連動: 汚泥量（1〜3㎥・直接入力）選択時に発火。隠し iframe で listClean.asp を呼び出して顧客IDと日付範囲（全期間）で検索、該当顧客の CleanNumber を自動抽出して clean.asp で汚泥量をセットし自動送信。送信後は listClean.asp の検索条件を「当月」かつワードクリアへ自動リセット（resetListCleanToDefault）。

清掃予定（次回月選択時）の自動連動: 汚泥量未入力で次回清掃月（1〜12月）選択時に発火。未来年自動判定（過去月なら翌年化、同月なら確認ダイアログ）を行い、隠し iframe で cleanPlan.asp を開き YYYY/MM/01 形式で自動送信。

非同期通信の同期制御: iframe.onload（Promise）によりASPからのPOST完了をリアルタイム検出し、親画面遷移による切断を100%防止。

UI/UX・相互排他制御 & 完了通知カード: 実績と予定の相互打ち消し制御、ダークグラデーション＋ローディングスピナー付きトースト表示（showStatusToast）、点検完了画面（writeCheck.asp）の id="divCondition" 直前へのスタイリッシュな完了通知カード挿入。

7. 未実装・今後対応が必要な課題

サクセス・キャンセルURLのハンドリングビュー (/success / /cancel):

決済完了後・キャンセル後のユーザー向け専用画面（Razor View）の本格的なリッチ化。

エラーハンドリング・ログ出力の強化:

ネットワーク障害やStripe API通信エラー発生時のユーザーフィードバックやリトライ機構の改善。

本番環境用セキュリティ設定:

簡易ハードコードされているログイン情報 (admin / password123) のハッシュ化やデータベース管理、環境変数化。