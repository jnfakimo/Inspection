# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。durable 的技術規範寫在 `AGENTS.md`，
> 完整脈絡與踩坑細節寫在 `Obsidian/`，這裡不重複。

## ⏯️ 目前做到哪

**2026-09-04～09-05：市場公開看板品名代碼／一頁寬版型；北農行情 110 年起歷史回補完成；
內網後端停擺待處理。**

### 已完成（雲端）

- 全場均價表改用全國品名代碼（`item_key`，同品名多代碼以「、」串接）、補成交量欄、
  表頭兩行、一頁寬（窄面板取消 1.18 倍）；登入版 ▲▼ 顏色修正（規則改掛 `.market-board-page`）。
- **北農全場交易行情 2021-01-01～2026-09-04 已全部寫入雲端** `tapmc_market_actual`
  （每年約 6～7 萬筆，總計約 50 萬筆）。流程：`Market history backfill` workflow（`--from` 區間、
  每 7 天一交易）；9/5 起 GitHub runner 連官網一律 ConnectTimeout，改由本機
  `--raw-output` 抓原始列 → GitHub Release `market-raw-20260905` → workflow `raw_release` 匯入。
  逐品名代號（含品種）原始列保存在該 Release 與各 run 的 artifact。
- 資料量變大後 `market_source_date_ranges` 全表掃描逾時（看板 503），已改為每來源最近 90 天
  視窗（migration `20260905130000_market_source_date_ranges_window.sql`，雲端已套用）。

### 待處理

1. **內網後端停擺**：`1.34.250.22:5057` 的 `/rest`、`/auth`、`/functions` 全 502，Docker 主機
   `192.168.50.192` ping 通但 54321／8000 無回應 → 本機 Supabase Docker 堆疊沒在跑。
   須在伺服器啟動後：(a) 跑 `tools/sync-local-edge-functions.ps1 -Apply` 更新 app-api
   （否則品名代碼欄全是「—」）；(b) 套用 `20260905130000_market_source_date_ranges_window.sql`；
   (c) 若要內網也有歷史行情，分年跑 `run-local-market-import.ps1 -From … -To …`
   或改寫成讀 Release 原始列。
2. 資料粒度仍是「日期×市場×品類×品名」。若要逐品名代號（含品種）呈現，原始列已備妥，
   但需改匯入模型與看板表格（見 `docs/MARKET_DAILY_IMPORT.md`）。


**2026-09-05：自架站台 `1.34.250.22:5057`（內網主機 192.168.50.192）登入修復——尚未完成。**
現場「驗證碼服務暫時無法連線」，登入進不去。這是**自架部署**問題（那台跑
`AI\Antigravity\0705` 這份專案的 Supabase 本機 Docker stack），與 market 主線開發無關。

已定位出登入的三層根因：

1. **anon key**（repo 已處理）：前端若用雲端 anon key 打本機 GoTrue（不同 JWT secret）會 401。
   `web/lib/config.ts` 已有 `useBrowserOrigin` 分流，自架站台改用 `LOCAL_SUPABASE_ANON_KEY`
   （issuer=`supabase`、iat 2026-08-31 那把，是本機 stack 真正的 anon key）。**本次未動這檔。**
2. **IIS 反代**：`5057` 目前只把 `/functions` 反代到本機 54321，`/auth`、`/rest` 沒轉
   （會回 IIS 自己的純文字 `401 Unauthorized`）。範本已備：
   `tools/selfhosted-iis-supabase-proxy.web.config`。
3. **edge_runtime boot（主卡點）**：`supabase_edge_runtime_0705` 把 functions 從
   **Google Drive**（`G:\我的雲端硬碟\AI\Antigravity\0705\supabase\functions`）bind mount，
   Docker Desktop 經 WSL2 掛 Google Drive 虛擬磁碟時**容器內讀不到內容**
   → `failed to determine entrypoint`。

## 🚦 目前狀態

- **登入仍不通**，卡在第 3 層。
- functions 已複製到伺服器真實磁碟 `C:\supabase-0705\functions`（`username-login/index.ts`
  20789 bytes 正常）。完整 supabase 目錄也複製到 `C:\supabase-0705\supabase`。
