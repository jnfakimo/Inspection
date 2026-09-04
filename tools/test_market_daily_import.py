from datetime import date
import unittest

from market_daily_import import aggregate, day_chunks, import_sql, parse_page, PREFIX, sql_literal

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

    def test_local_sql_is_atomic_and_non_destructive(self):
        sql = import_sql([], {'mode': 'local_sql'})
        lowered = sql.lower()
        self.assertIn('begin;', lowered)
        self.assertIn('commit;', lowered)
        self.assertNotIn('delete ', lowered)
        self.assertNotIn('truncate ', lowered)


if __name__ == '__main__':
    unittest.main()
