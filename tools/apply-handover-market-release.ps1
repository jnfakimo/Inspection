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

$dependencyCommit = '5e351771cfceeb6b5babb0eb221090db90a523cf'
$baseUrl = "https://raw.githubusercontent.com/jnfakimo/Inspection/$dependencyCommit"
$releaseRoot = Join-Path $env:TEMP 'Inspection-handover-market-release-5e351771c'
$migrationsDir = Join-Path $releaseRoot 'supabase\migrations'
$runnerPath = Join-Path $releaseRoot 'tools\apply-local-migrations.ps1'

$files = @(
  @{ Relative = 'tools/apply-local-migrations.ps1'; Hash = '61A35AE9B9E0FD7817585EEFF393DC3E8CB16344457F41F0CEB0B9C2046B7259' },
  @{ Relative = 'supabase/migrations/20260911150000_guard_handover.sql'; Hash = '289DA40FC394D3200CA21782251F6B51797E8B476DD8812BAFBB25EAB25D1701' },
  @{ Relative = 'supabase/migrations/20260911160000_guard_handover_insert_lock.sql'; Hash = 'F2B5F58392377281F74CE02CCFFE763A362BB0CC947708DD5FE0AB919A3DEF90' },
  @{ Relative = 'supabase/migrations/20260911170000_guard_handover_attachments.sql'; Hash = '68C67AE535C68534C6582541900EEA576D63CB714B9C4CC701E2BABE7DFBAEA4' },
  @{ Relative = 'supabase/migrations/20260911180000_guard_handover_options.sql'; Hash = '3EA9D3223A7F75916BF89385EDDA69985B0B9085C989FE764E7386BE1B560676' },
  @{ Relative = 'supabase/migrations/20260916110000_guard_handover_designated_receiver.sql'; Hash = '41A2C3386DD9B7E9501D87949E890CA94DB5C378382615BBD6BFCD38BE4275F0' },
  @{ Relative = 'supabase/migrations/20260916120000_handover_market_keys.sql'; Hash = '989465CE64B1A88946AE0B620DAC747F1B90E8015EA78BC57A1F826B0AEC66A4' },
  @{ Relative = 'supabase/migrations/20260916131000_mechanical_handover_market.sql'; Hash = 'F4BEB2A6D2BCA8357F2EED36532B2D9937D8EDCC1190DEC5B575614FFA24E77A' },
  @{ Relative = 'supabase/migrations/20260916132000_business_handover_market.sql'; Hash = 'FC6273646C244F3832EF4589F6888DC06E1B86289F6F9679C8A077B4EC344747' },
  @{ Relative = 'supabase/migrations/20260916170000_business_handover_market_policy_grants.sql'; Hash = '40CC0ED0D77ECA40A4A90BC8EF60D454669B37C224205D0E2B69DA449E912F30' },
  @{ Relative = 'supabase/migrations/20260916190000_business_handover_complete_without_receipt.sql'; Hash = 'D750C0CB8D1F93E33DE5CE96A4404090A12891C553E210D4B6B8C64EDA69651B' }
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

# Resolve the local database once, then verify every prerequisite that is not
# created by this release. This read-only gate runs before the first migration,
# so an incomplete on-premises baseline cannot leave a partially applied release.
$wslCommand = Get-Command wsl.exe -ErrorAction Stop
$distributions = @(& $wslCommand.Source --list --quiet | ForEach-Object {
    ($_ -replace "`0", '').Trim()
  } | Where-Object { $_ -and $_ -notmatch '^docker-desktop(?:-data)?$' })
if ($distributions.Count -eq 0) {
  throw 'No application WSL distribution found. No migration was started.'
}
$dist = $distributions[0]
$findContainerScript = 'docker ps --format "{{.Names}}" | grep -E "supabase[-_]db" | head -1'
$dbContainer = (& $wslCommand.Source --distribution $dist --user root --exec sh -c "$findContainerScript").Trim()
if (-not $dbContainer) {
  throw 'No running Supabase PostgreSQL database container found. No migration was started.'
}

$preflightSql = @'
do $preflight$
declare
  missing text[] := '{}';
  relation_name text;
  function_name text;
begin
  foreach relation_name in array array[
    'public.users','public.departments','public.user_handover_module_access',
    'public.user_system_access','public.role_permissions','public.user_module_access','public.role_module_access',
    'public.business_handover_entries','public.business_handover_approvals',
    'public.business_handover_transfers','public.business_handover_completions',
    'public.mechanical_handover_entries','public.mechanical_handover_signatures',
    'public.mechanical_handover_daily_approvals','public.mechanical_handover_transfers',
    'public.mechanical_staff_market_scopes','public.patrol_shift_template','public.patrol_shifts',
    'public.patrol_shift_day_status','public.plan_markers','public.checkin_logs','storage.buckets'
  ] loop
    if to_regclass(relation_name) is null then missing := array_append(missing,relation_name); end if;
  end loop;
  foreach function_name in array array[
    'public.reject_physical_data_removal()','public.has_handover_module_access(text)',
    'public.active_user_id()','public.active_rbac_role()',
    'public.can_approve_mechanical_handover()','public.business_receiver_allowed(uuid)',
    'public.business_shift_start(date,text)'
  ] loop
    if to_regprocedure(function_name) is null then missing := array_append(missing,function_name); end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'on-premises prerequisite objects are missing: %',array_to_string(missing,', ');
  end if;
end
$preflight$;
select 'HANDOVER_MARKET_PREFLIGHT_OK';
'@
$preflightPath = Join-Path $env:TEMP ('preflight-handover-market-' + [guid]::NewGuid().ToString('N') + '.sql')
try {
  [IO.File]::WriteAllText($preflightPath, $preflightSql, (New-Object Text.UTF8Encoding($false)))
  $wslPreflightPath = (& $wslCommand.Source --distribution $dist --user root --exec wslpath -a -u $preflightPath).Trim()
  $preflightCommand = "docker exec -u postgres -i $dbContainer psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < $wslPreflightPath 2>&1"
  $preflightOutput = @(& $wslCommand.Source --distribution $dist --user root --exec sh -c "$preflightCommand")
  if ($LASTEXITCODE -ne 0 -or ($preflightOutput -join "`n") -notmatch 'HANDOVER_MARKET_PREFLIGHT_OK') {
    $preflightOutput | ForEach-Object { Write-Host $_ }
    throw 'On-premises prerequisite verification failed. No migration was started.'
  }
} finally {
  Remove-Item -LiteralPath $preflightPath -Force -ErrorAction SilentlyContinue
}

$migrations = @(
  '20260911150000_guard_handover.sql',
  '20260911160000_guard_handover_insert_lock.sql',
  '20260911170000_guard_handover_attachments.sql',
  '20260911180000_guard_handover_options.sql',
  '20260916110000_guard_handover_designated_receiver.sql',
  '20260916120000_handover_market_keys.sql',
  '20260916131000_mechanical_handover_market.sql',
  '20260916132000_business_handover_market.sql',
  '20260916170000_business_handover_market_policy_grants.sql',
  '20260916190000_business_handover_complete_without_receipt.sql'
)

foreach ($migration in $migrations) {
  Write-Host ("Applying reviewed migration: " + $migration) -ForegroundColor Cyan
  & $runnerPath -MigrationFile $migration -Apply
}

# Verify the actual schema and migration history. The success banner is printed
# only after these checks pass.
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

  if not has_function_privilege('authenticated','public.business_market_allowed(text)','EXECUTE') then
    raise exception 'authenticated is missing EXECUTE on business_market_allowed(text)';
  end if;

  if position('先完成接班確認再登記完成' in pg_get_functiondef('public.business_market_action(text,text,date,text,uuid,uuid,text)'::regprocedure)) > 0
    or position('請由本班指定接班人先確認接班' in pg_get_functiondef('public.business_market_action(text,text,date,text,uuid,uuid,text)'::regprocedure)) > 0 then
    raise exception 'business completion still requires receipt confirmation';
  end if;

  select count(distinct version) into applied_versions
  from supabase_migrations.schema_migrations
  where version in ('20260911150000','20260911160000','20260911170000','20260911180000',
    '20260916110000','20260916120000','20260916131000','20260916132000','20260916170000','20260916190000');
  if applied_versions <> 10 then
    raise exception 'handover market release history is incomplete: % of 10', applied_versions;
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