- 用純 docker 手動重建 edge_runtime 掛 C: 後，錯誤變成 `main worker boot error`：
  CMD 是 `edge-runtime start --main-service=/root`，而 `/root` 的 main router 是
  **`supabase start` 啟動時即時生成注入的**，純 docker `docker run` 補不出來。
- `db` 資料在 `supabase_db_0705` volume（168MB），**全程未動**。

## ➡️ 下一步

1. **找到 supabase CLI**（伺服器 192.168.50.192 上）：`supabase` 不在 `C:\WINDOWS\system32`
   的 admin PowerShell PATH（多半裝在使用者 PATH：scoop shims / winget / 或 npx）。
   stack 當初是 `supabase start` 起的，CLI 一定存在於某環境。找到後：
   ```
   cd C:\supabase-0705
   <supabase 完整路徑> start      # 或在當初起 stack 的那個終端/程式裡跑
   ```
   `supabase start` 會重用 `db` volume、用 **C: 的 functions** 重建 edge_runtime，
   並自動生成 `/root` main service。**務必從 `C:\supabase-0705` 跑，不可回 Google Drive
   目錄跑**，否則 functions 又掛回 Drive、白做。
2. 通了驗證：`POST http://127.0.0.1:54321/functions/v1/username-login` body `{"action":"captcha"}`
   回 `challenge_id`＋`image` 即成功；回登入頁 `Ctrl+Shift+R`。
3. 若前端走 origin proxy：IIS 補 `/auth`、`/rest` 反代（見 `tools/...web.config` 範本）。
4. 一勞永逸：把整個 `0705` 專案移出 Google Drive 到本機碟，固定從那裡 `supabase start`。

## ⚠️ 注意事項（本次新踩的坑）

- **Google Drive 上的專案不能給 Docker bind mount**：檔案在 Windows 端一切正常
  （Attributes=Normal、大小正確），但容器讀不到（虛擬串流磁碟 + WSL2 mount 不相容），
  症狀就是 `failed to determine entrypoint`。解法：放本機真實磁碟（C:）。
- **PowerShell 5.1 讀含中文的 `.ps1` 會用 Big5 解碼 → 全亂碼 → 語法爆掉**。
  自架用的腳本要**純 ASCII**：`tools/fix-selfhosted-login.ps1` 訊息全英文、來源路徑
  執行時從 `docker inspect` 動態取得，不寫死中文。
- **PowerShell 貼多行腳本會在 `>> }` 斷掉**——改用單行、base64 一行、或存檔 `-File` 執行。
- **本機 Supabase 埠**：54321 API/Kong、54322 Postgres、54323 Studio；`supabase_vector_0705`
  一直 `Restarting`（log sink，與登入無關，可先不理）。路由器：外部 5057→內部
  192.168.50.192:443(IIS)、54321/54322/54323 直接對外轉發。
- 本次新增 `tools/fix-selfhosted-login.ps1`（純 docker 重建 edge_runtime，**缺 main service，
  僅供理解流程，非最終解**）、`tools/selfhosted-iis-supabase-proxy.web.config`（IIS 反代範本）。

## 主線（market 開發，本次未涉及）

本 session 只碰自架部署除錯。repo 主線（SYS-10/11/12 market dashboard 等）進度以 `git log`
為準（近期 `bb7dbb12a`、`7c92d10a6`…）。2026-08-28 之前的圖資效能／手機版版型交接，
狀態已隨主線推進，以 git log 為準。

## 🕐 最後更新

2026-09-05 19:42 · Claude Opus 4.8 @ DESKTOP-0CFB6UK（開發機；操作對象為伺服器 192.168.50.192）
· Git push：✅ 已推（tools 兩檔 `35359f8a6`；自架登入交接已隨 `adff540bc` 進 repo）
· 本次：診斷自架站台登入三層根因、functions 已複製到伺服器 `C:\supabase-0705`、確認需用
  supabase CLI 從 C: 重啟以生成 main service（卡在伺服器上找不到 CLI）；新增兩支自架部署工具檔。
