# deploy-iis.ps1
# One-shot sync of the latest front-end to the on-prem IIS static site:
#   git pull  ->  npm run build:pages  ->  robocopy /MIR  _site  ->  <Target>
#
# Front-end static files only. Edge functions deploy automatically on push
# (GitHub Actions -> Supabase). Database migrations go through the GitHub
# workflow "Apply database migration".
#
# The build output is the hardened "_site\" folder (same content that GitHub
# Pages serves). The IIS "Inspection" application/vdir physical path maps to
# the URL "/Inspection/", so its "v2\" subfolder is "/Inspection/v2/".
#
# Usage:
#   .\tools\deploy-iis.ps1 -Target "C:\InspectionMigration\site"
#
#   -Target     IIS physical folder that serves "/Inspection/" (mirrored).
#   -SkipPull   skip "git pull" (when you already pulled).
#   -SkipBuild  skip the build (only re-copy an existing _site).

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

Write-Host "== on-prem IIS deploy ==" -ForegroundColor Cyan
Write-Host ("repo   : {0}" -f $repo)
Write-Host ("target : {0}" -f $Target)

if (-not (Test-Path -LiteralPath $Target)) {
  throw "Target folder not found: $Target"
}

# Sanity: make sure Target really is this site's folder before mirroring.
$looksRight = (Test-Path (Join-Path $Target 'v2\index.html')) -or
              (Test-Path (Join-Path $Target 'v2\_next'))      -or
              (Test-Path (Join-Path $Target 'index.html'))
if (-not $looksRight) {
  throw "Target does not look like the Inspection site folder (no v2\index.html / v2\_next / index.html). Check the path."
}

if (-not $SkipPull) {
  Write-Host ""
  Write-Host "[1/3] git pull --ff-only origin main" -ForegroundColor Yellow
  git fetch origin main
  git pull --ff-only origin main
} else {
  Write-Host ""
  Write-Host "[1/3] skip git pull" -ForegroundColor DarkGray
}
$sha = (git rev-parse --short HEAD).Trim()
Write-Host ("current commit: {0}" -f $sha)

if (-not $SkipBuild) {
  Write-Host ""
  Write-Host "[2/3] npm run build:pages" -ForegroundColor Yellow
  npm run build:pages
  if ($LASTEXITCODE -ne 0) { throw "build:pages failed (exit $LASTEXITCODE)" }
} else {
  Write-Host ""
  Write-Host "[2/3] skip build" -ForegroundColor DarkGray
}

$site = Join-Path $repo '_site'
if (-not (Test-Path (Join-Path $site 'v2\index.html'))) {
  throw "_site\v2\index.html is missing; the build did not complete."
}

Write-Host ""
Write-Host ("[3/3] mirror _site -> {0}  (robocopy /MIR)" -f $Target) -ForegroundColor Yellow
# /MIR removes files in Target that are not in _site (clears stale _next chunks).
# Keep a hand-placed web.config / IIS folders that the build does not produce.
robocopy $site $Target /MIR /XF web.config /XD .git App_Data aspnet_client /NFL /NDL /NJH /NP /R:2 /W:2
$rc = $LASTEXITCODE
# robocopy exit codes 0-7 are success; 8+ is a real error.
if ($rc -ge 8) { throw "robocopy failed (exit $rc)" }

Write-Host ""
Write-Host ("done. commit {0} synced to {1}" -f $sha, $Target) -ForegroundColor Green
Write-Host "verify: open http://<site>/Inspection/v2/systems/  -> should show 12 systems, and /Inspection/v2/board/ should load."
