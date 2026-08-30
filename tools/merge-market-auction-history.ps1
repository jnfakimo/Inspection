param(
    [Parameter(Mandatory = $true)]
    [string]$CurrentDataDirectory,

    [Parameter(Mandatory = $true)]
    [string]$HistoryWorkbook,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$currentPath = (Resolve-Path -LiteralPath $CurrentDataDirectory).Path
$historyPath = (Resolve-Path -LiteralPath $HistoryWorkbook).Path
$historyFile = Get-Item -LiteralPath $historyPath
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null

function Normalize-Text([object]$Value) {
    if ($null -eq $Value) { return '' }
    return ([string]$Value).Trim()
}

function Normalize-Header([object]$Value) {
    return (Normalize-Text $Value) -replace '\s+', ''
}

function To-NullableNumber([object]$Value) {
    if ($null -eq $Value -or (Normalize-Text $Value) -eq '') { return $null }
    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or
        $Value -is [int64] -or $Value -is [single] -or $Value -is [double] -or
        $Value -is [decimal]) { return [double]$Value }
    $number = 0.0
    $normalized = (Normalize-Text $Value) -replace ',', ''
    if ([double]::TryParse($normalized, [System.Globalization.NumberStyles]::Any,
        [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) { return $number }
    return $null
}

function Parse-ObservedDate([object]$Value) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [DateTime]) { return ([DateTime]$Value).ToString('yyyy-MM-dd') }
    if ($Value -is [double] -or $Value -is [int]) {
        try { return [DateTime]::FromOADate([double]$Value).ToString('yyyy-MM-dd') } catch { return $null }
    }
    $text = Normalize-Text $Value
    $parsed = [DateTime]::MinValue
    foreach ($format in @('yyyy-MM-dd', 'yyyy/M/d', 'yyyy/MM/dd')) {
        if ([DateTime]::TryParseExact($text, $format, [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::None, [ref]$parsed)) {
            return $parsed.ToString('yyyy-MM-dd')
        }
    }
    return $null
}

function Get-ArrayValue([object]$Values, [int]$Row, [int]$Column, [int]$RowCount, [int]$ColumnCount) {
    if ($RowCount -eq 1 -and $ColumnCount -eq 1) { return $Values }
    return $Values.GetValue($Row, $Column)
}

function Sha256-Text([string]$Value) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
    return [Convert]::ToHexString($hash).ToLowerInvariant()
}

function Number-Key([object]$Value) {
    if ($null -eq $Value) { return '' }
    return ([double]$Value).ToString('R', [System.Globalization.CultureInfo]::InvariantCulture)
}

function Write-CsvUtf8Bom([object[]]$Rows, [string]$Path) {
    $csv = if ($Rows.Count) { $Rows | ConvertTo-Csv -NoTypeInformation -UseQuotes AsNeeded } else { @() }
    [System.IO.File]::WriteAllLines($Path, $csv, [System.Text.UTF8Encoding]::new($true))
}

$transactionCsv = Join-Path $currentPath 'market_transactions.csv'
$auctionCsv = Join-Path $currentPath 'market_auction_prices.csv'
$manifestCsv = Join-Path $currentPath 'market_dataset_manifest.csv'
foreach ($requiredPath in @($transactionCsv, $auctionCsv, $manifestCsv)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "缺少既有清理檔：$requiredPath" }
}

$currentTransactions = @(Import-Csv -LiteralPath $transactionCsv | Where-Object { $_.source_file -ne $historyFile.Name })
$auctionRows = @(Import-Csv -LiteralPath $auctionCsv)
$manifestRows = [System.Collections.Generic.List[object]]::new()
@(Import-Csv -LiteralPath $manifestCsv) | Where-Object {
    $_.status -ne 'selected_history' -and $_.file_name -ne $historyFile.Name
} | ForEach-Object { $manifestRows.Add($_) }

$historyRecords = [System.Collections.Generic.List[object]]::new()
$invalidRows = 0
$historyPriceRangeAnomalyCount = 0
$historyZeroPriceBandCount = 0
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false
$excel.AutomationSecurity = 3
$workbook = $null
$worksheet = $null
$usedRange = $null

