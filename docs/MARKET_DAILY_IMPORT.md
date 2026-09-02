# 北農每日行情自動匯入

- 來源：[北農單日交易行情查詢](https://www.tapmc.com.tw/Pages/Trans/Price1)。固定選擇「2.全場交易行情」，抓取第一／第二市場的蔬菜／水果。
- 排程：GitHub Actions `Market daily import`，每日臺灣時間 12:00（UTC 04:00）。由雲端執行，本機關機不影響；GitHub 可能延後派發，並非準點保證。
- 每次查詢當日與前兩日，補抓尚未結帳或短暫失敗的資料。官網明示「尚未結帳或無資料」時記錄警示，不宣稱休市，也不寫入零量或刪除既有資料。
- 寫入既有 `tapmc_market_actual`，供市場營運分析、儀表板與公開看板共同使用。依日期、市場、品類、品名彙總，品名代號集合及 SHA256 自然鍵與歷史匯入一致。
- 同代號、同品名及相同量價的別名列只計一次；同代號量價衝突則中止。平均價以成交量加權，成交金額為平均價乘成交量的推估值。
- 所有來源抓取與驗證完成後才開啟單一資料庫交易。檢查日期、查詢條件、結果標頭、欄位、總筆數與數值；既有品項代碼集合改變或品項消失時整批回滾，交由人工核對，不刪除資料。
- 工作流程使用已設定的 `SUPABASE_ACCESS_TOKEN`，比照資料庫備份經 Management API 存取。密鑰不寫入檔案或紀錄。
- 成功摘要與各組筆數保存在 Actions 執行摘要及資料來源設定 `daily_import_last_run`，寫入後再讀回驗證。失敗以非零退出碼讓 Actions 標示失敗；通知沿用 GitHub 個人的 Actions 通知設定。

## 手動補跑與驗證

在 GitHub Actions 選 `Market daily import` → `Run workflow`。日期留空抓臺灣今天，或指定 `YYYY-MM-DD`（會同時回補前兩天）；勾選 `dry_run` 可只試讀。

本機使用 Python 3.12：

```sh
python -m pip install -r tools/market-import-requirements.txt
python -m unittest discover -s tools -p 'test_market_daily_import.py'
python tools/market_daily_import.py --date 2026-09-02 --lookback 1
```

本機預設不寫資料。正式匯入需由安全環境提供 token，並加 `--execute`。可用 `--lookback 1`～`7` 控制回補天數。

若來源有格式異動，先修正解析及測試；若既有品項代碼集合異動，核對原始量價後再決定資料修正，不能直接放寬保護或清空歷史資料。
