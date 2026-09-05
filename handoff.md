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

1. **內網後端不通**（⚠️ 這段原本的判斷有誤，見下方「自架站台登入修復」）：
   實際上本機 Supabase 堆疊**有在跑**，只是 Kong 走 HTTPS，先前用 `http://…:54321`
   探測才誤判成「沒回應」。真正的問題是 edge_runtime 沒起來 + IIS 反代缺漏。
   須在登入修好後：(a) 跑 `tools/sync-local-edge-functions.ps1 -Apply` 更新 app-api
   （否則品名代碼欄全是「—」）；(b) 套用 `20260905130000_market_source_date_ranges_window.sql`；
   (c) 若要內網也有歷史行情，分年跑 `run-local-market-import.ps1 -From … -To …`
   或改寫成讀 Release 原始列。
2. 資料粒度仍是「日期×市場×品類×品名」。若要逐品名代號（含品種）呈現，原始列已備妥，
   但需改匯入模型與看板表格（見 `docs/MARKET_DAILY_IMPORT.md`）。


**2026-09-05：自架站台 `1.34.250.22:5057`（內網主機 192.168.50.192）登入修復——尚未完成，
但根因已改寫。** 稍早那版診斷有兩處是錯的，實測後更正如下。

### 實測結果（2026-09-05，從開發機同時探測內網與外部）

| 端點 | 直連本機 Kong `192.168.50.192:54321` | 走 `https://1.34.250.22:5057` |
|---|---|---|
| `/auth/v1/health` | **200** GoTrue v2.196.0 | 401 IIS 純文字 |
| `/rest/v1/` | **200** postgrest/14.5（87 張表，schema 正確） | 401 IIS 純文字 |
| `/functions/v1/username-login` | **503** kong `name resolution failed` | 200 captcha，但**來自雲端** |
| `/storage/v1/bucket` | — | 400，**來自雲端** |

### 更正兩處先前的誤判

1. **本機 stack 沒有停擺。** 先前記「54321 無回應」是因為對它送了 plain HTTP——
   這台的 **Kong 走 HTTPS**，`http://…:54321` 會回 Kong 的
   「400 The plain HTTP request was sent to HTTPS port」。改用 `https://` 就通了，
   GoTrue 與 PostgREST 都健康，資料庫是對的那顆（87 張表、含 patrol_shifts／equipment／markets）。
2. **anon key 不是原因。** 拿雲端 key 與本機 key 分別打本機
   `/auth/v1/token?grant_type=password`，兩把都回同一個 `400 invalid_credentials`——
   本機 GoTrue 根本沒驗 anon key 的簽章。`web/lib/config.ts` 的
   `LOCAL_SUPABASE_ANON_KEY` 分流可以留著，但它不影響登入。

### 真正剩下的兩個卡點

1. **edge_runtime 沒跑**：本機 Kong 對 `/functions` 一律 503 `name resolution failed`
   （Docker 內嵌 DNS 解不到已停止的容器名）。仍須用 supabase CLI 從 `C:\supabase-0705`
   跑 `supabase start` 重建——純 `docker run` 補不出 `/root` main service，這點稍早的結論仍成立。
2. **IIS 反代指錯地方**：`/auth`、`/rest`、`/realtime` 完全沒反代（落到 IIS 自己的純文字 401）；
   `/functions`、`/storage` **被轉到雲端專案**（回應帶 `x-envoy-upstream-service-time`，
   `access-control-allow-origin` 是 `https://jnfakimo.github.io`）。
   這比「沒反代」更麻煩：`username-login` 會拿**雲端資料庫**驗身分、發出雲端 session，
   再被本機 GoTrue／PostgREST 拒絕。五個前綴必須指向同一個後端。

## 🚦 目前狀態

- **登入仍不通**，但卡點從「三層」收斂成上面兩個，且都有腳本可一次處理。
- functions 已複製到伺服器真實磁碟 `C:\supabase-0705\functions`（`username-login/index.ts`
  20789 bytes 正常）。完整 supabase 目錄也複製到 `C:\supabase-0705\supabase`。
- `db` 資料在 `supabase_db_0705` volume（168MB），**全程未動**。
- **本次只做讀取式探測，沒有對伺服器做任何變更**——開發機對那台沒有遠端執行權限
  （445 通但 admin share 拒絕、WinRM 5985/5986 關、SSH 22 關、Docker TCP 2375/2376 關），
  只有 HTTP/HTTPS 端點搆得到。所以下面全部要在伺服器上執行。

## ➡️ 下一步

**在伺服器 192.168.50.192 的「系統管理員」PowerShell 跑這支就好：**

```
powershell -ExecutionPolicy Bypass -File <repo>\tools\selfhosted-restore-login.ps1
```

不加參數是**空跑**，只印出它打算做什麼；確認計畫沒問題再加 `-Apply` 實際套用。
腳本會依序：列出 supabase 容器狀態與 Kong 的埠對應 → 在 PATH／scoop／winget／npm／
使用者設定檔裡找 supabase CLI → 檢查 `C:\supabase-0705` 是真實磁碟（不是 Google Drive）
→ `supabase start` → 自動判斷 Kong 是 https 還 http → 檢查 URL Rewrite／ARR 是否安裝、
開啟 ARR proxy → 找出綁在 443 的站台、**備份 web.config**、移除指向雲端的規則、
把 `^(auth|rest|storage|realtime|functions)/(.*)` → `https://127.0.0.1:54321/{R:1}/{R:2}`
插成第一條 → 最後對 `https://1.34.250.22:5057` 做端到端驗證。