try {
    $workbook = $excel.Workbooks.Open($historyPath, 0, $true)
    $worksheet = $workbook.Worksheets.Item(1)
    $usedRange = $worksheet.UsedRange
    $rowCount = [int]$usedRange.Rows.Count
    $columnCount = [int]$usedRange.Columns.Count
    $values = $usedRange.Value2

    $headers = @{}
    for ($column = 1; $column -le $columnCount; $column += 1) {
        $header = Normalize-Header (Get-ArrayValue $values 1 $column $rowCount $columnCount)
        if ($header -and -not $headers.ContainsKey($header)) { $headers[$header] = $column }
    }

    $averageHeader = @($headers.Keys | Where-Object { $_ -like '平均價*' } | Select-Object -First 1)[0]
    $quantityHeader = @($headers.Keys | Where-Object { $_ -like '成交量*' } | Select-Object -First 1)[0]
    $requiredHeaders = @('日期(西元)', '市場', '果菜類別', '品名代號', '品名', '上價', '中價', '下價')
    foreach ($header in $requiredHeaders) {
        if (-not $headers.ContainsKey($header)) { throw "歷史工作簿缺少欄位：$header" }
    }
    if (-not $averageHeader -or -not $quantityHeader) { throw '歷史工作簿缺少平均價或成交量欄位。' }

    for ($row = 2; $row -le $rowCount; $row += 1) {
        $observedOn = Parse-ObservedDate (Get-ArrayValue $values $row $headers['日期(西元)'] $rowCount $columnCount)
        $marketText = Normalize-Text (Get-ArrayValue $values $row $headers['市場'] $rowCount $columnCount)
        $market = if ($marketText -match '^(一市|第一市場)$') { '第一市場' } elseif ($marketText -match '^(二市|第二市場)$') { '第二市場' } else { '' }
        $categoryText = Normalize-Text (Get-ArrayValue $values $row $headers['果菜類別'] $rowCount $columnCount)
        $category = if ($categoryText -match '蔬菜') { '蔬菜' } elseif ($categoryText -match '水果') { '水果' } else { '' }
        $itemCode = Normalize-Text (Get-ArrayValue $values $row $headers['品名代號'] $rowCount $columnCount)
        $item = Normalize-Text (Get-ArrayValue $values $row $headers['品名'] $rowCount $columnCount)
        $variety = if ($headers.ContainsKey('品種')) { Normalize-Text (Get-ArrayValue $values $row $headers['品種'] $rowCount $columnCount) } else { '' }
        $averagePrice = To-NullableNumber (Get-ArrayValue $values $row $headers[$averageHeader] $rowCount $columnCount)
        $quantity = To-NullableNumber (Get-ArrayValue $values $row $headers[$quantityHeader] $rowCount $columnCount)
        $highPrice = To-NullableNumber (Get-ArrayValue $values $row $headers['上價'] $rowCount $columnCount)
        $middlePrice = To-NullableNumber (Get-ArrayValue $values $row $headers['中價'] $rowCount $columnCount)
        $lowPrice = To-NullableNumber (Get-ArrayValue $values $row $headers['下價'] $rowCount $columnCount)

        if (-not $observedOn -or -not $market -or -not $category -or -not $itemCode -or -not $item -or
            $null -eq $averagePrice -or $null -eq $quantity -or [double]$averagePrice -lt 0 -or [double]$quantity -le 0 -or
            (@($highPrice, $middlePrice, $lowPrice) | Where-Object { $null -ne $_ -and [double]$_ -lt 0 })) {
            $invalidRows += 1
            continue
        }

        $qualityFlag = ''
        if ($null -ne $highPrice -and $null -ne $middlePrice -and $null -ne $lowPrice) {
            if ([double]$averagePrice -gt 0 -and [double]$highPrice -eq 0 -and
                [double]$middlePrice -eq 0 -and [double]$lowPrice -eq 0) {
                $historyPriceRangeAnomalyCount += 1
                $historyZeroPriceBandCount += 1
                $qualityFlag = '價格區間為零待查'
                # 三個零值為缺值佔位；保留平均價與成交量，價格區間改為空值，避免最低價被錯判為 0。
                $highPrice = $null
                $middlePrice = $null
                $lowPrice = $null
            }
            elseif ([double]$highPrice -lt [double]$middlePrice -or [double]$middlePrice -lt [double]$lowPrice) {
                $historyPriceRangeAnomalyCount += 1
                $qualityFlag = '高中低價位順序異常待查'
            }
            elseif ([double]$averagePrice -gt [double]$highPrice -or [double]$averagePrice -lt [double]$lowPrice) {
                $historyPriceRangeAnomalyCount += 1
                $qualityFlag = '平均價落在價格區間外待查'
            }
        }

        $historyRecords.Add([pscustomobject]@{
            observed_on = $observedOn
            market = $market
            category = $category
            item_code = $itemCode
            item = $item
            variety = $variety
            average_price = $averagePrice
            quantity = $quantity
            total_value = [Math]::Round([double]$averagePrice * [double]$quantity, 2)
            high_price = $highPrice
            middle_price = $middlePrice
            low_price = $lowPrice
            query_type = 'full_transaction'
            source_file = $historyFile.Name
            quality_flag = $qualityFlag
        })
    }
}
finally {
    if ($workbook) { $workbook.Close($false) }
    if ($usedRange) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($usedRange) }
    if ($worksheet) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($worksheet) }
    if ($workbook) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
    $excel.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

