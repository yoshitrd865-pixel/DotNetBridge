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

# Render から割り当てられるポートを受け取る設定
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "DotNetBridge.dll"]