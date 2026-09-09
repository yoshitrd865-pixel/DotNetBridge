# 1. ビルド用ステージ (.NET 10 SDK)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# プロジェクトファイルをコピーしてリストア
COPY ["DotNetBridge/DotNetBridge.csproj", "DotNetBridge/"]
RUN dotnet restore "DotNetBridge/DotNetBridge.csproj"

# 全ソースコードをコピーしてビルド
COPY . .
WORKDIR "/src/DotNetBridge"
RUN dotnet publish "DotNetBridge.csproj" -c Release -o /app/publish /p:UseAppHost=false

# 2. 実行用ステージ (.NET 10 Runtime)
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# ★ Chrome(Puppeteer)動作に必要な全Linux依存ライブラリを完全網羅 ★
RUN apt-get update && apt-get install -y \
    libpango-1.0-0 \
    pangoxft-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2t64 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxfixes3 \
    fonts-ipafont-gothic \
    && rm -rf /var/lib/apt/lists/*

# Render から割り当てられるポートを受け取る設定
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

# (ファイル監視機能）の上限エラー対策
ENV DOTNET_USE_POLLING_FILE_WATCHER=1

COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "DotNetBridge.dll"]