if (-not $historyRecords.Count) { throw '歷史工作簿沒有可用交易資料。' }

$historyCodeNameConflictCount = @(($historyRecords | Group-Object category, item_code) | Where-Object {
    $names = @($_.Group | ForEach-Object { $_.item } | Sort-Object -Unique)
    $names.Count -gt 1
}).Count

$historyName = $historyFile.Name
$duplicateNaturalKeyRows = 0
$conflictingNaturalKeys = 0
$combinedRows = [System.Collections.Generic.List[object]]::new()
$allTransactions = @($currentTransactions) + @($historyRecords)
foreach ($group in ($allTransactions | Group-Object {
    @($_.observed_on, $_.market, $_.category, $_.item_code, $_.item, $_.variety) -join "`u{001f}"
})) {
    $groupRows = @($group.Group)
    if ($groupRows.Count -gt 1) {
        $duplicateNaturalKeyRows += $groupRows.Count - 1
        $signatures = @($groupRows | ForEach-Object {
            @((Number-Key $_.average_price), (Number-Key $_.quantity), (Number-Key $_.high_price),
                (Number-Key $_.middle_price), (Number-Key $_.low_price)) -join '|'
        } | Sort-Object -Unique)
        if ($signatures.Count -gt 1) { $conflictingNaturalKeys += 1 }
    }
    $selected = $groupRows | Sort-Object @{ Expression = { if ($_.source_file -eq $historyName) { 0 } else { 1 } }; Descending = $true } | Select-Object -First 1
    $combinedRows.Add($selected)
}

$transactionRows = @($combinedRows | Sort-Object observed_on, market, category, item, variety)
$historyDates = @($historyRecords.observed_on | Sort-Object -Unique)
$historyQuantity = [double](($historyRecords | Measure-Object quantity -Sum).Sum)
$historyValue = [double](($historyRecords | Measure-Object total_value -Sum).Sum)
$historySignature = Sha256-Text (($historyRecords | ForEach-Object {
    @($_.observed_on, $_.market, $_.category, $_.item_code, $_.item, $_.variety,
        (Number-Key $_.average_price), (Number-Key $_.quantity), (Number-Key $_.high_price),
        (Number-Key $_.middle_price), (Number-Key $_.low_price)) -join "`u{001f}"
}) -join "`n")

