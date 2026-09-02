<#
.SYNOPSIS
  一鍵把最新程式同步到地端 IIS 靜態站台：git pull → build → 覆蓋站台檔案。

.DESCRIPTION
  這支只處理「網頁（前端靜態檔）」。edge function（CORS、行情 API 等）由
  GitHub Actions 在 push 時自動部署到雲端 Supabase，不在這裡處理；資料庫
  migration 走 GitHub 的「Apply database migration」workflow。

  build 產物是 hardened 的 `_site\`（與 GitHub Pages 部署的內容一致），
  外層 IIS 應用程式的實體路徑就對應網址的 `/Inspection/`（其下 `_site\v2`
  = `/Inspection/v2/`）。

.PARAMETER Target
  IIS「Inspection」應用程式/虛擬目錄的實體資料夾（會被鏡像覆蓋）。
  例：C:\inetpub\wwwroot\Inspection

.PARAMETER SkipPull
  跳過 git pull（已經自己 pull 過時用）。

.PARAMETER SkipBuild
  跳過 build（只重新複製既有 _site 時用）。

.EXAMPLE
  .\tools\deploy-iis.ps1 -Target C:\inetpub\wwwroot\Inspection
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Target,
  [switch]$SkipPull,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "== 地端 IIS 部署 ==" -ForegroundColor Cyan
Write-Host "repo   : $repo"
Write-Host "target : $Target"

if (-not (Test-Path -LiteralPath $Target)) {
  throw "找不到 Target 資料夾：$Target"
}
# 防呆：確認 Target 真的是這個站台的資料夾，避免鏡像鏡到別的地方。
$looksRight = (Test-Path (Join-Path $Target 'v2\index.html')) -or (Test-Path (Join-Path $Target 'v2\_next')) -or (Test-Path (Join-Path $Target 'index.html'))
if (-not $looksRight) {
  throw "Target 看起來不是 Inspection 站台資料夾（找不到 v2\index.html / v2\_next / index.html）。請確認路徑，或先手動放一次初始內容。"
}

if (-not $SkipPull) {
  Write-Host "`n[1/3] git pull --ff-only origin main" -ForegroundColor Yellow
  git fetch origin main
  git pull --ff-only origin main
} else {
  Write-Host "`n[1/3] 略過 git pull" -ForegroundColor DarkGray
}
$sha = (git rev-parse --short HEAD).Trim()
Write-Host "目前 commit：$sha"

if (-not $SkipBuild) {
  Write-Host "`n[2/3] npm run build:pages" -ForegroundColor Yellow
  npm run build:pages
  if ($LASTEXITCODE -ne 0) { throw "build:pages 失敗（exit $LASTEXITCODE）" }
} else {
  Write-Host "`n[2/3] 略過 build" -ForegroundColor DarkGray
}

$site = Join-Path $repo '_site'
if (-not (Test-Path (Join-Path $site 'v2\index.html'))) {
  throw "_site\v2\index.html 不存在，build 可能沒成功。"
}

Write-Host "`n[3/3] 鏡像 _site → $Target（robocopy /MIR）" -ForegroundColor Yellow
# /MIR 會刪掉 Target 內不在 _site 的檔案（清掉舊的 _next chunk）；保護 .git / App_Data。
robocopy $site $Target /MIR /XD .git App_Data /NFL /NDL /NJH /NP /R:2 /W:2
$rc = $LASTEXITCODE
# robocopy: 0-7 皆為成功（8 以上才是錯誤）
if ($rc -ge 8) { throw "robocopy 失敗（exit $rc）" }

Write-Host "`n完成。commit $sha 已同步到 $Target" -ForegroundColor Green
Write-Host "驗證：開 http://<站台>/Inspection/v2/systems/  應為 12 個系統，並有 /Inspection/v2/board/"
