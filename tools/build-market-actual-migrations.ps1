param(
    [Parameter(Mandatory = $true)]
    [string]$DashboardCsv,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $true)]
    [string]$ManifestCsv,

    [string]$TimestampDate = '20260830',

    [int]$MaximumBytes = 500000
)

$ErrorActionPreference = 'Stop'
$csvPath = (Resolve-Path -LiteralPath $DashboardCsv).Path
$manifestPath = (Resolve-Path -LiteralPath $ManifestCsv).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null

if ($TimestampDate -notmatch '^\d{8}$') { throw 'TimestampDate 必須是 8 位 YYYYMMDD。' }
if ($MaximumBytes -lt 100000 -or $MaximumBytes -gt 524288) { throw 'MaximumBytes 必須介於 100000 與 524288。' }

function Sql-Text([object]$Value) {
    if ($null -eq $Value) { return 'null' }
    return "'$( ([string]$Value).Replace("'", "''") )'"
}

function Sql-Number([object]$Value) {
    if ($null -eq $Value -or ([string]$Value).Trim() -eq '') { return 'null' }
    $number = 0.0
    if (-not [double]::TryParse(([string]$Value).Replace(',', ''), [System.Globalization.NumberStyles]::Any,
        [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) { throw "無法轉換數值：$Value" }
    return $number.ToString('0.####', [System.Globalization.CultureInfo]::InvariantCulture)
}

function Utf8-Bytes([string]$Value) {
    return [System.Text.Encoding]::UTF8.GetByteCount($Value)
}

function Sha256-Text([string]$Value) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
    return [Convert]::ToHexString($hash).ToLowerInvariant()
}

function Write-Utf8([string]$Path, [string]$Value) {
    [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

$rows = @(Import-Csv -LiteralPath $csvPath)
if (-not $rows.Count) { throw "找不到戰情資料列：$csvPath" }
$sourceCode = 'tapmc_market_actual'
$sourceId = '9a2c1e61-6b8c-49f7-b001-202608300001'

$requiredColumns = @('observed_on','market','category','item','item_key','item_codes','item_code_count',
    'quantity','total_value','average_price','high_price','middle_price','low_price','source_file_count',
    'source_family','source_files','source_signatures','quality_flag_count','quality_flags')
$actualColumns = @($rows[0].PSObject.Properties.Name)
foreach ($requiredColumn in $requiredColumns) {
    if ($requiredColumn -notin $actualColumns) { throw "戰情 CSV 缺少欄位：$requiredColumn" }
}

$externalKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
for ($rowIndex = 0; $rowIndex -lt $rows.Count; $rowIndex += 1) {
    $row = $rows[$rowIndex]
    $displayRow = $rowIndex + 2
    $parsedDate = [DateTime]::MinValue
    if (-not [DateTime]::TryParseExact([string]$row.observed_on, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::None, [ref]$parsedDate)) { throw "第 $displayRow 列日期格式不正確" }
    foreach ($key in @('market','category','item','item_key','item_codes','source_family','source_files','source_signatures')) {
        if (-not ([string]$row.$key).Trim()) { throw "第 $displayRow 列缺少必填欄位：$key" }
    }
    if ([string]$row.item_key -ne [string]$row.item_codes) { throw "第 $displayRow 列穩定品項鍵與代碼集合不一致" }
    foreach ($key in @('item_code_count','quantity','total_value','average_price','source_file_count','quality_flag_count')) {
        $number = 0.0
        if (-not [double]::TryParse(([string]$row.$key).Replace(',', ''), [System.Globalization.NumberStyles]::Any,
            [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) { throw "第 $displayRow 列數值欄位無法解析：$key" }
        if (($key -eq 'quantity' -and $number -le 0) -or ($key -ne 'quantity' -and $number -lt 0)) {
            throw "第 $displayRow 列數值欄位超出允許範圍：$key"
        }
    }
    foreach ($key in @('high_price','middle_price','low_price')) {
        if (([string]$row.$key).Trim()) {
            $number = 0.0
            if (-not [double]::TryParse(([string]$row.$key).Replace(',', ''), [System.Globalization.NumberStyles]::Any,
                [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number) -or $number -lt 0) {
                throw "第 $displayRow 列選填數值欄位無法解析：$key"
            }
        }
    }
    $naturalKeyPayload = @($sourceId, $row.observed_on, "market=$($row.market)", "category=$($row.category)", "item_key=$($row.item_key)") -join "`u{001f}"
    $externalKey = "market-import:$(Sha256-Text $naturalKeyPayload)"
    if (-not $externalKeys.Add($externalKey)) { throw "第 $displayRow 列產生重複自然鍵：$externalKey" }
}

$outputRoot = $outputPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
foreach ($staleFile in @(Get-ChildItem -LiteralPath $outputPath -File -Filter "${TimestampDate}1600*_market_actual_data_*.sql")) {
    $candidatePath = [System.IO.Path]::GetFullPath($staleFile.FullName)
    if (-not $candidatePath.StartsWith($outputRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒絕移除輸出目錄外的舊分片：$candidatePath"
    }
    Remove-Item -LiteralPath $candidatePath -Force
}

$dates = @($rows.observed_on | Sort-Object -Unique)
$periodFrom = $dates[0]
$periodTo = $dates[-1]
$previousTradingDay = if ($dates.Count -ge 2) { $dates[-2] } else { $periodTo }
$manifestRows = @(Import-Csv -LiteralPath $manifestPath)
if (-not $manifestRows.Count) { throw "找不到來源清冊：$manifestPath" }
$manifestConfig = @($manifestRows | ForEach-Object {
    [ordered]@{
        file_name = [string]$_.file_name
        observed_on = [string]$_.observed_on
        market = [string]$_.market
        category = [string]$_.category
        status = [string]$_.status
        signature = [string]$_.signature
        note = [string]$_.note
    }
})

$fieldDefinitions = @'
[
  {"key":"market","label":"市場","kind":"dimension","required":true},
  {"key":"category","label":"品類","kind":"dimension","required":true},
  {"key":"item","label":"品項","kind":"dimension","required":true},
  {"key":"item_key","label":"穩定品項鍵","kind":"dimension","required":true},
  {"key":"quantity","label":"成交量","kind":"measure","unit":"公斤","aggregation":"sum"},
  {"key":"total_value","label":"推估成交額","kind":"measure","unit":"元","aggregation":"sum"},
  {"key":"average_price","label":"成交量加權平均價","kind":"measure","unit":"元／公斤","aggregation":"weighted_avg","weight_key":"quantity"},
  {"key":"high_price","label":"最高上價","kind":"measure","unit":"元／公斤","aggregation":"max"},
  {"key":"middle_price","label":"成交量加權中價","kind":"measure","unit":"元／公斤","aggregation":"weighted_avg","weight_key":"quantity"},
  {"key":"low_price","label":"最低下價","kind":"measure","unit":"元／公斤","aggregation":"min"}
]
'@

$sourceConfig = [ordered]@{
    is_default = $true
    is_actual = $true
    data_classification = '使用者提供實際交易行情'
    data_scope = '第一市場、第二市場；蔬菜、水果'
    aggregation_level = '日期×市場×品類×品名'
    period_from = $periodFrom
    period_to = $periodTo
    latest_observed_on = $periodTo
    default_from = $periodTo
    default_to = $periodTo
    default_compare_from = $previousTradingDay
    default_compare_to = $previousTradingDay
    default_dimensions = @('market', 'category')
    default_measures = @('quantity', 'total_value', 'average_price')
    natural_key_fields = @('market', 'category', 'item_key')
    value_note = '推估成交額為平均價乘以成交量，非實際結算金額。'
    data_quality_note = '115 年 1 至 6 月整併檔含 94,703 筆明細且四個市場／品類範圍完整，其中 6 筆平均價區間及 5 組品名代號跨品名待追查；7 至 8 月 233 份每日匯出中排除 49 份空匯出與 8 組內容重複，蔬菜 2026-07-24、2026-07-25 缺少來源檔。'
    source_assets = @('115年01-06月全場交易行情整併檔', '115年07-08月每日全場交易行情匯出')
    source_manifest = $manifestConfig
    decision_point_count = $rows.Count
} | ConvertTo-Json -Depth 7 -Compress

$baseSql = @"
-- 第一、第二市場實際交易行情：正式決策來源、加權口徑與主管模板。
-- 資料由使用者提供的 1 至 6 月整併工作簿與 7 至 8 月 233 份 XLS，經內容去重與品質檢查後產生；只新增或更新，不刪除既有資料。

begin;

alter table public.market_analysis_templates
  drop constraint if exists market_analysis_templates_chart_type_check;
alter table public.market_analysis_templates
  add constraint market_analysis_templates_chart_type_check
  check (chart_type in ('bar','pie','doughnut','line','area','table','cards'));

create index if not exists idx_market_points_dimensions_gin
  on public.market_data_points using gin (dimensions jsonb_path_ops);

create or replace function public.market_dimension_values(
  p_source_id uuid,
  p_dimension text,
  p_limit integer default 500
) returns table(value text, point_count bigint)
language sql stable security invoker set search_path=public,pg_temp as `$function`$
  select p.dimensions->>p_dimension as value, count(*)::bigint as point_count
  from public.market_data_points p
  where p.source_id=p_source_id
    and p_dimension ~ '^[a-z][a-z0-9_-]{0,59}$'
    and p.dimensions ? p_dimension
    and coalesce(p.dimensions->>p_dimension,'')<>''
  group by p.dimensions->>p_dimension
  order by count(*) desc, p.dimensions->>p_dimension
  limit least(greatest(coalesce(p_limit,500),1),500)
`$function`$;
revoke all on function public.market_dimension_values(uuid,text,integer) from public;
grant execute on function public.market_dimension_values(uuid,text,integer) to authenticated,service_role;

create or replace function public.market_source_date_ranges()
returns table(source_id uuid,first_observed_on date,latest_observed_on date,previous_observed_on date)
language sql stable security invoker set search_path=public,pg_temp as `$function`$
  with source_days as (
    select distinct p.source_id,p.observed_on from public.market_data_points p
  )
  select d.source_id,min(d.observed_on),max(d.observed_on),(array_agg(d.observed_on order by d.observed_on desc))[2]
  from source_days d
  group by d.source_id
`$function`$;
revoke all on function public.market_source_date_ranges() from public;
grant execute on function public.market_source_date_ranges() to service_role;

create or replace function public.market_import_data_points(
  p_source_id uuid,
  p_rows jsonb,
  p_imported_by uuid
) returns table(inserted_count bigint,updated_count bigint)
language sql volatile security definer set search_path=public,pg_temp as `$function`$
  with incoming_rows as (
    select
      (row_data->>'observed_on')::date as observed_on,
      coalesce(row_data->'dimensions','{}'::jsonb) as dimensions,
      coalesce(row_data->'measures','{}'::jsonb) as measures,
      coalesce(row_data->'metadata','{}'::jsonb) as metadata,
      row_data->>'external_key' as external_key,
      ordinal
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) with ordinality as rows(row_data,ordinal)
    where coalesce(row_data->>'external_key','')<>''
  ), incoming as (
    select distinct on (external_key)
      observed_on,dimensions,measures,metadata,external_key
    from incoming_rows
    order by external_key,ordinal desc
  ), upserted as (
    insert into public.market_data_points(source_id,observed_on,dimensions,measures,metadata,external_key,imported_by)
    select p_source_id,i.observed_on,i.dimensions,i.measures,i.metadata,i.external_key,p_imported_by
    from incoming i
    on conflict (source_id,external_key) where external_key is not null and external_key<>'' do update set
      observed_on=excluded.observed_on,
      dimensions=excluded.dimensions,
      measures=coalesce(market_data_points.measures,'{}'::jsonb) || excluded.measures,
      metadata=coalesce(market_data_points.metadata,'{}'::jsonb) || excluded.metadata,
      imported_by=excluded.imported_by
    returning (xmax=0) as inserted
  )
  select count(*) filter(where inserted),count(*) filter(where not inserted) from upserted
`$function`$;
revoke all on function public.market_import_data_points(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.market_import_data_points(uuid,jsonb,uuid) to service_role;

update public.market_data_sources
set config=coalesce(config,'{}'::jsonb)-'is_default',updated_at=now()
where source_code<>'$sourceCode' and coalesce(config,'{}'::jsonb) ? 'is_default';

insert into public.market_data_sources(source_id,source_code,source_name,source_type,field_definitions,config,status,updated_at)
values (
  '$sourceId',
  '$sourceCode',
  '第一、第二市場實際交易行情',
  'csv',
  `$market`$$fieldDefinitions`$market`$::jsonb,
  `$market`$$sourceConfig`$market`$::jsonb,
  'active',
  now()
)
on conflict (source_code) do update set
  source_name=excluded.source_name,
  source_type=excluded.source_type,
  field_definitions=excluded.field_definitions,
  config=excluded.config,
  status='active',
  updated_at=now();

create unique index if not exists uq_market_sources_single_default
  on public.market_data_sources ((config->>'is_default'))
  where config->>'is_default'='true';

update public.market_data_sources
set config=(coalesce(config,'{}'::jsonb)-'is_default') || jsonb_build_object('is_demo',source_code='market_demo'),
    updated_at=now()
where source_code in ('market_daily','market_demo');

update public.market_data_sources
set field_definitions='[
  {"key":"item","label":"品項","kind":"dimension","required":true},
  {"key":"market","label":"市場","kind":"dimension"},
  {"key":"unit","label":"交易單位","kind":"dimension"},
  {"key":"quantity","label":"交易量","kind":"measure","unit":"公斤","aggregation":"sum"},
  {"key":"average_price","label":"平均價","kind":"measure","unit":"元／公斤","aggregation":"weighted_avg","weight_key":"quantity"},
  {"key":"min_price","label":"最低價","kind":"measure","unit":"元／公斤","aggregation":"min"},
  {"key":"max_price","label":"最高價","kind":"measure","unit":"元／公斤","aggregation":"max"},
  {"key":"total_value","label":"交易金額","kind":"measure","unit":"元","aggregation":"sum"}
]'::jsonb,
updated_at=now()
where source_code in ('market_daily','market_demo');

insert into public.market_analysis_templates(template_id,template_code,template_name,description,source_id,dimensions,measures,chart_type,default_config,status,updated_at)
values
  ('9a2c1e61-6b8c-49f7-b101-202608300001','actual-market-executive','雙市場每日營運戰情','比較第一市場與第二市場的成交量、推估成交額及成交量加權平均價。',(select source_id from public.market_data_sources where source_code='$sourceCode'),'["market","category"]'::jsonb,'["quantity","total_value","average_price"]'::jsonb,'cards','{"compare":"previous","limit":20,"chart_measure":"quantity","palette_id":"market"}'::jsonb,'active',now()),
  ('9a2c1e61-6b8c-49f7-b102-202608300001','actual-market-item-watch','主要品項量價變動','依市場、品類與品項追蹤成交量及加權平均價，供異常與貢獻度判讀。',(select source_id from public.market_data_sources where source_code='$sourceCode'),'["market","category","item"]'::jsonb,'["quantity","average_price","total_value"]'::jsonb,'bar','{"compare":"previous","limit":20,"chart_measure":"quantity","palette_id":"produce"}'::jsonb,'active',now()),
  ('9a2c1e61-6b8c-49f7-b103-202608300001','actual-market-category-share','雙市場蔬果交易占比','呈現兩市場蔬菜與水果的成交量占比及比較期變化。',(select source_id from public.market_data_sources where source_code='$sourceCode'),'["market","category"]'::jsonb,'["quantity","total_value"]'::jsonb,'doughnut','{"compare":"previous","limit":20,"chart_measure":"quantity","palette_id":"accessible"}'::jsonb,'active',now())
on conflict (template_code) do update set
  template_name=excluded.template_name,
  description=excluded.description,
  source_id=excluded.source_id,
  dimensions=excluded.dimensions,
  measures=excluded.measures,
  chart_type=excluded.chart_type,
  default_config=excluded.default_config,
  status='active',
  updated_at=now();

commit;
notify pgrst, 'reload schema';
"@

$baseName = "${TimestampDate}160000_market_actual_source.sql"
Write-Utf8 ([System.IO.Path]::Combine($outputPath, $baseName)) $baseSql

$header = @"
-- 第一、第二市場實際交易行情資料（戰情粒度，冪等分批匯入）。
begin;
do `$assert`$
begin
  if not exists(select 1 from public.market_data_sources where source_code='$sourceCode') then
    raise exception '正式市場行情資料來源尚未建立，請先套用基礎 migration';
  end if;
end
`$assert`$;
with source as (
  select source_id from public.market_data_sources where source_code='$sourceCode'
), points(observed_on,market,category,item,item_key,item_code_count,quantity,total_value,average_price,high_price,middle_price,low_price,source_file_count,source_family,source_files,quality_flag_count,quality_flags,external_key) as (
  values
"@ + "`n"
$footer = @"

)
insert into public.market_data_points(source_id,observed_on,dimensions,measures,metadata,external_key)
select s.source_id,p.observed_on::date,
  jsonb_build_object('market',p.market,'category',p.category,'item',p.item,'item_key',p.item_key),
  jsonb_build_object('quantity',p.quantity,'total_value',p.total_value,'average_price',p.average_price,'high_price',p.high_price,'middle_price',p.middle_price,'low_price',p.low_price),
  jsonb_build_object('data_classification','使用者提供實際交易行情','aggregation_level','日期×市場×品類×品名','estimated_total_value',true,'item_key',p.item_key,'item_codes',p.item_key,'item_code_count',p.item_code_count,'source_file_count',p.source_file_count,'source_family',p.source_family,'source_files',p.source_files,'quality_flag_count',coalesce(p.quality_flag_count,0),'quality_flags',coalesce(p.quality_flags,'')),
  p.external_key
from points p cross join source s
on conflict (source_id,external_key) where external_key is not null and external_key<>'' do update set
  observed_on=excluded.observed_on,
  dimensions=excluded.dimensions,
  measures=excluded.measures,
  metadata=excluded.metadata;
commit;
"@

$valueLines = @($rows | ForEach-Object {
    $naturalKeyPayload = @($sourceId, $_.observed_on, "market=$($_.market)", "category=$($_.category)", "item_key=$($_.item_key)") -join "`u{001f}"
    $externalKey = "market-import:$(Sha256-Text $naturalKeyPayload)"
    '(' + (@(
        (Sql-Text $_.observed_on), (Sql-Text $_.market), (Sql-Text $_.category), (Sql-Text $_.item),
        (Sql-Text $_.item_key),
        (Sql-Number $_.item_code_count), (Sql-Number $_.quantity), (Sql-Number $_.total_value),
        (Sql-Number $_.average_price), (Sql-Number $_.high_price), (Sql-Number $_.middle_price),
        (Sql-Number $_.low_price), (Sql-Number $_.source_file_count), (Sql-Text $_.source_family),
        (Sql-Text $_.source_files),
        (Sql-Number $_.quality_flag_count), (Sql-Text $_.quality_flags), (Sql-Text $externalKey)
    ) -join ',') + ')'
})

$part = 1
$current = [System.Collections.Generic.List[string]]::new()
$migrationNames = [System.Collections.Generic.List[string]]::new()

function Flush-Part {
    if (-not $current.Count) { return }
    if ($part -gt 59) { throw '資料分批超過 59 份，請提高 MaximumBytes 或調整時間戳策略。' }
    $body = $header + (($current | ForEach-Object -Begin { $index = 0 } -Process {
        $prefix = if ($index -eq 0) { '    ' } else { '   ,' }
        $index += 1
        "$prefix$_`n"
    }) -join '') + $footer
    $name = '{0}1600{1:D2}_market_actual_data_{1:D2}.sql' -f $TimestampDate, $part
    $path = [System.IO.Path]::Combine($outputPath, $name)
    if ((Utf8-Bytes $body) -gt $MaximumBytes) { throw "產生的 migration 超過限制：$name" }
    Write-Utf8 $path $body
    $migrationNames.Add($name)
    $current.Clear()
    $script:part += 1
}

foreach ($line in $valueLines) {
    $candidateBytes = (Utf8-Bytes $header) + (Utf8-Bytes $footer) + (Utf8-Bytes (($current -join "`n") + "`n" + $line)) + 16 * ($current.Count + 1)
    if ($current.Count -and $candidateBytes -gt $MaximumBytes) { Flush-Part }
    $current.Add($line)
}
Flush-Part

$allNames = @($baseName) + @($migrationNames)
[pscustomobject]@{
    source_code = $sourceCode
    period_from = $periodFrom
    period_to = $periodTo
    previous_trading_day = $previousTradingDay
    point_count = $rows.Count
    migration_count = $allNames.Count
    migrations = $allNames
} | ConvertTo-Json -Depth 4
