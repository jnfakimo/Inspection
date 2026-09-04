"""北農全場交易行情：驗證四組查詢後，原子、冪等匯入正式市場來源。"""
import argparse
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import time

from bs4 import BeautifulSoup
import requests

URL = 'https://www.tapmc.com.tw/Pages/Trans/Price1'
PREFIX = 'ctl00$ContentPlaceHolder1$'
SOURCE_ID = '9a2c1e61-6b8c-49f7-b001-202608300001'
SOURCE_CODE = 'tapmc_market_actual'
MARKETS = {'1': '第一市場', '2': '第二市場'}
CATEGORIES = {'V': '蔬菜', 'F': '水果'}
TAIPEI = timezone(timedelta(hours=8))


def roc(day):
    return f'{day.year - 1911:03d}/{day.month:02d}/{day.day:02d}'


def numeric(value):
    try:
        n = Decimal(value.replace(',', '').strip())
    except InvalidOperation as exc:
        raise ValueError('來源包含無法辨識的量價數值') from exc
    if not n.is_finite() or n < 0:
        raise ValueError('來源包含負值或非有限數值')
    return n


def parse_page(html, day, market, category):
    soup = BeautifulSoup(html, 'html.parser')
    field = soup.find('input', {'name': PREFIX + 'txtDate'})
    if not field or field.get('value') != roc(day):
        raise ValueError('來源回應日期不符')
    for name, expected in [('DDL_Category', '2'), ('DDL_Market', market), ('DDL_FV_Code', category)]:
        select = soup.find('select', {'name': PREFIX + name})
        selected = select.find('option', selected=True) if select else None
        if not selected or selected.get('value') != expected:
            raise ValueError('來源回應查詢條件不符')
    tables = soup.select('table.data-table')
    if not tables:
        if any("alert('該日尚未結帳或無資料!')" in script.get_text() for script in soup.select('script')):
            return [], {'raw_rows': 0, 'duplicate_rows': 0, 'status': 'no_data'}
        raise ValueError('來源沒有預期表格，也沒有明確的尚未結帳／無資料訊息')
    if len(tables) != 1:
        raise ValueError('來源表格數量不符')
    table = tables[0]
    heading = [re.sub(r'\s+', '', x.get_text()) for x in table.select('thead th')]
    if heading != ['品名代號', '品名', '品種', '平均價(元/公斤)', '成交量(公斤)', '（單位：元/公斤）', '上價', '中價', '下價']:
        raise ValueError('來源量價欄位已變更，停止匯入')
    # Verify the result caption as well as the posted controls (stale result protection).
    text = soup.get_text(' ', strip=True)
    for pattern in [rf'查詢日期：\s*{re.escape(roc(day))}', '查詢類別：\\s*2.全場交易行情',
                    rf'果菜別：\s*{CATEGORIES[category]}', rf'市場別：\s*{MARKETS[market]}']:
        if not re.search(pattern, text):
            raise ValueError('來源結果標頭與要求不符')
    rows = table.select('tbody tr')
    footer = table.select_one('tfoot')
    match = re.search(r'總筆數\s*(\d+)', footer.get_text(' ', strip=True) if footer else '')
    if not match or int(match[1]) != len(rows) or not rows:
        raise ValueError('來源總筆數不符或表格為空')
    unique = {}
    duplicates = 0
    for tr in rows:
        cells = [x.get_text(' ', strip=True) for x in tr.find_all('td', recursive=False)]
        if len(cells) != 8 or not re.fullmatch(r'[A-Za-z0-9]+', cells[0]) or not cells[1]:
            raise ValueError('來源資料列格式不符')
        code, item, variety = cells[:3]
        values = tuple(numeric(x) for x in cells[3:])
        row = {'code': code, 'item': item, 'variety': variety, 'values': values}
        if code in unique:
            if unique[code]['values'] != values or unique[code]['item'] != item:
                raise ValueError(f'品名代號 {code} 有互相衝突的資料')
            duplicates += 1
        else:
            unique[code] = row
    return list(unique.values()), {'raw_rows': len(rows), 'duplicate_rows': duplicates, 'status': 'ready'}


