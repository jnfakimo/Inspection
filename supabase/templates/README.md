# Supabase Auth 信件範本（繁體中文）

Supabase 內建的認證信件是全英文預設範本。這裡放本專案的繁中版本，讓範本進版控、
可以 review、換人接手時看得到，而不是只存在於主控台裡。

## 目前只有一封會真的寄出

| 檔案 | 主控台對應 | 現況 |
|---|---|---|
| `recovery.html` | Reset Password | **使用中**——使用者唯一會收到的系統信 |
| `confirmation.html` | Confirm signup | 不會寄出（信箱確認已關閉） |
| `invite.html` | Invite user | 不會寄出（帳號由後台 `admin.createUser` 直接建立） |
| `magic_link.html` | Magic Link | 不會寄出（本系統走帳號密碼＋驗證碼登入） |
| `email_change.html` | Change Email Address | 不會寄出 |
| `reauthentication.html` | Reauthentication | 不會寄出 |

後五封先備妥，是為了日後若在主控台啟用，使用者不會突然收到英文預設信。

## 主旨（Subject heading 欄位，與內文分開設定）

| 範本 | 主旨 |
|---|---|
| recovery | `重設您的密碼｜北農智慧巡檢平台` |
| confirmation | `請確認您的電子郵件｜北農智慧巡檢平台` |
| invite | `您已獲邀加入北農智慧巡檢平台` |
| magic_link | `您的登入連結｜北農智慧巡檢平台` |
| email_change | `確認變更電子郵件｜北農智慧巡檢平台` |
| reauthentication | `您的驗證碼｜北農智慧巡檢平台` |

## 怎麼套用

主控台 → Authentication → Emails → 選範本 → 主旨貼上表格裡那行、內文把對應
`.html` **整份**貼進 Message body → Save。六封各做一次。

### 不要用 `supabase config push`

`supabase/config.toml` 裡**沒有 `[auth]` 段**。CLI 的 `config push` 會用預設值補滿
整份 auth 設定再推上去，`site_url`、Redirect URLs 白名單、JWT 效期、註冊開關全部
會被蓋成預設值——那會直接弄壞正式環境的登入。要改認證設定請走主控台，或用
Management API 只 PATCH 需要的欄位。

## 改範本時的死線

- **`recovery.html` 的連結一定要是 `{{ .ConfirmationURL }}`**，不可以換成
  `{{ .TokenHash }}` 那種形式。登入頁是靠網址 hash 裡的
  `#type=recovery&access_token=...` 手動 `setSession`（`web/app/login/page.tsx`，
  修正 commit `d1265ce`）。換掉連結形式，整條重設密碼流程會再次中斷，而且畫面
  只會顯示「重設連結已失效」，把人指向完全錯誤的原因。
- `reauthentication.html` 用的是驗證碼 `{{ .Token }}`，不是連結，別跟其他五封一起改。
- **不要在範本裡寫 HTML 註解**。Go 樣板引擎不認得 HTML 註解，寫在註解裡的
  `{{ .TokenHash }}` 一樣會被代入真實 token 並隨信寄出。說明寫在這份 README。
- 信件端不能用外部 CSS、`<style>` 區塊或網頁字型，樣式一律行內；版面用 `table`
  排，Outlook 不支援 flex/grid。