`-Step stack|iis|verify` 可只跑其中一段；`-KongHost 192.168.50.192` 可從別台機器遠端跑
驗證段（IIS 段仍須在該台本機執行）。跑完三項端到端檢查都綠之後，回登入頁 `Ctrl+Shift+R`。

**若腳本在某一步卡住，各步驟的手動等價做法：**

1. 找 CLI：`Get-Command supabase`；沒有就翻 `~\scoop\shims`、
   `%LOCALAPPDATA%\Microsoft\WinGet\Links`、`%APPDATA%\npm`。
   stack 當初是 `supabase start` 起的，CLI 一定存在於某個環境。
2. 起 stack：`cd C:\supabase-0705` 再跑 `<supabase 完整路徑> start`。
   **務必從 `C:\supabase-0705` 跑，不可回 Google Drive 目錄跑**，否則 functions
   又掛回 Drive、白做。
3. 驗 function：對 `https://127.0.0.1:54321/functions/v1/username-login` POST
   `{"action":"captcha"}`（注意是 **https**），回 `challenge_id` 即成功。
4. IIS：範本在 `tools/selfhosted-iis-supabase-proxy.web.config`，**合併**進站台既有
   web.config，不要整檔覆蓋（安全標頭要保留）。
5. 一勞永逸：把整個 `0705` 專案移出 Google Drive 到本機碟，固定從那裡 `supabase start`。

## ⚠️ 注意事項（本次新踩的坑）

- **本機 Kong 走 HTTPS，別預設 http**。對 `http://…:54321` 探測會拿到 Kong 的
  400「plain HTTP request was sent to HTTPS port」，很容易被誤讀成「服務沒起來」——
  8/19 那版交接就是這樣把健康的 stack 判成停擺。`tools/fix-selfhosted-login.ps1` 裡的
  `http://127.0.0.1:54321` 也是同一個錯；新腳本改成兩種 scheme 都試。
- **判斷回應來自本機還是雲端，看標頭**：雲端 Supabase 帶
  `x-envoy-upstream-service-time`；本機 Kong 帶 `Server: kong/2.8.1`；
  IIS 自己擋掉的兩者都沒有、body 是純文字 `Unauthorized`。
  這三種一眼可分，比看狀態碼可靠得多。
- **ARR 反代到自簽憑證的 HTTPS 後端容易回 502.3**。腳本因此會先找 Kong 有沒有另外
  publish plain-HTTP 埠（先試 8000 再試 54321），有就拿它當反代目標；只有 HTTPS 時會
  先警告。若套完規則真的出現 502.3，就把 Kong 容器的 8000 埠 publish 到主機再重跑
  `-Step iis`。**IIS 段是這支腳本唯一沒被實跑驗證過的部分**（開發機沒裝 IIS），
  所以它預設空跑、且動手前一定先備份 web.config。
- **開發機對 192.168.50.192 沒有任何遠端執行權限**（445 通但 admin share 拒絕、
  5985/5986/22/2375/2376 全關）。要動那台一定得人到現場或遠端桌面，別再花時間找自動化路徑。
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
- 自架相關的三支工具檔：
  - `tools/selfhosted-restore-login.ps1` — **目前該用這支**。一鍵診斷＋修復，預設空跑。
  - `tools/selfhosted-iis-supabase-proxy.web.config` — IIS 反代範本（目標已改為
    `https://127.0.0.1:54321`，並記下 /functions 與 /storage 目前被轉到雲端這件事）。
  - `tools/fix-selfhosted-login.ps1` — 純 docker 重建 edge_runtime，**缺 main service，
    僅供理解流程，非最終解**；裡面的 `http://127.0.0.1:54321` 也是錯的 scheme。

## 主線（market 開發，本次未涉及）

本 session 只碰自架部署除錯。repo 主線（SYS-10/11/12 market dashboard 等）進度以 `git log`
為準（近期 `bb7dbb12a`、`7c92d10a6`…）。2026-08-28 之前的圖資效能／手機版版型交接，
狀態已隨主線推進，以 git log 為準。

## 🕐 最後更新

2026-09-05 · Claude Opus 5 @ DESKTOP-0CFB6UK（開發機；操作對象為伺服器 192.168.50.192）
· 本次：重新實測自架站台，**更正兩處誤判**（本機 stack 其實健康，只是 Kong 走 HTTPS；
  anon key 不是原因），確認真正卡點是 edge_runtime 沒跑 ＋ IIS 把 `/functions`、`/storage`
  轉到雲端；新增一鍵修復腳本 `tools/selfhosted-restore-login.ps1`（預設空跑，`-Apply` 才動手），
  修正 IIS 反代範本的 http→https。**未對伺服器做任何變更**（開發機無遠端執行權限）。
· Git push：待推
