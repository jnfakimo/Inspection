# ASCII-only for Windows PowerShell 5.1 compatibility.
# Applies the reviewed handover receiver/market release to the on-premises host.

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
  throw "This release must run on $targetAddress. No database changes were made."
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator PowerShell is required. No database changes were made.'
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dependencyCommit = '4375a1a64abcba490b49edee1e0bfbfc58cf49b7'
$baseUrl = "https://raw.githubusercontent.com/jnfakimo/Inspection/$dependencyCommit"
$releaseRoot = Join-Path $env:TEMP 'Inspection-handover-market-release-4375a1a64'
$migrationsDir = Join-Path $releaseRoot 'supabase\migrations'
$runnerPath = Join-Path $releaseRoot 'tools\apply-local-migrations.ps1'

$files = @(
  @{ Relative = 'tools/apply-local-migrations.ps1'; Hash = '61A35AE9B9E0FD7817585EEFF393DC3E8CB16344457F41F0CEB0B9C2046B7259' },
  @{ Relative = 'supabase/migrations/20260916110000_guard_handover_designated_receiver.sql'; Hash = '41A2C3386DD9B7E9501D87949E890CA94DB5C378382615BBD6BFCD38BE4275F0' },
  @{ Relative = 'supabase/migrations/20260916120000_handover_market_keys.sql'; Hash = '989465CE64B1A88946AE0B620DAC747F1B90E8015EA78BC57A1F826B0AEC66A4' },
  @{ Relative = 'supabase/migrations/20260916131000_mechanical_handover_market.sql'; Hash = 'F4BEB2A6D2BCA8357F2EED36532B2D9937D8EDCC1190DEC5B575614FFA24E77A' },
  @{ Relative = 'supabase/migrations/20260916132000_business_handover_market.sql'; Hash = 'FC6273646C244F3832EF4589F6888DC06E1B86289F6F9679C8A077B4EC344747' }
)

[IO.Directory]::CreateDirectory($migrationsDir) | Out-Null
[IO.Directory]::CreateDirectory((Split-Path $runnerPath -Parent)) | Out-Null

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
  '20260916110000_guard_handover_designated_receiver.sql',
  '20260916120000_handover_market_keys.sql',
  '20260916131000_mechanical_handover_market.sql',
  '20260916132000_business_handover_market.sql'
)

foreach ($migration in $migrations) {
  Write-Host ("Applying reviewed migration: " + $migration) -ForegroundColor Cyan
  & $runnerPath -MigrationFile $migration -Apply
}

# Verify the actual schema and migration history through the local PostgreSQL
# container. The success banner is printed only after these checks pass.
$wslCommand = Get-Command wsl.exe -ErrorAction Stop
$distributions = @(& $wslCommand.Source --list --quiet | ForEach-Object {
    ($_ -replace "`0", '').Trim()
  } | Where-Object { $_ -and $_ -notmatch '^docker-desktop(?:-data)?$' })
if ($distributions.Count -eq 0) {
  throw 'No application WSL distribution found during verification.'
}
$dist = $distributions[0]
$findContainerScript = 'docker ps --format "{{.Names}}" | grep -E "supabase[-_]db" | head -1'
$dbContainer = (& $wslCommand.Source --distribution $dist --user root --exec sh -c "$findContainerScript").Trim()
if (-not $dbContainer) {
  throw 'No running Supabase PostgreSQL database container found during verification.'
}

$verificationSql = @'
do $verify$
declare
  missing_columns integer;
  applied_versions integer;
begin
  select count(*) into missing_columns
  from (values
    ('guard_handover_logs','receiver_id'),
    ('guard_handover_logs','market_code'),
    ('business_handover_entries','market_code'),
    ('business_handover_approvals','market_code'),
    ('business_handover_transfers','market_code'),
    ('guard_handover_daily_approvals','market_code'),
    ('guard_handover_attachments','market_code'),
    ('mechanical_handover_entries','market_code'),
    ('mechanical_handover_signatures','market_code'),
    ('mechanical_handover_daily_approvals','market_code'),
    ('mechanical_handover_transfers','market_code'),
    ('patrol_shift_template','market_code'),
    ('patrol_shifts','market_code'),
    ('patrol_shift_day_status','market_code'),
    ('plan_markers','market_code'),
    ('checkin_logs','market_code')
  ) expected(table_name,column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public'
      and c.table_name=expected.table_name
      and c.column_name=expected.column_name
  );
  if missing_columns <> 0 then
    raise exception 'handover market release verification found % missing columns', missing_columns;
  end if;

  if to_regprocedure('public.guard_handover_receivers()') is null
    or to_regprocedure('public.handover_staff_market(uuid,text)') is null
    or to_regprocedure('public.handover_staff_markets(uuid,text)') is null
    or to_regprocedure('public.mechanical_market_allowed(text)') is null
    or to_regprocedure('public.mechanical_market_receivers(text)') is null
    or to_regprocedure('public.business_market_allowed(text)') is null
    or to_regprocedure('public.business_market_receivers(text)') is null
    or to_regprocedure('public.business_market_day(text,date)') is null then
    raise exception 'handover market release verification found missing functions';
  end if;

  select count(distinct version) into applied_versions
  from supabase_migrations.schema_migrations
  where version in ('20260916110000','20260916120000','20260916131000','20260916132000');
  if applied_versions <> 4 then
    raise exception 'handover market release history is incomplete: % of 4', applied_versions;
  end if;
end
$verify$;
select 'HANDOVER_MARKET_RELEASE_VERIFIED';
'@

$verificationPath = Join-Path $env:TEMP ('verify-handover-market-' + [guid]::NewGuid().ToString('N') + '.sql')
try {
  [IO.File]::WriteAllText($verificationPath, $verificationSql, (New-Object Text.UTF8Encoding($false)))
  $wslVerificationPath = (& $wslCommand.Source --distribution $dist --user root --exec wslpath -a -u $verificationPath).Trim()
  $verifyCommand = "docker exec -u postgres -i $dbContainer psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < $wslVerificationPath 2>&1"
  $verificationOutput = @(& $wslCommand.Source --distribution $dist --user root --exec sh -c "$verifyCommand")
  if ($LASTEXITCODE -ne 0 -or ($verificationOutput -join "`n") -notmatch 'HANDOVER_MARKET_RELEASE_VERIFIED') {
    $verificationOutput | ForEach-Object { Write-Host $_ }
    throw 'On-premises handover market release verification failed.'
  }
} finally {
  Remove-Item -LiteralPath $verificationPath -Force -ErrorAction SilentlyContinue
}

Write-Host 'ON-PREMISES HANDOVER MARKET RELEASE VERIFIED SUCCESSFULLY.' -ForegroundColor Green
Write-Host ("Release commit: " + $dependencyCommit) -ForegroundColor Green