def fetch_scope(day, market, category):
    # Retry the entire WebForms exchange so cookies, viewstate and validation stay paired.
    for attempt in range(3):
        try:
            with requests.Session() as session:
                response = session.get(URL, timeout=(15, 90))
                response.raise_for_status()
                soup = BeautifulSoup(response.content, 'html.parser')
                data = {x['name']: x.get('value', '') for x in soup.select('input[name]')}
                if not data.get('__VIEWSTATE') or not data.get('__EVENTVALIDATION'):
                    raise ValueError('來源表單缺少驗證欄位')
                data.update({PREFIX + 'txtDate': roc(day), PREFIX + 'DDL_Category': '2',
                             PREFIX + 'DDL_FV_Code': category, PREFIX + 'DDL_Market': market,
                             '__EVENTTARGET': PREFIX + 'btnQuery', '__EVENTARGUMENT': ''})
                response = session.post(URL, data=data, timeout=(15, 90))
                response.raise_for_status()
                return parse_page(response.content, day, market, category)
        except requests.RequestException:
            if attempt == 2:
                raise RuntimeError('北農來源連線失敗，已重試三次') from None
            time.sleep(3 * (attempt + 1))


def aggregate(rows, day, market, category):
    groups = defaultdict(list)
    for row in rows:
        groups[row['item']].append(row)
    result = []
    for item, group in sorted(groups.items()):
        key = '|'.join(sorted(r['code'] for r in group))
        quantity = sum(r['values'][1] for r in group)
        total = sum(r['values'][0] * r['values'][1] for r in group)
        middle = sum(r['values'][3] * r['values'][1] for r in group)
        identity = '\x1f'.join([SOURCE_ID, day.isoformat(), 'market=' + MARKETS[market],
                               'category=' + CATEGORIES[category], 'item_key=' + key])
        result.append({
            'observed_on': day.isoformat(),
            'dimensions': {'market': MARKETS[market], 'category': CATEGORIES[category], 'item': item, 'item_key': key},
            'measures': {'quantity': float(quantity), 'total_value': float(round(total, 2)),
                         'average_price': float(round(total / quantity, 4)) if quantity else None,
                         'high_price': float(max(r['values'][2] for r in group)),
                         'middle_price': float(round(middle / quantity, 4)) if quantity else None,
                         'low_price': float(min(r['values'][4] for r in group))},
            'external_key': 'market-import:' + hashlib.sha256(identity.encode()).hexdigest(),
            'metadata': {'source_url': URL, 'query_type': 'full_transaction', 'item_codes': key,
                         'item_key': key, 'item_code_count': len(group), 'estimated_total_value': True,
                         'aggregation_level': '日期×市場×品類×品名', 'data_classification': '北農官網全場交易行情',
                         'source_family': '北農官網每日排程', 'import_method': 'tapmc_daily',
                         'fetched_at': datetime.now(TAIPEI).isoformat()},
        })
    return result


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def json_sql(value):
    return sql_literal(json.dumps(value, ensure_ascii=False, allow_nan=False)) + '::jsonb'


def import_sql(points, summary, record_summary=True):
    # One transaction for all fetched dates, with cardinality and exact-value checks.
    # Reject changed code sets rather than appending a second aggregate for the same item.
    # 回補歷史（record_summary=False）不覆蓋 daily_import_last_run，保留每日排程的紀錄。
    summary_sql = f"""
update public.market_data_sources set config=coalesce(config,'{{}}'::jsonb)
 ||jsonb_build_object('daily_import_last_run',{json_sql(summary)}),updated_at=now()
where source_id='{SOURCE_ID}';""" if record_summary else ''
    return f"""
begin;
set local standard_conforming_strings=on;
set local statement_timeout='90s';
select pg_advisory_xact_lock(hashtext('tapmc_daily_import'));
create temporary table incoming_market_daily on commit drop as
select * from jsonb_to_recordset({json_sql(points)}) as x(
 observed_on date, dimensions jsonb, measures jsonb, metadata jsonb, external_key text);
do $check$ begin
 if not exists(select 1 from public.market_data_sources where source_id='{SOURCE_ID}'
   and source_code='{SOURCE_CODE}' and status='active') then
   raise exception '正式市場來源不存在或尚未啟用'; end if;
 if exists(select 1 from public.market_data_points p join incoming_market_daily i
   on p.observed_on=i.observed_on and p.dimensions->>'market'=i.dimensions->>'market'
   and p.dimensions->>'category'=i.dimensions->>'category' and p.dimensions->>'item'=i.dimensions->>'item'
   where p.source_id='{SOURCE_ID}' and p.external_key is distinct from i.external_key) then
   raise exception '既有品項的代碼集合有變，需人工核對以避免重複計量'; end if;
end $check$;
insert into public.market_data_points(source_id,observed_on,dimensions,measures,metadata,external_key)
select '{SOURCE_ID}',observed_on,dimensions,measures,metadata,external_key from incoming_market_daily
on conflict(source_id,external_key) where external_key is not null and external_key<>'' do update set
 measures=excluded.measures, dimensions=excluded.dimensions,
 metadata=coalesce(market_data_points.metadata,'{{}}'::jsonb)||excluded.metadata;
do $verify$ begin
 if (select count(*) from public.market_data_points p join incoming_market_daily i
   on p.external_key=i.external_key and p.source_id='{SOURCE_ID}'
   and p.observed_on=i.observed_on and p.measures=i.measures and p.dimensions=i.dimensions)
   <> (select count(*) from incoming_market_daily) then raise exception '匯入後資料驗證失敗'; end if;
 if exists(select 1 from public.market_data_points p where p.source_id='{SOURCE_ID}'
   and exists(select 1 from incoming_market_daily i where i.observed_on=p.observed_on
     and i.dimensions->>'market'=p.dimensions->>'market' and i.dimensions->>'category'=p.dimensions->>'category')
   and not exists(select 1 from incoming_market_daily i where i.external_key=p.external_key)) then
   raise exception '來源品項少於已存資料，保留既有資料並停止匯入'; end if;
end $verify$;{summary_sql}
commit;
"""


