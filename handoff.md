# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。完整決策脈絡見 git log 與 `SECURITY_POSTURE.md`。

## ⏯️ 目前做到哪

1. **爆露風險路徑修正**：將全站（包含 `admin.html`, `api.html`, `dashboard.html`, `dispatch.html`, `equipment.html`, `structure_map.html`, `index.html` 等）中硬寫的舊版路徑 `https://jnfakimo.github.io/word-cloud/` 與 `https://example.com/word-cloud/` 全面替換為新路徑 `https://example.com/Inspection`，確保真實目錄結構不被輕易辨識。
2. **操作稽核（系統紀錄）介面優化與繁體中文化**：
   - 針對 V1 `system/admin.html` 中的「系統紀錄」區塊全面改為繁體中文標示。
   - 針對 V2 Next.js 版本（`web/components/admin/AuditAdminV2.tsx`），將操作稽核詳細視窗的原始 JSON 程式碼替換為易讀的「操作摘要」卡片，並將連線 IP、裝置等轉換為繁體中文呈現。同時將完整的 JSON 除錯紀錄隱藏在可摺疊的 `<details>` 標籤中，保留開發除錯能力。

## 🚦 目前狀態

**V2 稽核畫面已完成修改並推送，待 GitHub Actions `build:pages` 流程自動部署。**
先前的測試進度：SYS-02 與 SYS-07 已完成實機驗收，其餘六個系統尚未驗。

**踩到的坑（今日）**：
地端（特別是 Google Drive 目錄下）直接執行 `npm install --force` 等指令極易遇到「目錄不為空」、「無法存取檔案」的鎖定問題，嚴重影響本地編譯 V2 的進度。最後決定跳過本地編譯，改以 commit 原始碼並交由遠端 `hardened-pages.yml` 的 GitHub Actions 直接處理 V2 的 Next.js 頁面建置與發布。

## ➡️ 下一步

1. **確認 V2 部署**：重新整理並開啟 V2 版稽核檢視畫面，確認版面、用詞等顯示均無異狀且正確呈現。
2. **接續實機驗收**。SYS-02、SYS-07、SYS-03 已完成，剩下依序：
   - 六頁 Excel 匯出（ExcelJS 產出的檔案與原本不同，排版需目視確認）
   - admin 批次匯入（`.xlsx`／`.xls`／`.csv` 各一次，三種格式都要）
   - SYS-04 交接簿

## ⚠️ 注意事項

- **plpgsql 建立函式時不驗證欄位參照**——`create or replace function` 成功不代表
  函式可執行。新增或修改資料庫函式後，務必實際呼叫一次，或比照
  `20260817100000` 的做法加欄位驗證。
- **新增資料庫函式的 migration 結尾要加 `notify pgrst, 'reload schema';`**，否則
  前端會拿到 `Could not find the function ... in the schema cache`（已踩過一次）。
- **測試資料刪不掉**：41 張表設有 `trg_prevent_removal`，禁止 DELETE/TRUNCATE，
  只能用狀態停用。測 SYS-07 會真的改動車輛里程，請挑停用中的車並先記下原值。
- **SYS-07 驗收留下的測試夾具**（刪不掉，已全部停用，請勿指派實際任務）：
  車輛 `TEST-0001`「SYS-07 驗收測試車（勿使用）」status=inactive、里程 50123.4；
  帳號 `SYS07TEST` status=inactive 且 auth 已停權、`vehicle_dispatch_drivers` active=false；
  派車單 `CAR-20260817-0008`、`CAR-20260817-0012` 兩張 completed（用途欄已註明為測試）。
  正式車 9390-AG 全程未被動到，里程維持 15000.0。
- **`supabase functions deploy` 不帶參數會部署 `supabase/functions/` 底下所有函式**。
  已移除函式的原始碼因此留在 `docs/removed-edge-functions/`，不要搬回去。

## 🕐 最後更新

2026-08-18 · AntiGravity @ 本地端 · Git push：✅ 已推
· 本次：替換全站暴露路徑為 `/Inspection`，完成 V1 與 V2 操作稽核介面的繁體中文在地化與 JSON 摘要優化。
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
