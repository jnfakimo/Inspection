# 2026-10-28 水果簽核與三班日結隔離驗證

結果：**pass（本次隔離 Auth／API／資料庫交易及登入畫面核對範圍）**。

所有交易只對 `http://127.0.0.1:55321` 執行。工作目錄為 `C:\projects\Inspection-supabase-e2e-20261028`；合成工作日為 2026-10-27，晚班接至 2026-10-28 早班。使用真實 Supabase Auth 登入的獨立測試帳號，主管簽核沒有使用 sysadmin 代簽。service-role 只用於建立隔離組織／帳號、並行資料庫防護測試及結果查核。

## 完成的操作

| 流程 | 驗證結果 | 隔離目錄內證據 |
|---|---|---|
| 水果三班交接 | 三位同仁各班新增、指定下一班、本人接班；晚班接至隔日早班；3 筆交班全部簽收 | `evidence/closeout-shifts.json` |
| 水果每日三階 | 組(副)長 → 副主任 → 主任，三位不同主管依序簽核 | 同上、`closeout-db-verification.txt` |
| 業管三班與四階 | 3 筆交班全部簽收；副主任 → 主任 → 副理 → 經理 | 同上 |
| 機電三班與日結 | 三班工作、本人值班簽名、交接完成；隔日由機電課長日結 | 同上 |
| 存貨單 | 填表人送出 → 另一人簽小組長 → 組長；完成會計與業管分送登記，重試保留第一次簽送人與時間 | `evidence/closeout-documents.json` |
| 報廢單 | 兩張合成單，各自完成小組長 → 組長 → 主(副)任；主任、副主任兩種資格分別驗證 | 同上 |
| 作廢與運回單 | 缺拍賣員不能送出；草稿作廢留存；運回單開立、本人作廢、下一張序號不重用 | 同上 |
| 帳號管理修正 | API 儲存多階主管、角色重新指派、重新啟用都保留上級；一般帳號不能操作後台 | `evidence/closeout-hierarchy.json` |
| 登入後畫面補驗 | 水果三階與業管四階顯示全部完成、機電顯示課長已簽；存貨完成及分送、兩筆報廢完成與一筆作廢均查得 | `evidence/closeout-ui-fruit.txt`、`closeout-ui-business.txt`、`closeout-ui-mechanical.txt`、`closeout-ui-stock.txt`、`closeout-ui-scrap.txt` |
| 上級主管欄位 UI | 在既有登入的本機管理頁編輯隔離主任帳號，顯示單位主管與已選上級；實際儲存成功、重新開啟仍保留上級 | `evidence/closeout-ui-supervisor-saved.txt`、`closeout-ui-supervisor-verified.png` |

拒絕案例包括跨市場／組別／單位、自己接自己、冒名接班、未接班就再交班、過期修訂碼、跳階、一般人冒簽主管、填表人自簽小組長、重複簽核、送出後改寫、未簽完分送、非本人作廢、機電未完成三班提前日結及日結後新增／改簽。以 HTTP 拒絕及資料查回核對，不把伺服器 500 當成成功阻擋。

## 發現與修正

1. **主管鏈無法建立**：多階簽核以 `users.supervisor_id` 判斷上級，但舊資料庫與管理 API 禁止單位主管設定上級，導致普通主管無法組成簽核鏈。
   - 新增 `supabase/migrations/20261028170000_allow_supervisor_approval_chain.sql`，允許單位主管選填上級。既有一般人必填、在職／角色／同單位或上層限制、sysadmin 不設上級及原主管下屬保護繼續保留。
   - 加入交易鎖及遞迴循環檢查；真實 PostgreSQL 的兩筆並行互指僅一筆成功，另一筆 HTTP 400 拒絕，不產生循環。
   - 管理 API、帳號編輯／核准介面、匯入與顯示同步調整；角色指派與啟用不再清除單位主管的上級。
   - Migration 只更新驗證函式，不替既有人員指定主管、不變更角色或 RLS。正式環境未套用。
2. **機電日結原因誤報**：尚未完成三班雙方簽收，也被顯示為「須於隔日簽核」。修正為顯示三班勾稽未完成；當日提前日結仍顯示日期限制。兩種回應均重新實測為 HTTP 409。

