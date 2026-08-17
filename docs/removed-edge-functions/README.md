# 待移除的 Edge Function 原始碼封存

2026-08-17 自正式專案 `qztffronusdhgxhjjubt` 下載，供刪除前留底與必要時還原。

**這些檔案刻意不放在 `supabase/functions/`**，因為 `supabase functions deploy` 不帶
參數會部署該目錄下的所有函式，留在原處等於埋下日後被重新部署的風險。

## 盤點結果

四支皆停在 v12、最後更新 2026-06-24，程式碼與資料庫中**零呼叫**（唯二的字串出現在
本 repo 的文件備註）。對照組：`line-notify` 為 v17、2026-08-06 更新，是維護中的版本。

| Function | 大小 | 判定 |
| --- | --- | --- |
| `hyper-worker` | 674 B | Supabase 預設 Hello World 範本 |
| `dynamic-processor` | 674 B | 同上，與 `hyper-worker` 完全相同 |
| `smart-function` | 3561 B | **舊版 LINE 推播函式**，已被 `line-notify` 取代 |
| `bright-function` | 3561 B | 同上，與 `smart-function` 完全相同 |

## smart-function / bright-function 的風險

這兩支不是無害範本，具體行為：

- 以 `SUPABASE_SERVICE_ROLE_KEY` 建立 client，**完全繞過 RLS**
- 讀取 `system_settings` 的 `line_channel_token` 與 `line_group_id`
- 依請求 body 的內容組出訊息文字，推播至公司 LINE 群組
- `Access-Control-Allow-Origin: "*"`
- `verify_jwt: true`

風險在於：`line_channel_token` 本來被 `settings_active_read` 政策刻意排除、一般使用者
讀不到，但這兩支函式會代替**任何持有有效 JWT 的使用者**動用該權杖。也就是說任一
巡檢員或司機都能送出自訂 payload，把自己編寫的內容推播到公司的官方 LINE 群組。

權杖本身不會出現在回應中，故無直接外洩，但訊息注入是實際可行的。

## 還原方式

若日後確認仍有需要：

```
cp -r docs/removed-edge-functions/<slug> supabase/functions/<slug>
npx supabase functions deploy <slug> --project-ref qztffronusdhgxhjjubt
```