def day_chunks(first, last, size=7):
    # 回補歷史時每 size 天一個交易：單筆 Management API 請求與 statement_timeout 都有上限，
    # 分批提交也讓中途失敗可從失敗批次的起日重跑（穩定鍵冪等，不會重複計量）。
    if first > last:
        raise ValueError('起日不可晚於迄日')
    if size < 1:
        raise ValueError('批次天數必須至少 1 天')
    chunks, start = [], first
    while start <= last:
        end = min(start + timedelta(days=size - 1), last)
        chunks.append((start, end))
        start = end + timedelta(days=1)
    return chunks


def write_raw_rows(directory, day, market, category, rows):
    # 逐品名代號（含品種）的原始列，供日後改成代碼粒度時直接載入，不必重抓官網。
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'{day.isoformat()}-{market}-{category}.jsonl'
    with path.open('w', encoding='utf-8') as handle:
        for row in rows:
            avg, qty, high, middle, low = (str(x) for x in row['values'])
            handle.write(json.dumps({'observed_on': day.isoformat(), 'market': MARKETS[market], 'category': CATEGORIES[category],
                                     'code': row['code'], 'item': row['item'], 'variety': row['variety'],
                                     'average_price': avg, 'quantity': qty, 'high_price': high, 'middle_price': middle, 'low_price': low},
                                    ensure_ascii=False) + '\n')