$manifestRows.Add([pscustomobject]@{
    file_name = $historyFile.Name
    observed_on = ''
    market = '第一市場／第二市場'
    category = '蔬菜／水果'
    query_type = 'full_transaction'
    data_rows = $historyRecords.Count
    quantity_sum = [Math]::Round($historyQuantity, 2)
    status = 'selected_history'
    signature = $historySignature
    note = "歷史整併檔，期間 $($historyDates[0]) 至 $($historyDates[-1])；略過 $invalidRows 筆無法辨識列。"
})

$signatureByFile = @{}
foreach ($manifestRow in $manifestRows) {
    if ($manifestRow.file_name -and $manifestRow.signature) { $signatureByFile[$manifestRow.file_name] = $manifestRow.signature }
}

$transactionDaily = @($transactionRows | Group-Object observed_on, market, category | ForEach-Object {
    $rows = @($_.Group)
    $quantity = [double](($rows | Measure-Object quantity -Sum).Sum)
    $value = [double](($rows | Measure-Object total_value -Sum).Sum)
    [pscustomobject]@{
        observed_on = $rows[0].observed_on
        market = $rows[0].market
        category = $rows[0].category
        item_count = @($rows.item_code | Sort-Object -Unique).Count
        row_count = $rows.Count
        quantity = [Math]::Round($quantity, 2)
        total_value = [Math]::Round($value, 2)
        weighted_average_price = if ($quantity) { [Math]::Round($value / $quantity, 2) } else { $null }
    }
} | Sort-Object observed_on, market, category)

$topItems = @($transactionRows | Group-Object item_code, item, category | ForEach-Object {
    $rows = @($_.Group)
    $quantity = [double](($rows | Measure-Object quantity -Sum).Sum)
    $value = [double](($rows | Measure-Object total_value -Sum).Sum)
    [pscustomobject]@{
        item_code = $rows[0].item_code
        item = $rows[0].item
        category = $rows[0].category
        quantity = [Math]::Round($quantity, 2)
        total_value = [Math]::Round($value, 2)
        weighted_average_price = if ($quantity) { [Math]::Round($value / $quantity, 2) } else { $null }
    }
} | Sort-Object quantity -Descending | Select-Object -First 50)

$dashboardPoints = @($transactionRows | Group-Object observed_on, market, category, item | ForEach-Object {
    $rows = @($_.Group)
    $quantity = [double](($rows | Measure-Object quantity -Sum).Sum)
    $value = [double](($rows | Measure-Object total_value -Sum).Sum)
    $middleRows = @($rows | Where-Object { $null -ne $_.middle_price -and $null -ne $_.quantity })
    $middleQuantity = [double](($middleRows | Measure-Object quantity -Sum).Sum)
    $middleNumerator = [double](($middleRows | ForEach-Object { [double]$_.middle_price * [double]$_.quantity } | Measure-Object -Sum).Sum)
    $highValues = @($rows | Where-Object { $null -ne $_.high_price } | ForEach-Object { [double]$_.high_price })
    $lowValues = @($rows | Where-Object { $null -ne $_.low_price } | ForEach-Object { [double]$_.low_price })
    $qualityFlags = @($rows | Where-Object { $_.quality_flag } | ForEach-Object { $_.quality_flag } | Sort-Object -Unique)
    $itemCodes = @($rows.item_code | Sort-Object -Unique)
    $sourceFiles = @($rows.source_file | Sort-Object -Unique)
    $sourceSignatures = @($sourceFiles | ForEach-Object { if ($signatureByFile.ContainsKey($_)) { $signatureByFile[$_] } } | Sort-Object -Unique)
    [pscustomobject]@{
        observed_on = $rows[0].observed_on
        market = $rows[0].market
        category = $rows[0].category
        item = $rows[0].item
        item_code_count = $itemCodes.Count
        item_codes = $itemCodes -join '|'
        item_key = $itemCodes -join '|'
        quantity = [Math]::Round($quantity, 2)
        total_value = [Math]::Round($value, 2)
        average_price = if ($quantity) { [Math]::Round($value / $quantity, 4) } else { $null }
        high_price = if ($highValues.Count) { [Math]::Round([double](($highValues | Measure-Object -Maximum).Maximum), 4) } else { $null }
        middle_price = if ($middleQuantity) { [Math]::Round($middleNumerator / $middleQuantity, 4) } else { $null }
        low_price = if ($lowValues.Count) { [Math]::Round([double](($lowValues | Measure-Object -Minimum).Minimum), 4) } else { $null }
        source_file_count = $sourceFiles.Count
        source_family = if ($rows.source_file -contains $historyName) { '115年01-06月整併檔' } else { '115年07-08月每日匯出' }
        source_files = $sourceFiles -join '|'
        source_signatures = $sourceSignatures -join '|'
        quality_flag_count = @($rows | Where-Object { $_.quality_flag }).Count
        quality_flags = $qualityFlags -join '、'
    }
} | Sort-Object observed_on, market, category, item)

