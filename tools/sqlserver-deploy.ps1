[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDir,
  [string]$Server = 'localhost',
  [string]$Database = 'InspectionLocal',
  [string]$SchemaName = 'app_final',
  [string]$BackupId = '',
  [switch]$ImportStorage,
  [string]$StorageRoot = 'C:\InspectionMigration\local-storage'
)

$ErrorActionPreference = 'Stop'

function Quote-SqlIdentifier([string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name) -or $Name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    throw "不接受的 SQL 識別字：$Name"
  }
  return '[' + $Name.Replace(']', ']]') + ']'
}

function Get-JsonValueKind($Value) {
  if ($null -eq $Value) { return 'null' }
  if ($Value -is [bool]) { return 'bit' }
  if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32]) { return 'int' }
  if ($Value -is [int64]) { return 'bigint' }
  if ($Value -is [decimal] -or $Value -is [double] -or $Value -is [single]) {
    $number = [decimal]$Value
    return $(if ($number -eq [decimal]::Truncate($number)) { 'bigint' } else { 'decimal' })
  }
  if ($Value -is [System.Collections.IDictionary] -or $Value -is [pscustomobject] -or ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string])) {
    return 'json'
  }
  $text = [string]$Value
  if ($text -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { return 'uniqueidentifier' }
  if ($text -match '^\d{4}-\d{2}-\d{2}$') {
    try { [void][DateTime]::ParseExact($text, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture); return 'date' } catch {}
  }
  if ($text -match '^\d{4}-\d{2}-\d{2}T') {
    try { [void][DateTimeOffset]::Parse($text, [Globalization.CultureInfo]::InvariantCulture); return 'datetimeoffset' } catch {}
  }
  return 'nvarchar'
}

function Merge-ColumnKind([string]$Current, [string]$Next) {
  if ($Next -eq 'null') { return $Current }
  if ([string]::IsNullOrEmpty($Current) -or $Current -eq 'null') { return $Next }
  if ($Current -eq $Next) { return $Current }
  if (($Current -in @('int','bigint')) -and ($Next -in @('int','bigint'))) { return 'bigint' }
  if (($Current -in @('int','bigint','decimal')) -and ($Next -in @('int','bigint','decimal'))) { return 'decimal' }
  return 'nvarchar'
}

function Sql-Type([string]$Kind) {
  switch ($Kind) {
    'bit' { return 'bit' }
    'int' { return 'int' }
    'bigint' { return 'bigint' }
    'decimal' { return 'decimal(38,10)' }
    'uniqueidentifier' { return 'uniqueidentifier' }
    'date' { return 'date' }
    'datetimeoffset' { return 'datetimeoffset(7)' }
    default { return 'nvarchar(max)' }
  }
}

function New-ClrColumn([string]$Kind) {
  switch ($Kind) {
    'bit' { return [bool] }
    'int' { return [int] }
    'bigint' { return [long] }
    'decimal' { return [decimal] }
    'uniqueidentifier' { return [Guid] }
    'date' { return [DateTime] }
    'datetimeoffset' { return [DateTimeOffset] }
    default { return [string] }
  }
}

function Convert-Value($Value, [string]$Kind) {
  if ($null -eq $Value) { return [DBNull]::Value }
  switch ($Kind) {
    'bit' { return [bool]$Value }
    'int' { return [int]$Value }
    'bigint' { return [long]$Value }
    'decimal' { return [decimal]$Value }
    'uniqueidentifier' { return [Guid]::Parse([string]$Value) }
    'date' { return [DateTime]::ParseExact([string]$Value, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture) }
    'datetimeoffset' { return [DateTimeOffset]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture) }
    'json' { return ($Value | ConvertTo-Json -Compress -Depth 30) }
    default { return [string]$Value }
  }
}

if (-not (Test-Path -LiteralPath $BackupDir -PathType Container)) { throw "找不到備份目錄：$BackupDir" }
$manifestPath = Join-Path $BackupDir 'manifest.json'
$tablesDir = Join-Path $BackupDir 'tables'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "找不到 manifest.json：$manifestPath" }
if (-not (Test-Path -LiteralPath $tablesDir -PathType Container)) { throw "找不到 tables 目錄：$tablesDir" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($SchemaName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "不接受的 schema 名稱：$SchemaName" }
$qSchema = Quote-SqlIdentifier $SchemaName
if ([string]::IsNullOrWhiteSpace($BackupId)) {
  $BackupId = [IO.Path]::GetFileName($BackupDir).Replace('inspection-backup-', '')
  if ([string]::IsNullOrWhiteSpace($BackupId) -or $BackupId -eq 'extracted') { $BackupId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') }
}

Write-Output "驗證備份：$BackupDir"
$tableFiles = @()
foreach ($table in @($manifest.tables)) {
  $file = Join-Path $tablesDir ("{0}.ndjson" -f $table.name)
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "備份缺少資料表檔案：$($table.name)" }
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne ([string]$table.sha256).ToLowerInvariant()) { throw "SHA-256 不符，拒絕部署：$($table.name)" }
  $lineCount = if ((Get-Item -LiteralPath $file).Length -eq 0) { 0 } else { @(Get-Content -LiteralPath $file -Encoding UTF8).Count }
  if ($lineCount -ne [int]$table.rows) { throw "行數不符，拒絕部署：$($table.name)" }
  $tableFiles += $file
}
if ([int]$manifest.totals.tables -ne $tableFiles.Count -or [int64]$manifest.totals.rows -ne ($manifest.tables | Measure-Object -Property rows -Sum).Sum) {
  throw 'manifest 總表數／列數不一致，拒絕部署。'
}
Write-Output ("備份驗證通過：{0} 張表、{1} 列" -f $manifest.totals.tables, $manifest.totals.rows)

