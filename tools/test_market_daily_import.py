from datetime import date
import unittest

import tempfile
from pathlib import Path

from market_daily_import import (MOA_IMPORT_METHOD, MOA_URL, PREFIX, aggregate, batch_source, day_chunks, import_sql,
                                 load_raw_rows, moa_scope, parse_page, roc_dot, sql_literal, write_raw_rows)

DAY = date(2026, 9, 2)


def page(rows, count=None):
    controls = f'<input name="{PREFIX}txtDate" value="115/09/02">'
    for key, value in [('DDL_Category', '2'), ('DDL_Market', '1'), ('DDL_FV_Code', 'V')]:
        controls += f'<select name="{PREFIX}{key}"><option selected value="{value}"></option></select>'
    caption = '查詢日期：115/09/02 查詢類別：2.全場交易行情 果菜別：蔬菜 市場別：第一市場'
    headings = ['品名代號', '品名', '品種', '平均價(元/公斤)', '成交量(公斤)', '（單位：元/公斤）', '上價', '中價', '下價']
    header = ''.join(f'<th>{s}</th>' for s in headings)
    body = ''.join('<tr>' + ''.join(f'<td>{x}</td>' for x in row) + '</tr>' for row in rows)
    table = f'<table class="data-table"><thead><tr>{header}</tr></thead><tbody>{body}</tbody><tfoot>總筆數 {len(rows) if count is None else count}</tfoot></table>'
    return controls + caption + table


