# UTF-8 BOM is not used; pure ASCII only for Windows PowerShell 5.1 compatibility.
# Applies pending idempotent SQL migrations to the local PostgreSQL database on 192.168.50.192.

[CmdletBinding()]
param(
  [string]$MigrationFile = '',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$migrationsDir = Join-Path $repo 'supabase\migrations'

if (-not (Test-Path -LiteralPath $migrationsDir)) {
  throw "Migrations directory not found: $migrationsDir"
}

$wslCommand = Get-Command wsl.exe -ErrorAction Stop
$distributions = @(& $wslCommand.Source --list --quiet | ForEach-Object {
    ($_ -replace "`0", '').Trim()
} | Where-Object { $_ -and $_ -notmatch '^docker-desktop(?:-data)?$' })

if ($distributions.Count -eq 0) {
  throw 'No application WSL distribution found.'
}
$dist = $distributions[0]
Write-Host ("Target WSL distribution: " + $dist) -ForegroundColor Cyan

# Find running db container
$findContainerScript = 'docker ps --format "{{.Names}}" | grep -E "supabase[-_]db" | head -1'
$dbContainer = (& $wslCommand.Source --distribution $dist --user root --exec sh -c "$findContainerScript").Trim()

if (-not $dbContainer) {
  throw 'No running Supabase PostgreSQL database container found in WSL.'
}
Write-Host ("Found database container: " + $dbContainer) -ForegroundColor Green

# Select a login role that already has the least set of privileges required by
# these incremental migrations. Never broaden schema permissions to make a
# hard-coded role work: this self-hosted stack owns public with supabase_admin.
$roleSql = @'
select r.rolname
from pg_roles r
where r.rolcanlogin
  and has_schema_privilege(r.rolname, 'public', 'CREATE')
  and has_table_privilege(r.rolname, 'public.patrol_shifts', 'SELECT')
  and has_table_privilege(r.rolname, 'public.patrol_shifts', 'UPDATE')
  and has_table_privilege(r.rolname, 'public.audit_logs', 'INSERT')
  and has_table_privilege(r.rolname, 'public.users', 'SELECT')
order by r.rolsuper desc,
  case when r.rolname = 'supabase_admin' then 0 else 1 end,
  r.rolname
limit 1;
'@
$roleTemp = Join-Path $env:TEMP ('migration-role-' + [guid]::NewGuid().ToString('N') + '.sql')
try {
  [IO.File]::WriteAllText($roleTemp, $roleSql, (New-Object Text.UTF8Encoding($false)))
  $wslRole = (& $wslCommand.Source --distribution $dist --user root --exec wslpath -a -u $roleTemp).Trim()
  $roleCmd = "docker exec -u postgres -i $dbContainer psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atq < $wslRole 2>&1"
  $roleOutput = @(& $wslCommand.Source --distribution $dist --user root --exec sh -c "$roleCmd")
  if ($LASTEXITCODE -ne 0) { throw ($roleOutput -join [Environment]::NewLine) }
  $migrationRole = @($roleOutput | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*$' }) | Select-Object -First 1
} finally {
  Remove-Item -LiteralPath $roleTemp -Force -ErrorAction SilentlyContinue
}
if (-not $migrationRole) {
  throw 'No login role has the required schema and table privileges. No migration was started.'
}
Write-Host ("Migration database role: " + $migrationRole) -ForegroundColor Green

if ($MigrationFile) {
  $targetFiles = @(Join-Path $migrationsDir $MigrationFile)
} else {
  $targetFiles = @(Get-ChildItem -LiteralPath $migrationsDir -Filter '*.sql' | Sort-Object Name | ForEach-Object { $_.FullName })
}

Write-Host ("Found " + $targetFiles.Count + " migration file(s).")

if (-not $Apply) {
  Write-Host "DRY RUN: Pass -Apply to execute migrations on local database." -ForegroundColor Yellow
  foreach ($f in $targetFiles) {
    Write-Host ("  [plan] " + (Split-Path $f -Leaf))
  }
  exit 0
}

# Step 0: Verify the selected existing role. Do not change schema ownership or
# grant broad permissions as a migration workaround.
Write-Host "Verifying migration database role..." -NoNewline
$initSql = @'
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE')
    or not has_table_privilege(current_user, 'public.patrol_shifts', 'SELECT')
    or not has_table_privilege(current_user, 'public.patrol_shifts', 'UPDATE')
    or not has_table_privilege(current_user, 'public.audit_logs', 'INSERT')
    or not has_table_privilege(current_user, 'public.users', 'SELECT') then
    raise exception 'migration role privileges are incomplete';
  end if;
end
$$;
'@
$initTemp = Join-Path $env:TEMP ('init-perms-' + [guid]::NewGuid().ToString('N') + '.sql')
try {
  [IO.File]::WriteAllText($initTemp, $initSql, (New-Object Text.UTF8Encoding($false)))
  $wslInit = (& $wslCommand.Source --distribution $dist --user root --exec wslpath -a -u $initTemp).Trim()
  $initCmd = "docker exec -u postgres -i $dbContainer psql -v ON_ERROR_STOP=1 -U $migrationRole -d postgres < $wslInit 2>&1"
  & $wslCommand.Source --distribution $dist --user root --exec sh -c "$initCmd" | Out-Null
  Write-Host " [OK]" -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $initTemp -Force -ErrorAction SilentlyContinue
}

$appliedCount = 0
foreach ($file in $targetFiles) {
  $leaf = Split-Path $file -Leaf
  $migrationMatch = [regex]::Match($leaf, '^(?<version>[0-9]{14})_(?<name>[a-z0-9_]+)\.sql$')
  if (-not $migrationMatch.Success) {
    throw ("Invalid migration file name: " + $leaf)
  }
  Write-Host ("Applying: " + $leaf + " ...") -NoNewline
  
  $content = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
  $fullSql = "SET search_path = public, extensions;`n" + $content
  $contentLf = $fullSql.Replace("`r`n", "`n").Replace("`r", "`n")
  
  $tempSql = Join-Path $env:TEMP ('migration-' + [guid]::NewGuid().ToString('N') + '.sql')
  try {
    [IO.File]::WriteAllText($tempSql, $contentLf, (New-Object Text.UTF8Encoding($false)))
    $wslTemp = (& $wslCommand.Source --distribution $dist --user root --exec wslpath -a -u $tempSql).Trim()
    
    $execCmd = "docker exec -u postgres -i $dbContainer psql -v ON_ERROR_STOP=1 -U $migrationRole -d postgres < $wslTemp 2>&1"
    $output = @(& $wslCommand.Source --distribution $dist --user root --exec sh -c "$execCmd")
    $exitCode = $LASTEXITCODE
    
    # Filter non-fatal already exists/duplicate notice lines
    $hasFatalError = $false
    foreach ($line in $output) {
      if ($line -match '^ERROR:\s+' -and $line -notmatch 'already exists|duplicate key|canceling statement') {
        $hasFatalError = $true
      }
    }
    
    if ($exitCode -ne 0 -or $hasFatalError) {
      Write-Host " [FAILED]" -ForegroundColor Red
      $output | ForEach-Object { Write-Host $_ }
      throw ("Migration failed: " + $leaf)
    } else {
      # Record only migrations that psql completed successfully. This keeps the
      # self-hosted schema history truthful and prevents later inventory checks
      # from reporting an already-applied release as missing.
      $version = $migrationMatch.Groups['version'].Value
      $migrationName = $migrationMatch.Groups['name'].Value
      $historySql = "insert into supabase_migrations.schema_migrations(version,name,created_by) values ('$version','$migrationName','codex-local-runner') on conflict(version) do nothing;`n"
      $historyTemp = Join-Path $env:TEMP ('migration-history-' + [guid]::NewGuid().ToString('N') + '.sql')
      try {
        [IO.File]::WriteAllText($historyTemp, $historySql, (New-Object Text.UTF8Encoding($false)))
        $wslHistory = (& $wslCommand.Source --distribution $dist --user root --exec wslpath -a -u $historyTemp).Trim()
        $historyCmd = "docker exec -u postgres -i $dbContainer psql -v ON_ERROR_STOP=1 -U $migrationRole -d postgres < $wslHistory 2>&1"
        $historyOutput = @(& $wslCommand.Source --distribution $dist --user root --exec sh -c "$historyCmd")
        if ($LASTEXITCODE -ne 0) {
          Write-Host " [HISTORY FAILED]" -ForegroundColor Red
          $historyOutput | ForEach-Object { Write-Host $_ }
          throw ("Migration succeeded but history recording failed: " + $leaf)
        }
      } finally {
        Remove-Item -LiteralPath $historyTemp -Force -ErrorAction SilentlyContinue
      }
      Write-Host " [OK]" -ForegroundColor Green
      $appliedCount++
    }
  } finally {
    Remove-Item -LiteralPath $tempSql -Force -ErrorAction SilentlyContinue
  }
}

# Reload PostgREST schema cache
Write-Host "Reloading PostgREST schema cache..." -NoNewline
$reloadTemp = Join-Path $env:TEMP ('reload-pgrst-' + [guid]::NewGuid().ToString('N') + '.sql')
try {
  [IO.File]::WriteAllText($reloadTemp, "NOTIFY pgrst, 'reload schema';`n", (New-Object Text.UTF8Encoding($false)))
  $wslReload = (& $wslCommand.Source --distribution $dist --user root --exec wslpath -a -u $reloadTemp).Trim()
  $reloadCmd = "docker exec -u postgres -i $dbContainer psql -v ON_ERROR_STOP=1 -U $migrationRole -d postgres < $wslReload 2>&1"
  $reloadOutput = @(& $wslCommand.Source --distribution $dist --user root --exec sh -c "$reloadCmd")
  if ($LASTEXITCODE -ne 0) {
    Write-Host " [FAILED]" -ForegroundColor Red
    $reloadOutput | ForEach-Object { Write-Host $_ }
    throw 'PostgREST schema cache reload failed.'
  }
  Write-Host " [OK]" -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $reloadTemp -Force -ErrorAction SilentlyContinue
}

Write-Host ("Successfully applied " + $appliedCount + " migration(s).") -ForegroundColor Green
