# Python 設備訊號服務

本機接收基礎已可執行：HTTP 訊號 → Pydantic 驗證 → SQLite 歷史 → 查詢 API／Prometheus 指標。
此服務是現有 Next.js／Node／Supabase 系統的介接準備，尚未接上正式戰情室畫面或實體設備。
不會自動建立報修單、推送通知或寫入正式 Supabase。MQTT、Modbus、OPC UA 套件已列為
可選依賴；安裝後驗證匯入，待廠商協定確認後才實作設備接收接頭。

## 使用方式

從本目錄執行（Windows PowerShell）：

```powershell
.\run.ps1 -Action Install
.\run.ps1 -Action Test
.\run.ps1 -Action Demo
.\run.ps1 -Action Audit
```

`Install` 使用 uv.lock 鎖定版本，安裝主程式、開發工具及 protocols 套件。
Python 環境固定在 `%LOCALAPPDATA%\Inspection\python-signals\.venv`，避免放在雲端同步磁碟。
`Demo` 實際啟動 loopback HTTP 服務、使用 HTTPX 送出正常／異常／恢復與舊資料，
檢查權限、市場隔離、去重、歷史與指標，最後停止測試服務。
每次模擬都有獨立資料夾；報告、日誌、SQLite 及隨機產生的測試金鑰保存在
`%LOCALAPPDATA%\Inspection\python-signals\demo\<run-id>`，不提交到 Git。
報告中不包含金鑰；`config.local.json` 含測試金鑰，勿分享或提交。

可使用 Demo 回報的設定檔，持續啟動本機接收服務：

```powershell
.\run.ps1 -Action Serve -ConfigPath 'C:\實際本機路徑\config.local.json'
```

預設網址為 `http://127.0.0.1:8767`。`/healthz` 可確認存活；其餘端點需要 Bearer 金鑰。
此版本只有 API，沒有新增另一套登入頁或公開管理頁；按 Ctrl+C 停止。

## 訊號契約

`POST /v1/signals` 使用每個設備專屬 Bearer 金鑰：

```json
{
  "event_id": "c19da565-65f3-4242-bf4d-1892c5a16459",
  "occurred_at": "2026-09-13T12:00:00+08:00",
  "value": 4.5
}
```

設備、所屬市場、量測項目、單位、門檻由設定檔綁定，發送端不得覆寫。
每個設定項代表一個訊號點；設備有多個量測項目時，先拆成多個訊號點。
數值超過 `alarm_above` 標記異常；此門檻只供原型驗證，正式值須由設備負責人確認。
只接受含時區的時間、有限數值及 UUID。設備時間超前超過 60 秒拒收。
同設備、同事件 ID 重送不增加紀錄；內容不同回應 409，保留原紀錄。
舊訊號可補存，但不覆蓋較新的設備發生時間。每筆保留原始 UTC 發生時間與平台接收時間。

查詢金鑰與設備金鑰分開；查詢金鑰是「服務端管理讀取」權限，可讀兩市，不能下發到瀏覽器。
設備金鑰只能寫入自己的訊號點，不能查詢或跨市場冒寫。

- `GET /v1/signals/latest?market=1`：最新值；超過 stale_seconds 標示資料逾時，尚無訊號顯示未收到。
- `GET /v1/signals/history?market=1&limit=100`：歷史紀錄（每次最多 500 筆）。
- `GET /metrics`：受保護的 Prometheus 請求計數，隨服務重啟歸零。
- SQLite `audit`：操作時間、已辨識的設備／讀取端、操作類別及 HTTP 結果；不記錄金鑰／原始內容。

## 與正式系統的下一步

需要設備型號、協定、位址、訊號點表、單位倍率及更新頻率，才能選用 paho-mqtt、
pymodbus 或 asyncua 接到現場。此版本未實作斷線佇列、自動重送、告警事件合併或報修串接。

正式上線需由既有 Node/app-api 驗證人員的市場與子系統權限後，在伺服器端呼叫本服務，
不要將管理查詢金鑰送入網頁。設備網路經受控閘道器／TLS 反向代理接入；現階段僅綁定 loopback。
SQLite 適用於本機驗證；集中化長期歷史、多人查詢及防竄改稽核應接既有 PostgreSQL、
集中日誌、備份及保留政策。此版本不宣稱已完成 ISO 27001 驗證。

## 品質檢查

本機虛擬環境的 Python 可執行 `-m ruff check .`、`-m mypy service.py`、
`-m bandit -r service.py`、`-m pytest`、`-m pip_audit`。
pip-audit 會查詢套件弱點服務；不會傳送訊號資料或帳號內容。