## 回歸與隔離證據

- `npm test`：exit 0，含新增 `test:supervisor-approval-chain`。新資料庫回歸測試先重現舊規則失敗，再驗證多階、循環／自指／跨單位／停用／非主管拒絕、一般人必填、原主管保護及 migration 重跑。
- `npm run typecheck:v2`：exit 0。
- `npm run security:audit`：0 錯誤、3 個既有檢視警告（HTML／文件字串輸出、內部 HTTP 來源）；未把它們視為本次交易驗證已關閉。
- 隔離前端 `next build web --webpack`：exit 0。此執行副本的 node_modules 使用 junction，Turbopack 的工作區邊界無法解析外部依賴，故沿用 webpack 建置；沒有更改正式建置設定。
- 最終資料庫：水果、業管、機電各 3 筆交班及 3 筆簽收；水果 3 階、業管 4 階、機電 1 筆課長日結；存貨 2 枚、兩張報廢單各 3 枚不同人簽章。
- 11 張相關資料表的 RLS／FORCE RLS 均為 true；外單位直接 REST 查詢相關資料為空陣列。證據：`closeout-db-verification.txt`、`closeout-final.json`。
- Supabase 暴露端口仍只綁 127.0.0.1；專用 Docker 子網對外新連線 REJECT、pg_cron 關閉。證據：`closeout-container-bindings.txt`、`closeout-egress-policy.txt`。
- 保留原 7 帳號，新增 18 個合成驗證帳號；憑證只在受限 `.local/closeout-accounts.json`，未寫入報告或原始碼。既有密碼政策、正式帳號密碼均未更動。

## 重現方式與限制

在隔離目錄執行 `scripts/create-closeout-fixtures.mjs` 建立／續用合成人員。以 `SUITE=shifts`、`documents`、`hierarchy`、`final` 分別執行 `e2e-closeout-shifts.mjs`、`e2e-closeout-documents.mjs`、`e2e-closeout-hierarchy.mjs`、`check-closeout-final.mjs`。

這些腳本使用固定合成日期，並以各自 evidence 檔保存已完成步驟；再次執行會接續及核對，不宣稱每次都重建全新流程。需要全新重跑時，應使用另一個隔離專案及新的驗證日期，不刪除本輪簽章證據。

跨角色交易以實際 Auth／REST RPC／Edge API 與資料庫為準；另使用使用者已登入的隔離管理頁補核對結果畫面，並完成上級主管欄位儲存／重開核對。沒有逐角色重做所有瀏覽器點擊，也未驗收所有螢幕尺寸。實體手機、A4 列印、外部 LINE／Google／郵件與正式 IIS 不在本輪通過範圍；未部署、未提交或推送，不能以此宣稱正式 ISO 27001 稽核完成。

## 同日追加：主管選單排除本人

前次畫面證據顯示編輯主任帳號時，上級主管選單仍列出本人。前端儲存檢查與資料庫已拒絕自指，但選單仍會引導使用者選到無效項目。本次修改 `UsersAdmin.tsx`，傳入被編輯帳號識別碼，排除本人，也不透過舊主管保留邏輯將本人補回；其他有效主管、現任主管及原有不適任提示均維持。

- 帳號核准契約檢查、`typecheck:v2`、隔離 webpack 建置皆 exit 0；來源與執行副本 SHA-256 相同；本機登入／profile／匿名防護及前端就緒檢查通過。
- 證據：隔離目錄 `evidence/supervisor-picker-tests.log`、`supervisor-picker-build.log`。本次未修改資料庫、密碼政策或正式環境。
- 本次瀏覽器連接既有登入分頁持續回報介面不可用，新開分頁則停於登入頁，故**排除本人後的畫面尚未重新實測**；不沿用前次截圖當作此次新畫面證據。
- 另外逐段檢視原有 3 個掃描警告：layout 注入內容為固定腳本；派車列印文字已經 `escHtml` 跳脫、統計為數值；client-ip 的 `http://` 用於 IPv6 URL 解析，沒有發出 HTTP 請求。本次沒有因警告字樣移除既有功能，也沒有關閉掃描規則；上述為原始碼檢視，並非完整滲透測試。