$connectionString = "Server=$Server;Database=$Database;Integrated Security=True;TrustServerCertificate=True;"
$connection = New-Object System.Data.SqlClient.SqlConnection $connectionString
$connection.Open()
try {
  $bootstrap = $connection.CreateCommand()
  $bootstrap.CommandText = @"
IF SCHEMA_ID(N'$SchemaName') IS NULL EXEC(N'CREATE SCHEMA $qSchema');
IF OBJECT_ID(N'$SchemaName.MigrationTables', N'U') IS NULL
BEGIN
  CREATE TABLE $qSchema.[MigrationTables](
    [BackupId] nvarchar(160) NOT NULL,
    [SourceTable] sysname NOT NULL,
    [LoadedRowCount] bigint NOT NULL,
    [SchemaJson] nvarchar(max) NOT NULL,
    [LoadedAtUtc] datetime2(7) NOT NULL,
    CONSTRAINT [PK_MigrationTables] PRIMARY KEY ([BackupId],[SourceTable])
  );
END;
"@
  [void]$bootstrap.ExecuteNonQuery()

  $tableIndex = 0
  foreach ($file in $tableFiles) {
    $sourceTable = [IO.Path]::GetFileNameWithoutExtension($file)
    $rows = @()
    foreach ($line in (Get-Content -LiteralPath $file -Encoding UTF8)) {
      if (-not [string]::IsNullOrWhiteSpace($line)) { $rows += ($line | ConvertFrom-Json) }
    }
    $properties = New-Object System.Collections.Generic.List[string]
    $kinds = @{}
    foreach ($row in $rows) {
      foreach ($property in $row.PSObject.Properties) {
        if (-not $properties.Contains($property.Name)) { [void]$properties.Add($property.Name); $kinds[$property.Name] = 'null' }
        $kinds[$property.Name] = Merge-ColumnKind $kinds[$property.Name] (Get-JsonValueKind $property.Value)
      }
    }
    foreach ($property in @($properties)) { if ($kinds[$property] -eq 'null') { $kinds[$property] = 'nvarchar' } }
    $schemaDescription = ($properties | ForEach-Object { [ordered]@{ name = $_; kind = $kinds[$_] ; sql_type = (Sql-Type $kinds[$_]) } } | ConvertTo-Json -Compress -Depth 6)
    if ([string]::IsNullOrWhiteSpace($schemaDescription)) { $schemaDescription = '[]' }
    $qTable = Quote-SqlIdentifier $sourceTable
    $columnDefs = @($properties | ForEach-Object { "$(Quote-SqlIdentifier $_) $(Sql-Type $kinds[$_]) NULL" })
    $columnDefs += '[_MigrationBackupId] nvarchar(160) NOT NULL'
    $columnDefs += '[_MigrationRowNumber] int NOT NULL'
    $create = $connection.CreateCommand()
    $create.CommandTimeout = 120
    $create.CommandText = "IF OBJECT_ID(N'$SchemaName.$sourceTable', N'U') IS NULL CREATE TABLE $qSchema.$qTable (`n  $($columnDefs -join ",`n  ")`n);"
    [void]$create.ExecuteNonQuery()
    foreach ($property in @($properties)) {
      $add = $connection.CreateCommand(); $add.CommandTimeout = 120
      $add.CommandText = "IF COL_LENGTH(N'$SchemaName.$sourceTable', N'$($property.Replace("'","''"))') IS NULL ALTER TABLE $qSchema.$qTable ADD $(Quote-SqlIdentifier $property) $(Sql-Type $kinds[$property]) NULL;"
      [void]$add.ExecuteNonQuery()
    }
    $index = $connection.CreateCommand(); $index.CommandTimeout = 120
    $index.CommandText = "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'$SchemaName.$sourceTable') AND name=N'IX_$sourceTable`_Migration') CREATE INDEX [IX_$sourceTable`_Migration] ON $qSchema.$qTable ([_MigrationBackupId],[_MigrationRowNumber]);"
    [void]$index.ExecuteNonQuery()

    $check = $connection.CreateCommand(); $check.CommandTimeout = 120
    $check.CommandText = "SELECT COUNT_BIG(*) FROM $qSchema.[MigrationTables] WHERE [BackupId]=@backup AND [SourceTable]=@table"
    $pBackup = $check.Parameters.Add('@backup',[System.Data.SqlDbType]::NVarChar,160); $pBackup.Value=$backupId
    $pTable = $check.Parameters.Add('@table',[System.Data.SqlDbType]::NVarChar,128); $pTable.Value=$sourceTable
    $alreadyLoaded = [int64]$check.ExecuteScalar() -gt 0
    if ($alreadyLoaded) { Write-Output ("[{0}/{1}] {2}: 已完成，略過" -f (++$tableIndex,$tableFiles.Count,$sourceTable)); continue }

    $tx = $connection.BeginTransaction()
    try {
      if ($rows.Count -gt 0) {
        $dataTable = New-Object System.Data.DataTable
        foreach ($property in @($properties)) { [void]$dataTable.Columns.Add($property,(New-ClrColumn $kinds[$property])) }
        [void]$dataTable.Columns.Add('_MigrationBackupId',[string]); [void]$dataTable.Columns.Add('_MigrationRowNumber',[int])
        $rowNumber = 0
        foreach ($row in $rows) {
          $dataRow = $dataTable.NewRow()
          foreach ($property in @($properties)) { $value = $row.PSObject.Properties[$property].Value; $dataRow[$property] = Convert-Value $value $kinds[$property] }
          $dataRow['_MigrationBackupId'] = $backupId; $dataRow['_MigrationRowNumber'] = $rowNumber++
          [void]$dataTable.Rows.Add($dataRow)
        }
        $bulk = New-Object System.Data.SqlClient.SqlBulkCopy($connection,[System.Data.SqlClient.SqlBulkCopyOptions]::Default,$tx)
        $bulk.DestinationTableName = "$qSchema.$qTable"; $bulk.BatchSize = 500; $bulk.BulkCopyTimeout = 300
        foreach ($property in @($properties)) { [void]$bulk.ColumnMappings.Add($property,$property) }
        [void]$bulk.ColumnMappings.Add('_MigrationBackupId','_MigrationBackupId'); [void]$bulk.ColumnMappings.Add('_MigrationRowNumber','_MigrationRowNumber')
        $bulk.WriteToServer($dataTable)
      }
      $record = $connection.CreateCommand(); $record.Transaction=$tx; $record.CommandTimeout=120
      $record.CommandText = "INSERT INTO $qSchema.[MigrationTables] ([BackupId],[SourceTable],[LoadedRowCount],[SchemaJson],[LoadedAtUtc]) VALUES (@backup,@table,@rows,@schema,@loaded)"
      $rBackup = $record.Parameters.Add('@backup',[System.Data.SqlDbType]::NVarChar,160); $rBackup.Value=$backupId
      $rTable = $record.Parameters.Add('@table',[System.Data.SqlDbType]::NVarChar,128); $rTable.Value=$sourceTable
      $rRows = $record.Parameters.Add('@rows',[System.Data.SqlDbType]::BigInt); $rRows.Value=[int64]$rows.Count
      $rSchema = $record.Parameters.Add('@schema',[System.Data.SqlDbType]::NVarChar,-1); $rSchema.Value=$schemaDescription
      $rLoaded = $record.Parameters.Add('@loaded',[System.Data.SqlDbType]::DateTime2); $rLoaded.Value=[DateTime]::UtcNow
      [void]$record.ExecuteNonQuery(); $tx.Commit()
    } catch { try { $tx.Rollback() } catch {}; throw }
    Write-Output ("[{0}/{1}] {2}: {3} 列" -f (++$tableIndex,$tableFiles.Count,$sourceTable,$rows.Count))
  }

  if ($ImportStorage) {
    $storageDir = Join-Path $BackupDir 'storage'
    if (Test-Path -LiteralPath $storageDir -PathType Container) {
      if (-not (Test-Path -LiteralPath $StorageRoot -PathType Container)) { [IO.Directory]::CreateDirectory($StorageRoot) | Out-Null }
      foreach ($source in (Get-ChildItem -LiteralPath $storageDir -File -Recurse)) {
        $relative = $source.FullName.Substring($storageDir.Length).TrimStart('\','/')
        $target = Join-Path $StorageRoot $relative
        $parent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) { [IO.Directory]::CreateDirectory($parent) | Out-Null }
        if (Test-Path -LiteralPath $target -PathType Leaf) {
          $sourceHash = (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash
          $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
          if ($sourceHash -ne $targetHash) { throw "Storage 既有檔案 checksum 不同，拒絕覆蓋：$relative" }
        } else { Copy-Item -LiteralPath $source.FullName -Destination $target }
      }
      Write-Output "Storage 已以不覆蓋模式同步至：$StorageRoot"
    }
  }
  Write-Output ("SQL Server 部署完成：$SchemaName schema、{0} 張表、{1} 列；BackupId={2}" -f $tableFiles.Count,$manifest.totals.rows,$BackupId)
} finally { $connection.Close() }
