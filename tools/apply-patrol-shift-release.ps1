# Applies the reviewed patrol-shift release to the on-premises Supabase database.
# Windows PowerShell 5.1 compatible; all downloaded files are pinned and hashed.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$targetAddress = '192.168.50.192'
$isTargetHost = @(
  [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
    Where-Object { $_.Address.ToString() -eq $targetAddress }
).Count -gt 0
if (-not $isTargetHost) {
  throw "This release must run on the on-premises server $targetAddress. No database changes were made."
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator PowerShell is required. No database changes were made.'
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dependencyCommit = '8e1e1595d07bc1253e0e68a15b616d06f27d1985'
$baseUrl = "https://raw.githubusercontent.com/jnfakimo/Inspection/$dependencyCommit"
$releaseRoot = Join-Path $env:TEMP 'Inspection-patrol-release-e8134924'
$migrationRoot = Join-Path $releaseRoot 'supabase\migrations'
$runnerPath = Join-Path $releaseRoot 'tools\apply-local-migrations.ps1'

$files = @(
  @{ Relative = 'tools/apply-local-migrations.ps1'; Hash = 'D14D8E7A5EE33631396A2F879769D3D4A80D009C6350CAB1A8680378CF07EB38' },
  @{ Relative = 'supabase/migrations/20260914170000_patrol_shift_bulk_reset.sql'; Hash = '25CF21ACDDDC26DA8A53FA944B4D8D821668CFE97C5B59AA87C8B96ADF80E8BC' },
  @{ Relative = 'supabase/migrations/20260914171000_patrol_shift_apply_all_templates.sql'; Hash = '0BE1D9A681A7704996F95A65C06DDDED3BFBC1BB04A2ED8F800A6C41ABCFB946' },
  @{ Relative = 'supabase/migrations/20260914172000_patrol_shift_day_status.sql'; Hash = '13B3DFCB259F58542C42884E6EACA6FB8F69DED2B1C68076275A06106CACF368' }
)

foreach ($file in $files) {
  $relativeWindows = $file.Relative.Replace('/', '\')
  $destination = Join-Path $releaseRoot $relativeWindows
  [IO.Directory]::CreateDirectory((Split-Path $destination -Parent)) | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$($file.Relative)" -OutFile $destination
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash
  if ($actualHash -ne $file.Hash) {
    throw "Downloaded file hash mismatch: $($file.Relative). No migration was started."
  }
}

$migrations = @(
  '20260914170000_patrol_shift_bulk_reset.sql',
  '20260914171000_patrol_shift_apply_all_templates.sql',
  '20260914172000_patrol_shift_day_status.sql'
)
foreach ($migration in $migrations) {
  & $runnerPath -MigrationFile $migration -Apply
}

$verificationName = '20260914179999_verify_patrol_shift_release.sql'
$verificationPath = Join-Path $migrationRoot $verificationName
$verificationSql = @'
do $$
begin
  if to_regclass('public.patrol_shift_day_status') is null
    or to_regprocedure('public.soft_delete_patrol_shifts_from_date(date,uuid[])') is null
    or to_regprocedure('public.apply_all_patrol_shift_templates_range(date,date)') is null
    or to_regprocedure('public.set_patrol_shift_day_status(date,boolean,text)') is null
    or to_regprocedure('public.reset_patrol_shifts_from_date(date,uuid[])') is null
    or to_regprocedure('public.apply_all_patrol_shift_templates_and_activate(date,date)') is null then
    raise exception 'patrol shift release verification failed';
  end if;
end
$$;
'@
[IO.File]::WriteAllText($verificationPath, $verificationSql, (New-Object Text.UTF8Encoding($false)))
& $runnerPath -MigrationFile $verificationName -Apply

Write-Host 'On-premises patrol-shift database release verified successfully.' -ForegroundColor Green
