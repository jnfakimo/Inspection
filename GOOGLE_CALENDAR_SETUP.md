# Google 個人行事曆串接設定

本功能採「每位登入者各自授權」模式。Google refresh token 只會以 AES-256-GCM 加密後存於 Supabase，瀏覽器不保存 token；帳號綁定入口位於全站共用的「個人資料設定」，不另設獨立系統頁面。

## Google Cloud 設定

1. 在 Google Cloud Console 建立或選擇專案，啟用 **Google Calendar API**。
2. 設定 OAuth consent screen；若應用尚在測試階段，將實際使用者加入 Test users。
3. 建立 OAuth 2.0 Client ID，Application type 選擇 **Web application**。
4. Authorized redirect URI 填入：

   `https://qztffronusdhgxhjjubt.supabase.co/functions/v1/google-calendar-callback`

## Supabase 設定

先套用 migration：

```powershell
supabase db push
```

建立一組 32 bytes 的隨機 Base64 金鑰，並將 Google 憑證與金鑰設為 Edge Function secrets。請勿把實際值提交到 Git：

```powershell
supabase secrets set GOOGLE_CALENDAR_CLIENT_ID="<Google Client ID>"
supabase secrets set GOOGLE_CALENDAR_CLIENT_SECRET="<Google Client Secret>"
supabase secrets set GOOGLE_CALENDAR_REDIRECT_URI="https://qztffronusdhgxhjjubt.supabase.co/functions/v1/google-calendar-callback"
supabase secrets set GOOGLE_TOKEN_ENCRYPTION_KEY="<32 bytes Base64>"
```

部署四個本次有異動的函式：

```powershell
supabase functions deploy app-api
supabase functions deploy google-calendar
supabase functions deploy google-calendar-callback --no-verify-jwt
supabase functions deploy google-calendar-worker --no-verify-jwt
```

只有 `google-calendar-callback` 與受 `CRON_SECRET` 保護的 `google-calendar-worker` 使用 `--no-verify-jwt`。登入後的 `google-calendar` API 保留平台 JWT 驗證；callback 另外驗證一次性 state、PKCE、期限與瀏覽器指紋。

## 使用流程

1. 登入 V2 系統，點選頁首的「個人資料」。
2. 在「Google 個人行事曆」按「連結 Google 帳號」並完成同意。
3. 新增會議室預約時保留「同步到我的 Google 行事曆」勾選。
4. 建立、核准變更或取消預約後，系統會新增、更新或取消本人 `primary` 行事曆中的對應活動。

解除連結會撤銷後續存取並清除系統端 token；為避免未經確認刪除個人資料，解除前已建立在 Google 的既有活動會保留。
