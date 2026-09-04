param(
    [Parameter(Mandatory = $true)]
    [string]$InputDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$inputPath = (Resolve-Path -LiteralPath $InputDirectory).Path
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

function Number-Key([object]$Value) {
    if ($null -eq $Value) { return '' }
    return ([double]$Value).ToString('R', [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-ArrayValue([object]$Values, [int]$Row, [int]$Column, [int]$RowCount, [int]$ColumnCount) {
    if ($RowCount -eq 1 -and $ColumnCount -eq 1) { return $Values }
    return $Values.GetValue($Row, $Column)
}

function First-Text-In-Row([object]$Values, [int]$Row, [int]$RowCount, [int]$ColumnCount) {
    for ($column = 1; $column -le $ColumnCount; $column += 1) {
        $candidate = Normalize-Text (Get-ArrayValue $Values $Row $column $RowCount $ColumnCount)
        if ($candidate) { return $candidate }
    }
    return ''
}

function Parse-ObservedDate([string]$QueryText, [string]$FileName) {
    foreach ($match in [regex]::Matches("$QueryText $FileName", '(?<year>\d{3})[\/_-](?<month>\d{2})[\/_-](?<day>\d{2})')) {
        $year = [int]$match.Groups['year'].Value + 1911
        $candidate = '{0:D4}-{1}-{2}' -f $year, $match.Groups['month'].Value, $match.Groups['day'].Value
        $parsed = [DateTime]::MinValue
        if ([DateTime]::TryParseExact($candidate, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::None, [ref]$parsed)) {
            return $parsed.ToString('yyyy-MM-dd')
        }
    }
    return $null
}

function Sha256-Text([string]$Value) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
    return [Convert]::ToHexString($hash).ToLowerInvariant()
}

function Write-CsvUtf8Bom([object[]]$Rows, [string]$Path) {
    $csv = if ($Rows.Count) { $Rows | ConvertTo-Csv -NoTypeInformation -UseQuotes AsNeeded } else { @() }
    [System.IO.File]::WriteAllLines($Path, $csv, [System.Text.UTF8Encoding]::new($true))
}

$files = @(Get-ChildItem -LiteralPath $inputPath -File -Filter '*.xls' | Sort-Object Name)
if (-not $files.Count) { throw "找不到 .xls 檔案：$inputPath" }

$datasets = [System.Collections.Generic.List[object]]::new()
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false
$excel.AutomationSecurity = 3

try {
    foreach ($file in $files) {
        $workbook = $null
        $worksheet = $null
        $usedRange = $null
        try {
            $workbook = $excel.Workbooks.Open($file.FullName, 0, $true)
            $worksheet = $workbook.Worksheets.Item(1)
            $usedRange = $worksheet.UsedRange
            $rowCount = [int]$usedRange.Rows.Count
            $columnCount = [int]$usedRange.Columns.Count
            $values = $usedRange.Value2

            $queryText = if ($rowCount -ge 2) { First-Text-In-Row $values 2 $rowCount $columnCount } else { '' }
            $marketText = if ($rowCount -ge 4) { First-Text-In-Row $values 4 $rowCount $columnCount } else { '' }
            $observedOn = Parse-ObservedDate $queryText $file.Name
            $market = if ($marketText -match '第一市場') { '第一市場' } elseif ($marketText -match '第二市場') { '第二市場' } else { '' }
            $category = if ($marketText -match '蔬菜' -or $file.Name -match '蔬菜') { '蔬菜' } elseif ($marketText -match '水果' -or $file.Name -match '水果') { '水果' } else { '' }

            $headers = @{}
            if ($rowCount -ge 3) {
                for ($column = 1; $column -le $columnCount; $column += 1) {
                    $header = Normalize-Header (Get-ArrayValue $values 3 $column $rowCount $columnCount)
                    if ($header -and -not $headers.ContainsKey($header)) { $headers[$header] = $column }
                }
            }
            $averageColumn = ($headers.Keys | Where-Object { $_ -like '平均價*' } | Select-Object -First 1)
            $quantityColumn = ($headers.Keys | Where-Object { $_ -like '成交量*' } | Select-Object -First 1)
            $queryType = if ($averageColumn -and $quantityColumn) { 'full_transaction' } elseif ($headers.ContainsKey('上價') -and $headers.ContainsKey('中價') -and $headers.ContainsKey('下價')) { 'auction_price' } else { 'unknown' }

            $records = [System.Collections.Generic.List[object]]::new()
            if ($queryType -ne 'unknown' -and $observedOn -and $market -and $category) {
                for ($row = 5; $row -le $rowCount; $row += 1) {
                    $itemCode = Normalize-Text (Get-ArrayValue $values $row 1 $rowCount $columnCount)
                    $item = Normalize-Text (Get-ArrayValue $values $row 2 $rowCount $columnCount)
                    if (-not $itemCode -or -not $item -or $itemCode -match '合計|總計') { continue }
                    $variety = Normalize-Text (Get-ArrayValue $values $row 3 $rowCount $columnCount)
                    $highPrice = if ($headers.ContainsKey('上價')) { To-NullableNumber (Get-ArrayValue $values $row $headers['上價'] $rowCount $columnCount) } else { $null }
                    $middlePrice = if ($headers.ContainsKey('中價')) { To-NullableNumber (Get-ArrayValue $values $row $headers['中價'] $rowCount $columnCount) } else { $null }
                    $lowPrice = if ($headers.ContainsKey('下價')) { To-NullableNumber (Get-ArrayValue $values $row $headers['下價'] $rowCount $columnCount) } else { $null }
                    $averagePrice = if ($averageColumn) { To-NullableNumber (Get-ArrayValue $values $row $headers[$averageColumn] $rowCount $columnCount) } else { $null }
                    $quantity = if ($quantityColumn) { To-NullableNumber (Get-ArrayValue $values $row $headers[$quantityColumn] $rowCount $columnCount) } else { $null }
                    if ($queryType -eq 'full_transaction' -and
                        ($null -eq $averagePrice -or $null -eq $quantity -or [double]$averagePrice -lt 0 -or [double]$quantity -le 0)) { continue }
                    if (@($highPrice, $middlePrice, $lowPrice) | Where-Object { $null -ne $_ -and [double]$_ -lt 0 }) { continue }
                    $qualityFlag = ''
                    if ($queryType -eq 'full_transaction' -and $null -ne $highPrice -and $null -ne $middlePrice -and $null -ne $lowPrice) {
                        if ([double]$averagePrice -gt 0 -and [double]$highPrice -eq 0 -and [double]$middlePrice -eq 0 -and [double]$lowPrice -eq 0) {
                            $qualityFlag = '價格區間為零待查'
                            $highPrice = $null; $middlePrice = $null; $lowPrice = $null
                        }
                        elseif ([double]$highPrice -lt [double]$middlePrice -or [double]$middlePrice -lt [double]$lowPrice) {
                            $qualityFlag = '高中低價位順序異常待查'
                        }
                        elseif ([double]$averagePrice -gt [double]$highPrice + 0.051 -or [double]$averagePrice -lt [double]$lowPrice - 0.051) {
                            $qualityFlag = '平均價落在價格區間外待查'
                        }
                    }
                    $totalValue = if ($null -ne $averagePrice -and $null -ne $quantity) { [Math]::Round($averagePrice * $quantity, 2) } else { $null }
                    $records.Add([pscustomobject]@{
                        observed_on = $observedOn
                        market = $market
                        category = $category
                        item_code = $itemCode
                        item = $item
                        variety = $variety
                        average_price = $averagePrice
                        quantity = $quantity
                        total_value = $totalValue
                        high_price = $highPrice
                        middle_price = $middlePrice
                        low_price = $lowPrice
                        query_type = $queryType
                        source_file = $file.Name
                        quality_flag = $qualityFlag
                    })
                }
            }

            $duplicateNaturalKeyRows = 0
            if ($records.Count) {
                $deduplicatedRecords = [System.Collections.Generic.List[object]]::new()
                foreach ($recordGroup in ($records | Group-Object {
                    @($_.observed_on, $_.market, $_.category, $_.item_code, $_.item, $_.variety) -join "`u{001f}"
                })) {
                    $groupRows = @($recordGroup.Group)
                    $duplicateNaturalKeyRows += [Math]::Max(0, $groupRows.Count - 1)
                    $deduplicatedRecords.Add($groupRows[0])
                }
                $records = $deduplicatedRecords
            }

            $rowTokens = $records | ForEach-Object {
                @($_.item_code, $_.item, $_.variety, (Number-Key $_.average_price), (Number-Key $_.quantity),
                    (Number-Key $_.high_price), (Number-Key $_.middle_price), (Number-Key $_.low_price)) -join "`u{001f}"
            }
            $signatureText = @($observedOn, $market, $category, $queryType, ($rowTokens -join "`n")) -join "`u{001e}"
            $quantitySum = ($records | Where-Object { $null -ne $_.quantity } | Measure-Object -Property quantity -Sum).Sum
            if ($null -eq $quantitySum) { $quantitySum = 0 }
            $datasets.Add([pscustomobject]@{
                FileName = $file.Name
                FullName = $file.FullName
                FileLength = $file.Length
                LastWriteTime = $file.LastWriteTime
                ObservedOn = $observedOn
                Market = $market
                Category = $category
                QueryType = $queryType
                QueryText = $queryText
                MarketText = $marketText
                RowCount = $records.Count
                DuplicateNaturalKeyRows = $duplicateNaturalKeyRows
                QuantitySum = [double]$quantitySum
                Signature = Sha256-Text $signatureText
                ScopeKey = @($observedOn, $market, $category, $queryType) -join '|'
                Status = if ($records.Count) { 'candidate' } elseif ($queryType -eq 'unknown') { 'unknown' } else { 'empty' }
                Records = $records
            })
        }
        catch {
            $datasets.Add([pscustomobject]@{
                FileName = $file.Name; FullName = $file.FullName; FileLength = $file.Length; LastWriteTime = $file.LastWriteTime
                ObservedOn = $null; Market = ''; Category = ''; QueryType = 'error'; QueryText = ''; MarketText = ''
                RowCount = 0; DuplicateNaturalKeyRows = 0; QuantitySum = 0; Signature = ''; ScopeKey = ''; Status = 'error'; Records = @(); Error = $_.Exception.Message
            })
        }
        finally {
            if ($workbook) { $workbook.Close($false) }
            if ($usedRange) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($usedRange) }
            if ($worksheet) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($worksheet) }
            if ($workbook) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
        }
    }
}
finally {
    $excel.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$candidateDatasets = @($datasets | Where-Object { $_.Status -eq 'candidate' })
foreach ($scopeGroup in ($candidateDatasets | Group-Object ScopeKey)) {
    $ordered = @($scopeGroup.Group | Sort-Object `
        @{ Expression = 'RowCount'; Descending = $true },
        @{ Expression = 'QuantitySum'; Descending = $true },
        @{ Expression = 'FileLength'; Descending = $true },
        @{ Expression = 'LastWriteTime'; Descending = $true })
    $selected = $ordered[0]
    $selected.Status = 'selected'
    foreach ($other in $ordered | Select-Object -Skip 1) {
        $other.Status = if ($other.Signature -eq $selected.Signature) { 'exact_duplicate' } else { 'scope_alternate' }
    }
}

$selectedDatasets = @($datasets | Where-Object { $_.Status -eq 'selected' })
$transactionRows = @($selectedDatasets | Where-Object { $_.QueryType -eq 'full_transaction' } | ForEach-Object { $_.Records })
$auctionRows = @($selectedDatasets | Where-Object { $_.QueryType -eq 'auction_price' } | ForEach-Object { $_.Records })

$manifestRows = @($datasets | ForEach-Object {
    [pscustomobject]@{
        file_name = $_.FileName
        observed_on = $_.ObservedOn
        market = $_.Market
        category = $_.Category
        query_type = $_.QueryType
        data_rows = $_.RowCount
        quantity_sum = [Math]::Round([double]$_.QuantitySum, 2)
        status = $_.Status
        signature = $_.Signature
        note = if ($_.Status -eq 'scope_alternate') { '同日、同市場、同類別已有資料列較完整版本' } elseif ($_.Status -eq 'exact_duplicate') { '內容與選用版本完全相同' } elseif ($_.Status -eq 'empty') { '休市或查無交易資料' } elseif ($_.Status -eq 'unknown') { '無法辨識欄位或市場' } elseif ($_.Status -eq 'error') { $_.Error } elseif ($_.DuplicateNaturalKeyRows) { "檔內自然鍵重複 $($_.DuplicateNaturalKeyRows) 筆，已保留第一筆" } else { '' }
    }
})

$transactionDaily = @($transactionRows | Group-Object observed_on, market, category | ForEach-Object {
    $rows = @($_.Group)
    $quantity = ($rows | Measure-Object quantity -Sum).Sum
    $value = ($rows | Measure-Object total_value -Sum).Sum
    [pscustomobject]@{
        observed_on = $rows[0].observed_on
        market = $rows[0].market
        category = $rows[0].category
        item_count = @($rows.item_code | Sort-Object -Unique).Count
        row_count = $rows.Count
        quantity = [Math]::Round([double]$quantity, 2)
        total_value = [Math]::Round([double]$value, 2)
        weighted_average_price = if ($quantity) { [Math]::Round([double]$value / [double]$quantity, 2) } else { $null }
    }
} | Sort-Object observed_on, market, category)

$topItems = @($transactionRows | Group-Object item_code, item, category | ForEach-Object {
    $rows = @($_.Group)
    $quantity = ($rows | Measure-Object quantity -Sum).Sum
    $value = ($rows | Measure-Object total_value -Sum).Sum
    [pscustomobject]@{
        item_code = $rows[0].item_code
        item = $rows[0].item
        category = $rows[0].category
        quantity = [Math]::Round([double]$quantity, 2)
        total_value = [Math]::Round([double]$value, 2)
        weighted_average_price = if ($quantity) { [Math]::Round([double]$value / [double]$quantity, 2) } else { $null }
    }
} | Sort-Object quantity -Descending | Select-Object -First 50)

$signatureByFile = @{}
foreach ($dataset in $datasets) {
    if ($dataset.FileName -and $dataset.Signature) { $signatureByFile[$dataset.FileName] = $dataset.Signature }
}

# 戰情儀表板以「品名」為決策粒度。同一品名若有多個品名代號，先以成交量加權
# 合併平均價，避免各規格被當成不同品項後稀釋主管判讀。
$dashboardPoints = @($transactionRows | Group-Object observed_on, market, category, item | ForEach-Object {
    $rows = @($_.Group)
    $quantity = [double](($rows | Measure-Object quantity -Sum).Sum)
    $value = [double](($rows | Measure-Object total_value -Sum).Sum)
    $middleRows = @($rows | Where-Object { $null -ne $_.middle_price -and $null -ne $_.quantity })
    $middleQuantity = [double](($middleRows | Measure-Object quantity -Sum).Sum)
    $middleNumerator = [double](($middleRows | ForEach-Object { [double]$_.middle_price * [double]$_.quantity } | Measure-Object -Sum).Sum)
    $highValues = @($rows | Where-Object { $null -ne $_.high_price } | ForEach-Object { [double]$_.high_price })
    $lowValues = @($rows | Where-Object { $null -ne $_.low_price } | ForEach-Object { [double]$_.low_price })
    $itemCodes = @($rows.item_code | Sort-Object -Unique)
    $sourceFiles = @($rows.source_file | Sort-Object -Unique)
    $sourceSignatures = @($sourceFiles | ForEach-Object { if ($signatureByFile.ContainsKey($_)) { $signatureByFile[$_] } } | Sort-Object -Unique)
    $qualityFlags = @($rows | Where-Object { $_.quality_flag } | ForEach-Object { $_.quality_flag } | Sort-Object -Unique)
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
        source_file_count = @($rows.source_file | Sort-Object -Unique).Count
        source_family = '每日行情匯出'
        source_files = $sourceFiles -join '|'
        source_signatures = $sourceSignatures -join '|'
        quality_flag_count = @($rows | Where-Object { $_.quality_flag }).Count
        quality_flags = $qualityFlags -join '、'
    }
} | Sort-Object observed_on, market, category, item)

$summary = [ordered]@{
    generated_at = [DateTimeOffset]::Now.ToString('o')
    input_directory = $inputPath
    file_count = $files.Count
    selected_file_count = $selectedDatasets.Count
    exact_duplicate_file_count = @($datasets | Where-Object Status -eq 'exact_duplicate').Count
    scope_alternate_file_count = @($datasets | Where-Object Status -eq 'scope_alternate').Count
    empty_file_count = @($datasets | Where-Object Status -eq 'empty').Count
    unknown_or_error_file_count = @($datasets | Where-Object { $_.Status -in @('unknown', 'error') }).Count
    period_from = ($transactionRows.observed_on | Sort-Object | Select-Object -First 1)
    period_to = ($transactionRows.observed_on | Sort-Object | Select-Object -Last 1)
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

Write-CsvUtf8Bom $transactionRows ([System.IO.Path]::Combine($outputPath, 'market_transactions.csv'))
Write-CsvUtf8Bom $auctionRows ([System.IO.Path]::Combine($outputPath, 'market_auction_prices.csv'))
Write-CsvUtf8Bom $transactionDaily ([System.IO.Path]::Combine($outputPath, 'market_daily_summary.csv'))
Write-CsvUtf8Bom $dashboardPoints ([System.IO.Path]::Combine($outputPath, 'market_dashboard_points.csv'))
Write-CsvUtf8Bom $manifestRows ([System.IO.Path]::Combine($outputPath, 'market_dataset_manifest.csv'))
[System.IO.File]::WriteAllText(
    [System.IO.Path]::Combine($outputPath, 'market_analysis_summary.json'),
    ($summary | ConvertTo-Json -Depth 8),
    [System.Text.UTF8Encoding]::new($false)
)

[pscustomobject]$summary | Select-Object file_count, selected_file_count, exact_duplicate_file_count,
    scope_alternate_file_count, empty_file_count, unknown_or_error_file_count,
    period_from, period_to, transaction_row_count, auction_price_row_count, dashboard_point_count,
    transaction_total_quantity, transaction_total_value | Format-List
