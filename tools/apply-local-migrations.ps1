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

if ($MigrationFile) {
  $targetFiles = @(Join-Path $migrationsDir $MigrationFile)
} else {
  # Apply all migrations in order
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

$appliedCount = 0
foreach ($file in $targetFiles) {
  $leaf = Split-Path $file -Leaf
  Write-Host ("Applying: " + $leaf + " ...") -NoNewline
  
  $content = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
  $contentLf = $content.Replace("`r`n", "`n").Replace("`r", "`n")
  
  $tempSql = Join-Path $env:TEMP ('migration-' + [guid]::NewGuid().ToString('N') + '.sql')
  try {
    [IO.File]::WriteAllText($tempSql, $contentLf, (New-Object Text.UTF8Encoding($false)))
    $wslTemp = (& $wslCommand.Source --distribution $dist --user root --exec wslpath -a -u $tempSql).Trim()
    
    $execCmd = "docker exec -i $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 < $wslTemp 2>&1"
    $output = @(& $wslCommand.Source --distribution $dist --user root --exec sh -c "$execCmd")
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -ne 0) {
      Write-Host " [FAILED]" -ForegroundColor Red
      $output | ForEach-Object { Write-Host $_ }
      throw ("Migration failed: " + $leaf)
    } else {
      Write-Host " [OK]" -ForegroundColor Green
      $appliedCount++
    }
  } finally {
    Remove-Item -LiteralPath $tempSql -Force -ErrorAction SilentlyContinue
  }
}

# Reload PostgREST schema cache
Write-Host "Reloading PostgREST schema cache..." -NoNewline
$reloadCmd = 'docker exec -i ' + $dbContainer + ' psql -U postgres -d postgres -c "NOTIFY pgrst, ''reload schema'';"'
& $wslCommand.Source --distribution $dist --user root --exec sh -c "$reloadCmd" | Out-Null
Write-Host " [OK]" -ForegroundColor Green

Write-Host ("Successfully applied " + $appliedCount + " migration(s).") -ForegroundColor Green
