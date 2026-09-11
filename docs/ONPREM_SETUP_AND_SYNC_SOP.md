# 地端伺服器設機、雲地同步與自動化排障標準作業程序（SOP）

> **文件版本**：v1.0 (2026-09-11)  
> **適用目標**：臺北農產 巡檢／報修／派工系統 地端獨立運作節點（`192.168.50.192` / 外部 `https://1.34.250.22:5057`）與未來新設主機。

---

## 1. 架構全景與網路拓撲標準

```
                       [ 外部瀏覽器 / 行動端 ]
                                  │ HTTPS :5057
                                  ▼
                     [ 路由器轉發 5057 -> 443 ]
                                  │
    ┌─────────────────────────────┴─────────────────────────────┐
    │  Windows Server 主機 (192.168.50.192)                     │
    │                                                           │
    │  [ IIS Web 伺服器 (Port 443) ]                           │
    │   ├─ 靜態網站目錄：C:\InspectionRuntime\site\Inspection   │
    │   │   └─ Next.js 導出 HTML/CSS/JS (全繁中無編譯依賴)      │
    │   │                                                       │
    │   └─ URL Rewrite + ARR 反向代理                           │
    │       └─ ^(auth|rest|storage|realtime|functions)/(.*)     │
    │                  │                                        │
    │                  ▼ (轉發至 127.0.0.1:18080 或 WSL IP)    │
    │  [ WSL2 / Docker Supabase 堆疊 (C:\supabase-0705) ]       │
    │   ├─ Kong / Envoy 閘道 (:8000 / :54321)                  │
    │   ├─ GoTrue Auth 認證 (:9999)                            │
    │   ├─ PostgREST 資料 API (:3000)                          │
    │   ├─ Edge Runtime / 驗證碼服務 (:9000)                    │
    │   └─ PostgreSQL 15 資料庫 (supabase_db volume: 168MB)    │
    └───────────────────────────────────────────────────────────┘
```

---

## 2. 磁碟與檔案系統硬性規範（避坑指南）

1. **嚴禁將 Docker 服務掛載於 Google Drive 虛擬串流磁碟（G: / H:）**：
   - Docker Desktop / WSL2 透過 Host 檔案系統掛載虛擬磁碟時，內部讀取為空，會造成 `edge-runtime` 啟動失敗報 `failed to determine entrypoint`。
   - **規範**：所有 Docker 專案與設定檔必須放置於實體 NTFS 磁碟（如 `C:\supabase-0705` 與 `C:\InspectionRuntime`）。
2. **跨平臺腳本換行符號（CRLF vs LF）**：
   - Windows PowerShell 產生的文字預設為 CRLF（`\r\n`），傳入 WSL Bash 執行會造成 `set -eu\r` 報 `set: Illegal option -`。
   - **規範**：所有產生給 Linux/WSL 執行的 `.sh` 暫存檔，必須先透過 `.Replace("`r`n", "`n")` 轉為純 LF。

---

## 3. 新設主機／災後重建標準化步驟（4 階段）

### 階段一：建立實體目錄與環境變數
在系統管理員 PowerShell 執行：
```powershell
# 1. 建立實體專案目錄
New-Item -ItemType Directory -Path "C:\supabase-0705\supabase\functions" -Force
New-Item -ItemType Directory -Path "C:\InspectionRuntime\site\Inspection" -Force

# 2. 複製 Functions 與設定檔至實體硬碟
robocopy "G:\我的雲端硬碟\AI\Codex\北農巡檢系統\supabase\functions" "C:\supabase-0705\supabase\functions" /E /XD node_modules
```

### 階段二：啟動後端堆疊與網路修復
```powershell
powershell -ExecutionPolicy Bypass -File "G:\我的雲端硬碟\AI\Codex\北農巡檢系統\tools\repair-onprem-login-wsl.ps1" -Apply
```
*該腳本會自動完成：*
- 檢查 WSL Docker 容器狀態並拉起。
- 注入長度 32+ 位元組的安全 `CAPTCHA_SECRET` 至 `.env`。
- 自動將 Edge Runtime 容器加入 Kong/Envoy 所在的內部網路。
- 設定 Windows `netsh` portproxy 橋接與 IIS 反向代理規則。

### 階段三：同步最新前端網頁產物
```powershell
powershell -ExecutionPolicy Bypass -File "G:\我的雲端硬碟\AI\Codex\北農巡檢系統\tools\start-iis-site-sync.ps1"
```
*該腳本會自動驗證 GitHub Release 簽章，並將最新網頁原子覆蓋至 IIS 實體目錄。*

### 階段四：同步後端 Edge Functions
```powershell
powershell -ExecutionPolicy Bypass -File "G:\我的雲端硬碟\AI\Codex\北農巡檢系統\tools\sync-local-edge-functions.ps1" -Apply
```

---

## 4. 日常雲端與地端雙向同步機制

| 同步對象 | 同步觸發時機 | 執行工具／指令 | 驗證方式 |
|---|---|---|---|
| **前端靜態網頁** | 雲端 GitHub 每次 Commit 上線後 | `start-iis-site-sync.ps1` | 開啟登入頁確認版號與畫面 |
| **後端 Edge Functions** | 業務邏輯／驗證碼／報表 API 更新時 | `sync-local-edge-functions.ps1 -Apply` | 檢查驗證碼回傳 `challenge_id` |
| **資料庫結構 (DDL)** | 新增資料表／欄位／檢視表時 | 依序執行 `supabase/migrations/*.sql` | 查詢 PostgREST 表清單 (87+ 張表) |
| **市場行情資料** | 每日清晨 05:00 ~ 12:00 | 自動由 `market_daily_import.py` 匯入 | 看板顯示當日成交量價 |

---

## 5. 常見故障與自動化自癒排障表

| 故障現象 | 根本原因 (Root Cause) | 一鍵修復指令 |
|---|---|---|
| **登入頁提示「驗證碼載入失敗」** | Edge Runtime 容器離線、未連入閘道網路，或缺少 CAPTCHA_SECRET | `powershell -ExecutionPolicy Bypass -File tools\repair-onprem-login-wsl.ps1 -Apply` |
| **點擊登入後提示 401 Unauthorized** | IIS 缺少 `/auth` 與 `/rest` 轉發規則，請求被 IIS 本身拒絕 | `powershell -ExecutionPolicy Bypass -File tools\repair-onprem-login-wsl.ps1 -Apply` |
| **功能頁面出現空白或樣式異常** | IIS 站台尚未同步最新 GitHub Pages 產物 | `powershell -ExecutionPolicy Bypass -File tools\start-iis-site-sync.ps1` |
| **交接簿／排班選單缺少新欄位** | 本地資料庫未套用最新 migrations | 在 SQL Editor 套用 `supabase/migrations/` 下最新 SQL |