def query(sql, read_only=False):
    token = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not token:
        raise RuntimeError('缺少 SUPABASE_ACCESS_TOKEN')
    ref = 'qztffronusdhgxhjjubt'
    try:
        response = requests.post(f'https://api.supabase.com/v1/projects/{ref}/database/query',
                                 headers={'Authorization': f'Bearer {token}'},
                                 json={'query': sql, 'read_only': read_only}, timeout=(15, 120))
    except requests.RequestException:
        raise RuntimeError('資料庫連線未完成；請重新執行，穩定鍵可防止重複匯入') from None
    if not response.ok:
        # Never log response bodies: they may contain SQL or credentials.
        raise RuntimeError(f'資料庫拒絕操作 HTTP {response.status}；交易已設驗證保護，請查看來源格式與既有品項')
    return response.json()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', type=date.fromisoformat, default=datetime.now(TAIPEI).date())
    parser.add_argument('--lookback', type=int, choices=range(1, 8), default=3)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--sql-output', type=Path,
                        help='通過來源驗證後輸出原子匯入 SQL，供隔離的本機資料庫執行')
    parser.add_argument('--from', dest='from_date', type=date.fromisoformat,
                        help='回補歷史：從此日到 --date 逐日抓取，每 --chunk-days 天一個交易寫入；忽略 --lookback')
    parser.add_argument('--chunk-days', type=int, default=7, help='回補歷史時每個交易涵蓋的天數（預設 7）')
    parser.add_argument('--raw-output', type=Path,
                        help='另存逐品名代號（含品種）的原始列 JSONL 目錄，供日後改成代碼粒度時直接載入')
    args = parser.parse_args()
    if args.execute and args.sql_output:
        parser.error('--execute 與 --sql-output 不可同時使用')
    if args.date > datetime.now(TAIPEI).date():
        parser.error('不接受未來日期')
    if args.from_date and args.from_date > args.date:
        parser.error('--from 不可晚於 --date')
    if args.chunk_days < 1 or args.chunk_days > 31:
        parser.error('--chunk-days 必須介於 1 至 31')
    backfill = args.from_date is not None
    if backfill:
        chunks = day_chunks(args.from_date, args.date, args.chunk_days)
    else:
        chunks = [(args.date - timedelta(days=args.lookback - 1), args.date)]
    mode = 'imported' if args.execute else ('local_sql' if args.sql_output else 'dry_run')
    if backfill:
        mode = 'backfill_' + mode
    if args.sql_output:
        args.sql_output.parent.mkdir(parents=True, exist_ok=True)
        args.sql_output.write_text('', encoding='utf-8')

    def fetch_days(first, last):
        points, scopes = [], []
        day = first
        while day <= last:
            for market in MARKETS:
                for category in CATEGORIES:
                    rows, stats = fetch_scope(day, market, category)
                    if args.raw_output and rows:
                        write_raw_rows(args.raw_output, day, market, category, rows)
                    batch = aggregate(rows, day, market, category)
                    points.extend(batch)
                    scope = {'date': day.isoformat(), 'market': MARKETS[market], 'category': CATEGORIES[category],
                             **stats, 'points': len(batch)}
                    scopes.append(scope)
                    print(json.dumps(scope, ensure_ascii=False), flush=True)
                    time.sleep(0.5)
            day += timedelta(days=1)
        return points, scopes

    # 每個批次抓完、驗證完才寫入，再抓下一批；回補失敗時訊息會標出該批次起日以便重跑。
    total_points, all_scopes, chunk_reports = 0, [], []
    for first, last in chunks:
        points, scopes = fetch_days(first, last)
        summary = {'completed_at': datetime.now(TAIPEI).isoformat(), 'requested_date': args.date.isoformat(),
                   'range_from': first.isoformat(), 'range_to': last.isoformat(),
                   'mode': mode, 'points': len(points), 'scopes': scopes,
                   'workflow_run': os.environ.get('GITHUB_RUN_ID', '')}
        if points:
            try:
                if args.execute:
                    query(import_sql(points, summary, record_summary=not backfill))
                    if not backfill:
                        stored = query(f"select config->'daily_import_last_run' as result from public.market_data_sources where source_id='{SOURCE_ID}'", True)
                        if len(stored) != 1 or stored[0]['result'] != summary:
                            raise RuntimeError('匯入完成紀錄讀回不符')
                elif args.sql_output:
                    with args.sql_output.open('a', encoding='utf-8') as handle:
                        handle.write(import_sql(points, summary, record_summary=not backfill))
            except Exception as exc:
                raise RuntimeError(f'批次 {first}～{last} 失敗：{exc}；之前批次已提交，請以 --from {first} 重跑') from exc
        total_points += len(points)
        all_scopes.extend(scopes)
        trading_days = len({s['date'] for s in scopes if s['status'] == 'ready'})
        chunk_reports.append((first, last, trading_days, len(points)))
        if backfill:
            print(f'::notice::批次 {first}～{last}：{trading_days} 個交易日、{len(points)} 筆已{"寫入" if args.execute else "處理"}', flush=True)
    points, scopes = total_points, all_scopes
    result_label = '正式匯入並讀回驗證' if args.execute else ('本機匯入 SQL 已驗證產生' if args.sql_output else '試讀')
    if backfill:
        lines = ['## 北農行情歷史回補', '', f"期間：{args.from_date}～{args.date}；{result_label} {points} 筆。", '',
                 '| 批次起日 | 批次迄日 | 交易日 | 匯入筆數 |', '|---|---|---:|---:|']
        for first, last, trading_days, count in chunk_reports:
            lines.append(f'| {first} | {last} | {trading_days} | {count} |')
    else:
        lines = ['## 北農每日行情匯入', '', f"日期：{args.date}；{result_label} {points} 筆。", '',
                 '| 日期 | 市場 | 品類 | 原始列 | 排除重複 | 匯入筆數 | 結果 |', '|---|---|---|---:|---:|---:|---|']
        for s in scopes:
            state = '已驗證' if s['status'] == 'ready' else '尚未結帳或無資料（未寫入）'
            lines.append(f"| {s['date']} | {s['market']} | {s['category']} | {s['raw_rows']} | {s['duplicate_rows']} | {s['points']} | {state} |")
    text = '\n'.join(lines) + '\n'
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a', encoding='utf8') as f:
            f.write(text)
    if not backfill and any(s['status'] == 'no_data' for s in scopes):
        print('::warning::部分查詢尚未結帳或無資料；未當作零成交量寫入，下次排程會回補最近三日。')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError) as exc:
        print(f'::error::{exc}', flush=True)
        raise SystemExit(1)
