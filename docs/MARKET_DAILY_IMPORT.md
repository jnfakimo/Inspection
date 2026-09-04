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

## 歷史回補（110 年起）

官網同一查詢頁可回查 110 年（2021）以後的每日行情，格式與現在相同；休市日回「該日尚未結帳或無資料」，直接略過。

- 雲端：GitHub Actions `Market history backfill` → `Run workflow`，填 `from`、`to`（含）。程式逐日抓四組（一市、二市 × 蔬菜、水果），**每 7 天一個交易**寫入；某批次失敗時之前批次已提交，錯誤訊息會標出該批次起日，重跑時把 `from` 改成該日即可（穩定鍵冪等，不會重複計量）。回補不覆蓋 `daily_import_last_run`。單次上限 6 小時，一年約 40 分鐘，建議一次 2～3 年。
- 內網：在伺服器執行 `tools/run-local-market-import.ps1 -From 2021-01-01 -To 2021-12-31`，流程同每日排程（產生 SQL → 單一連線寫入本機資料庫）。
- 逐品名代號（含品種）的原始列會另存 JSONL：雲端為 workflow artifact `market-raw-rows-<from>-<to>`（保留 90 天），內網在 `C:\InspectionRuntime\market-import-logs\raw-rows\`。目前資料庫粒度是「日期 × 市場 × 品類 × 品名」（同品名各品種代碼合併，代碼集合存於 `item_key`）；日後若要改成代碼粒度，可直接由這些原始列載入，不必重抓官網。
- 本機試跑：`python tools/market_daily_import.py --from 2021-01-05 --date 2021-01-12 --sql-output out.sql --raw-output raw/`。

# 北農行情：內網每日排程

雲端 GitHub Actions 與內網 IIS 現在各自更新自己的 Supabase。內網 Windows 工作排程 `Inspection Daily Market Import` 每日 12:00 啟動，至 18:00 每 30 分鐘重試，以處理第一、第二市場不同時間結帳。每次回補最近三日，使用穩定鍵冪等寫入。

本機流程由 `tools/run-local-market-import.ps1` 呼叫 `market_daily_import.py --sql-output`；來源四組都逐一驗證後才產生 SQL，資料庫在單一交易內寫入並讀回最新日期。執行紀錄在 `C:\InspectionRuntime\market-import-logs`，不含密鑰。

北農正式來源的看板日期只採一市、二市 × 蔬菜、水果四組完整日。中午部分市場尚未結帳時可先保留已取得明細，但量價趨勢不會把半日成交量當成完整日；後續重試補齊四組後自動切換。
