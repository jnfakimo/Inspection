# 靜態資安掃描

## 本機檢查

```powershell
npm run security:secrets
npm run security:gitleaks
npm run security:semgrep
npm run test:patrol-timeout-secret
```

- `security:gitleaks` 只掃描 Git 追蹤及尚未追蹤、但未被忽略的目前原始碼，並先複製到本機暫存目錄，避免雲端磁碟造成目標列舉失敗。
- CI 使用完整 Git 歷史執行 Gitleaks；歷史例外以提交、路徑、規則及行號的精確指紋記錄於 `.gitleaksignore`，新增或移動的內容不會自動放行。
- `security:semgrep` 掃描 `web`、`system`、`supabase/functions`、`supabase/migrations` 與 `backend` 的維護中原始碼，排除建置產物、大型圖資及第三方程式庫。
- 任一工具回傳非零狀態即使 CI 失敗。

## 公開瀏覽器金鑰

Supabase anon key、Firebase Web API key 與 VAPID public key 是瀏覽器端公開識別值，不等於伺服器秘密；放行必須同時符合指定檔案與指定變數名稱。`service_role`、CRON secret、服務帳戶私鑰及存取權杖一律不得進入版控。

Firebase Web API key 仍須在 Google Cloud Console 設定：

1. 應用程式限制選擇「網站」，只允許實際使用的 GitHub Pages、正式地端網址與必要的開發網址。
2. API 限制只保留 Firebase Authentication、Firebase Cloud Messaging 等實際啟用的服務。
3. 變更前先盤點正式、地端與內網來源，避免漏列合法來源而中斷通知或登入。

API key 限制屬雲端專案設定，不能只由原始碼掃描證明完成；稽核時須另外保存 Google Cloud Console 的限制設定證據。