class MarketImportTests(unittest.TestCase):
    def test_alias_duplicate_is_not_double_counted(self):
        html = page([['FK41', '甜椒', '彩色種', '10', '100', '20', '10', '5'],
                     ['FK41', '甜椒', '彩椒紅色', '10', '100', '20', '10', '5'],
                     ['FK42', '甜椒', '彩椒黃色', '20', '300', '30', '20', '10']])
        rows, stats = parse_page(html, DAY, '1', 'V')
        point, = aggregate(rows, DAY, '1', 'V')
        self.assertEqual(stats['duplicate_rows'], 1)
        self.assertEqual(point['measures']['quantity'], 400)
        self.assertEqual(point['measures']['total_value'], 7000)
        self.assertEqual(point['measures']['average_price'], 17.5)
        self.assertEqual(point['dimensions']['item_key'], 'FK41|FK42')
        self.assertEqual(point['external_key'], aggregate(list(reversed(rows)), DAY, '1', 'V')[0]['external_key'])

    def test_conflicting_code_is_rejected(self):
        with self.assertRaisesRegex(ValueError, '衝突'):
            parse_page(page([['FK41', '甜椒', '', '10', '100', '20', '10', '5'],
                             ['FK41', '甜椒', '', '10', '200', '20', '10', '5']]), DAY, '1', 'V')

    def test_incomplete_or_wrong_scope_is_rejected(self):
        html = page([['FK41', '甜椒', '', '10', '100', '20', '10', '5']])
        for broken in [html.replace('總筆數 1', '總筆數 2'), html.replace('平均價', '拍賣價'),
                       html.replace('115/09/02', '115/09/01'), html.replace('市場別：第一市場', '市場別：第二市場'),
                       html.replace('<td>100</td>', '<td>NaN</td>')]:
            with self.subTest(broken=broken[-80:]), self.assertRaises(ValueError):
                parse_page(broken, DAY, '1', 'V')

    def test_placeholder_row_is_skipped_and_page_of_placeholders_is_no_data(self):
        html = page([['Q1', '蓮霧', '紅蓮霧', '.0', '', '.0', '.0', '.0']])
        rows, stats = parse_page(html, DAY, '1', 'V')
        self.assertEqual(rows, [])
        self.assertEqual(stats['status'], 'no_data')
        self.assertEqual(stats['placeholder_rows'], 1)
        html = page([['Q1', '蓮霧', '紅蓮霧', '.0', '', '.0', '.0', '.0'], ['LP2', '九層塔', '', '73.5', '300', '100', '75', '50']])
        rows, stats = parse_page(html, DAY, '1', 'V')
        self.assertEqual([row['code'] for row in rows], ['LP2'])
        self.assertEqual(stats['status'], 'ready')
        # 成交量空白但價格非零仍視為格式錯誤，不能默默略過。
        with self.assertRaises(ValueError):
            parse_page(page([['Q1', '蓮霧', '紅蓮霧', '50', '', '60', '50', '40']]), DAY, '1', 'V')

    def test_no_data_requires_explicit_source_message(self):
        html = page([]).split('<table')[0]
        with self.assertRaises(ValueError):
            parse_page(html, DAY, '1', 'V')
        rows, stats = parse_page(html + "<script>alert('該日尚未結帳或無資料!')</script>", DAY, '1', 'V')
        self.assertEqual(rows, [])
        self.assertEqual(stats['status'], 'no_data')

    def test_legacy_identity_matches_existing_migration(self):
        html = page([['LP2', '九層塔', '', '73.5', '300', '100', '75', '50']])
        rows, _ = parse_page(html, DAY, '1', 'V')
        point, = aggregate(rows, date(2026, 1, 9), '1', 'V')
        self.assertEqual(point['external_key'], 'market-import:0c00c7a6b37177ed61f7af82f5fdbb99f730d4a2b568461b4c9d076b89329271')

    def test_quote_in_external_text_is_escaped(self):
        self.assertEqual(sql_literal("農友's"), "'農友''s'")

    def test_backfill_chunks_cover_range_without_gaps(self):
        chunks = day_chunks(date(2021, 1, 1), date(2021, 1, 20), 7)
        self.assertEqual(chunks, [(date(2021, 1, 1), date(2021, 1, 7)), (date(2021, 1, 8), date(2021, 1, 14)),
                                  (date(2021, 1, 15), date(2021, 1, 20))])
        self.assertEqual(day_chunks(date(2021, 1, 1), date(2021, 1, 1)), [(date(2021, 1, 1), date(2021, 1, 1))])
        with self.assertRaises(ValueError):
            day_chunks(date(2021, 1, 2), date(2021, 1, 1))

    def test_backfill_sql_keeps_daily_run_record(self):
        self.assertNotIn('daily_import_last_run', import_sql([], {'mode': 'backfill_imported'}, record_summary=False))
        self.assertIn('daily_import_last_run', import_sql([], {'mode': 'imported'}))

    def test_raw_rows_round_trip_matches_live_parse(self):
        html = page([['72', '小番茄', '聖女', '69.1', '4,256', '82.5', '69.6', '53.9'],
                     ['74', '小番茄', '玉女', '191.6', '456', '349.8', '195.7', '21.2']])
        rows, _ = parse_page(html, DAY, '1', 'V')
        with tempfile.TemporaryDirectory() as folder:
            write_raw_rows(Path(folder), DAY, '1', 'V', rows)
            loaded, stats = load_raw_rows(Path(folder), DAY, '1', 'V')
            missing, missing_stats = load_raw_rows(Path(folder), DAY, '2', 'F')
        self.assertEqual(loaded, rows)
        self.assertEqual(stats['status'], 'ready')
        self.assertEqual(aggregate(loaded, DAY, '1', 'V')[0]['external_key'], aggregate(rows, DAY, '1', 'V')[0]['external_key'])
        self.assertEqual((missing, missing_stats['status']), ([], 'no_data'))

    def test_local_sql_is_atomic_and_non_destructive(self):
        sql = import_sql([], {'mode': 'local_sql'})
        lowered = sql.lower()
        self.assertIn('begin;', lowered)
        self.assertIn('commit;', lowered)
        self.assertNotIn('delete ', lowered)
        self.assertNotIn('truncate ', lowered)


    def test_point_metadata_keeps_only_row_specific_fields(self):
        # 批次共用的來源資訊不再逐筆重複存；item_codes／item_key 與 dimensions.item_key 重複，也不再存。
        html = page([['FK41', '甜椒', '', '10', '100', '20', '10', '5'], ['FK42', '甜椒', '', '20', '300', '30', '20', '10']])
        rows, _ = parse_page(html, DAY, '1', 'V')
        point, = aggregate(rows, DAY, '1', 'V')
        self.assertEqual(point['metadata'], {'item_code_count': 2})
        self.assertEqual(point['dimensions']['item_key'], 'FK41|FK42')

    def test_batch_record_is_written_in_the_same_transaction(self):
        batch = '0b4a8f7e-2c5d-4e1a-9b3c-7d6e5f4a3b2c'
        summary = {'mode': 'imported', 'range_from': '2026-09-01', 'range_to': '2026-09-02',
                   'completed_at': '2026-09-02T05:00:00+08:00', 'workflow_run': '12345', 'import_batch_id': batch}
        before = dict(summary)
        sql = import_sql([{'observed_on': '2026-09-02'}], summary, batch_id=batch)
        lowered = sql.lower()
        self.assertLess(lowered.index('begin;'), lowered.index('insert into public.market_import_batches'))
        self.assertLess(lowered.index('insert into public.market_import_batches'), lowered.index('insert into public.market_data_points'))
        self.assertLess(lowered.index('insert into public.market_data_points'), lowered.index('commit;'))
        self.assertIn(f"jsonb_build_object('import_batch_id','{batch}')", sql)
        self.assertIn("'2026-09-01'::date", sql)
        self.assertIn("'tapmc_daily'", sql)
        # 匯入後會把 daily_import_last_run 讀回與 summary 逐項比對，import_sql 不得改動 summary。
        self.assertEqual(summary, before)

    def test_batch_id_must_be_a_uuid(self):
        with self.assertRaises(ValueError):
            import_sql([], {'mode': 'imported'}, batch_id="x'); drop table users; --")
        self.assertIn('insert into public.market_import_batches', import_sql([], {'mode': 'imported'}).lower())


