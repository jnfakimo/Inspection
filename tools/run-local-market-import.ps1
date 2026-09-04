param(
    [string]$RuntimeRoot = 'C:\InspectionRuntime',
    [int]$Lookback = 3,
    [string]$From = '',
    [string]$To = ''
)
# -From/-To（YYYY-MM-DD）改為歷史回補：逐日抓取整段期間、每 7 天一個交易寫入內網資料庫，
# 逐代碼原始列另存到 market-import-logs\raw-rows。長期間請分段執行（一年約 40 分鐘）。

$ErrorActionPreference = 'Stop'
$runtime = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\')
$python = Join-Path $runtime 'market-import-venv\Scripts\python.exe'
$importer = Join-Path $runtime 'site-sync-source\tools\market_daily_import.py'
$logRoot = Join-Path $runtime 'market-import-logs'
if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $importer)) {
    throw '找不到行情匯入執行環境。'
}
if ($Lookback -lt 1 -or $Lookback -gt 7) { throw 'Lookback 必須介於 1 至 7。' }
if (($From -ne '') -ne ($To -ne '')) { throw '-From 與 -To 必須同時指定。' }
foreach ($value in @($From, $To)) {
    if ($value -ne '' -and $value -notmatch '^\d{4}-\d{2}-\d{2}$') { throw '日期格式須為 YYYY-MM-DD。' }
}
$importArgs = if ($From -ne '') {
    @('--from', $From, '--date', $To, '--raw-output', (Join-Path $logRoot ("raw-rows\$From" + '_' + $To)))
} else { @('--lookback', $Lookback) }
[IO.Directory]::CreateDirectory($logRoot) | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$sqlFile = Join-Path $logRoot "market-$stamp.sql"
$logFile = Join-Path $logRoot "market-$stamp.log"
$lock = $null
try {
    $lock = [IO.File]::Open((Join-Path $logRoot 'local-import.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    & $python -X utf8 $importer @importArgs --sql-output $sqlFile 2>&1 |
        Tee-Object -FilePath $logFile
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sqlFile)) {
        throw '北農來源抓取或驗證失敗；本機資料庫未寫入。'
    }
    $linuxSql = (& wsl.exe -d Ubuntu -u root -- wslpath -a $sqlFile.Replace('\','/')).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $linuxSql.StartsWith('/mnt/')) { throw '無法將匯入檔交給本機資料庫。' }
    & wsl.exe -d Ubuntu -u root -- bash -lc "docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres < '$linuxSql'" 2>&1 |
        Tee-Object -FilePath $logFile -Append
    if ($LASTEXITCODE -ne 0) { throw '本機資料庫拒絕匯入；交易已回滾。' }
    $latest = (& wsl.exe -d Ubuntu -u root -- docker exec supabase-db psql -U postgres -d postgres -Atc `
        "select max(observed_on)::text from public.market_data_points where source_id='9a2c1e61-6b8c-49f7-b001-202608300001';").Trim()
    if ($LASTEXITCODE -ne 0 -or $latest -notmatch '^\d{4}-\d{2}-\d{2}$') { throw '匯入後最新交易日驗證失敗。' }
    @{completed_at=(Get-Date).ToString('o');latest_observed_on=$latest;log=$logFile} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logRoot 'last-success.json') -Encoding UTF8
    Remove-Item -LiteralPath $sqlFile -Force
    Write-Output "本機行情匯入完成，最新交易日：$latest"
} catch {
    $_.Exception.Message | Set-Content -LiteralPath (Join-Path $logRoot 'last-error.txt') -Encoding UTF8
    throw
} finally {
    if ($lock) { $lock.Dispose() }
}