$dates = @($transactionRows.observed_on | Sort-Object -Unique)
$summary = [ordered]@{
    generated_at = [DateTimeOffset]::Now.ToString('o')
    current_data_directory = $currentPath
    history_workbook = $historyPath
    file_count = $manifestRows.Count
    selected_file_count = @($manifestRows | Where-Object { $_.status -in @('selected', 'selected_history') }).Count
    exact_duplicate_file_count = @($manifestRows | Where-Object status -eq 'exact_duplicate').Count
    scope_alternate_file_count = @($manifestRows | Where-Object status -eq 'scope_alternate').Count
    empty_file_count = @($manifestRows | Where-Object status -eq 'empty').Count
    unknown_or_error_file_count = @($manifestRows | Where-Object { $_.status -in @('unknown', 'error') }).Count
    period_from = $dates[0]
    period_to = $dates[-1]
    history_period_from = $historyDates[0]
    history_period_to = $historyDates[-1]
    history_row_count = $historyRecords.Count
    invalid_history_row_count = $invalidRows
    history_price_range_anomaly_count = $historyPriceRangeAnomalyCount
    history_zero_price_band_count = $historyZeroPriceBandCount
    history_code_name_conflict_count = $historyCodeNameConflictCount
    duplicate_natural_key_rows = $duplicateNaturalKeyRows
    conflicting_natural_key_count = $conflictingNaturalKeys
    transaction_row_count = $transactionRows.Count
    auction_price_row_count = $auctionRows.Count
    dashboard_point_count = $dashboardPoints.Count
    transaction_total_quantity = [Math]::Round([double](($transactionRows | Measure-Object quantity -Sum).Sum), 2)
    transaction_total_value = [Math]::Round([double](($transactionRows | Measure-Object total_value -Sum).Sum), 2)
    markets = @($transactionRows.market | Sort-Object -Unique)
    categories = @($transactionRows.category | Sort-Object -Unique)
    daily_summary = $transactionDaily
    top_items_by_quantity = $topItems
}

Write-CsvUtf8Bom $transactionRows (Join-Path $outputPath 'market_transactions.csv')
Write-CsvUtf8Bom $auctionRows (Join-Path $outputPath 'market_auction_prices.csv')
Write-CsvUtf8Bom $transactionDaily (Join-Path $outputPath 'market_daily_summary.csv')
Write-CsvUtf8Bom $dashboardPoints (Join-Path $outputPath 'market_dashboard_points.csv')
Write-CsvUtf8Bom @($manifestRows) (Join-Path $outputPath 'market_dataset_manifest.csv')
[System.IO.File]::WriteAllText(
    (Join-Path $outputPath 'market_analysis_summary.json'),
    ($summary | ConvertTo-Json -Depth 8),
    [System.Text.UTF8Encoding]::new($false)
)

[pscustomobject]$summary | Select-Object file_count, selected_file_count, empty_file_count,
    period_from, period_to, history_row_count, invalid_history_row_count,
    duplicate_natural_key_rows, conflicting_natural_key_count,
    transaction_row_count, auction_price_row_count, dashboard_point_count,
    transaction_total_quantity, transaction_total_value | Format-List