if __name__ == '__main__':
    unittest.main()


def moa_row(code, name, kind='N04', market='台北一', avg='10', qty='100', high='20', middle='10', low='5'):
    return {'TransDate': roc_dot(DAY), 'TcType': kind, 'CropCode': code, 'CropName': name, 'MarketCode': '109',
            'MarketName': market, 'Upper_Price': high, 'Middle_Price': middle, 'Lower_Price': low,
            'Avg_Price': avg, 'Trans_Quantity': qty}


class MarketBackupSourceTests(unittest.TestCase):
    # 農業部開放資料的作物代號與官網品名代號相同，但 CropName 是「品名-品種」合併字串，
    # 因此品名一律沿用官網既有對照；彙總結果必須與官網完全一致。
    CODE_ITEMS = {('第一市場', '蔬菜', 'FK41'): '甜椒', ('第一市場', '蔬菜', 'FK42'): '甜椒'}

    def test_backup_matches_website_aggregate(self):
        html = page([['FK41', '甜椒', '彩色種', '10', '100', '20', '10', '5'],
                     ['FK42', '甜椒', '彩椒黃色', '20', '300', '30', '20', '10']])
        web_rows, _ = parse_page(html, DAY, '1', 'V')
        backup_rows, stats = moa_scope([moa_row('FK41', '甜椒-彩色種'),
                                        moa_row('FK42', '甜椒-彩椒黃色', avg='20', qty='300', high='30', middle='20', low='10'),
                                        moa_row('G11', '香蕉', kind='N05')], DAY, '1', 'V', self.CODE_ITEMS)
        self.assertEqual(stats['source'], MOA_IMPORT_METHOD)
        web_point, = aggregate(web_rows, DAY, '1', 'V')
        backup_point, = aggregate(backup_rows, DAY, '1', 'V')
        self.assertEqual(backup_point['external_key'], web_point['external_key'])
        self.assertEqual(backup_point['dimensions'], web_point['dimensions'])
        self.assertEqual(backup_point['measures'], web_point['measures'])

    def test_unknown_code_stops_the_backup(self):
        with self.assertRaisesRegex(RuntimeError, '人工確認'):
            moa_scope([moa_row('ZZ99', '新品名-新品種')], DAY, '1', 'V', self.CODE_ITEMS)

    def test_wrong_market_or_date_is_rejected(self):
        with self.assertRaisesRegex(ValueError, '市場或日期'):
            moa_scope([moa_row('FK41', '甜椒-彩色種', market='台北二')], DAY, '1', 'V', self.CODE_ITEMS)

    def test_duplicate_code_is_not_double_counted(self):
        rows, stats = moa_scope([moa_row('FK41', '甜椒-彩色種'), moa_row('FK41', '甜椒-彩色種')], DAY, '1', 'V', self.CODE_ITEMS)
        self.assertEqual(stats['duplicate_rows'], 1)
        self.assertEqual(aggregate(rows, DAY, '1', 'V')[0]['measures']['quantity'], 100)

    def test_batch_record_marks_the_source_actually_used(self):
        self.assertEqual(batch_source([{'source': 'tapmc_daily'}])[0], 'tapmc_daily')
        method, url = batch_source([{'source': 'tapmc_daily'}, {'source': MOA_IMPORT_METHOD}])
        self.assertEqual((method, url), (MOA_IMPORT_METHOD, MOA_URL))
        sql = import_sql([], {'scopes': [{'source': MOA_IMPORT_METHOD}]})
        self.assertIn(sql_literal(MOA_IMPORT_METHOD), sql)
        self.assertIn(sql_literal(MOA_URL), sql)
