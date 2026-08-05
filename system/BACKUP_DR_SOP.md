# 備份與災難復原 SOP

> 給業主 / 維運人員使用。本文件只列出「該檢查什麼、該做什麼」的步驟，**不包含實際目前的備份設定值**——那些只有登入 Supabase Dashboard 的人才能確認，AI 代理沒有存取權限，無法代為查證或設定。

## 1. 現況盤點清單（第一次接手/每季覆核一次）

- [ ] 登入 [Supabase Dashboard](https://supabase.com/dashboard) → 專案 `qztffronusdhgxhjjubt` → **Settings → Billing**，確認目前方案（Free / Pro / Team / Enterprise）。
- [ ] **Database → Backups**：確認自動備份是否已開啟、保留天數（Free 方案通常沒有每日備份，Pro 以上才有；Point-in-Time Recovery 需要額外方案）。
- [ ] **Storage → Buckets**：確認 `floorplans`、`repair-files`、`handover-attachments`、`vehicle-dispatch-files` 四個 bucket 是否包含在備份範圍內（部分方案的自動備份不涵蓋 Storage 檔案，需另外規劃）。
- [ ] 確認目前方案的**保留期限**（例如 Pro 方案預設 7 天）是否符合業主可接受的資料遺失容忍度（RPO）。
- [ ] 記錄本次盤點結果與日期，供下次覆核比對是否有變動。

## 2. 建議的最低配置（依商用交付標準）

| 項目 | 建議 |
|---|---|
| 資料庫每日自動備份 | 至少保留 7 天，建議 14～30 天 |
| Point-in-Time Recovery（PITR） | 若業務對「復原到任意時間點」有需求，需升級到支援 PITR 的方案 |
| Storage 檔案備份 | 確認方案涵蓋，或另外設定定期匯出到業主自己的雲端硬碟/NAS |
| GitHub 原始碼 | 已具備（git 歷史本身即完整版控），無需額外設定，但建議業主自己也保留一份 fork 或定期 clone 備份，避免帳號因故被鎖定 |

## 3. 復原情境與步驟大綱

### 情境 A：誤刪/誤改少量資料
系統本身已經是 append-only（`system/sql/permanent_data_protection.sql` 在資料庫層禁止 DELETE/TRUNCATE），多數「誤刪」實際上只是把 `status` 改成 `inactive`，可以直接找到該筆資料把 `status` 改回 `active` 復原，**不需要動用備份**。

### 情境 B：資料庫大範圍損毀（例如錯誤的批次 SQL 執行）
1. 立即到 Supabase Dashboard 確認可用的備份時間點清單。
2. **不要**在原專案直接還原（避免二次錯誤）；優先建立一個新的 Supabase 分支/專案，把備份還原到那裡先驗證資料完整性。
3. 驗證無誤後，再規劃切換正式環境（需要業主與開發者一起排定停機窗口）。
4. 切換後，比對 `system/sql/` 內所有 migration 檔案，確認新環境已套用到最新版本（可用 `list_migrations`/手動比對 `pg_policies`、`information_schema.columns` 逐一核對）。

### 情境 C：GitHub Pages 部署損毀/誤刪
- 原始碼在 git 歷史中一定找得回來（`git log`／`git revert`），比 Supabase 端的復原簡單很多，風險低。

### 情境 D：Storage 檔案遺失（例如 bucket 被誤刪）
- 若沒有另外備份，**檔案本身可能無法復原**（`floor_models`/`repair_attachments` 等資料表裡的路徑會變成失效連結，但資料庫紀錄本身還在，不影響業務資料完整性，只是照片/圖檔看不到）。
- 這是目前系統的已知風險，建議業主評估是否要為 Storage 加開額外備份。

## 4. 演練建議

- 建議至少每半年在**非正式環境**（Supabase 分支或另開測試專案）實際跑一次「還原一份備份 → 登入驗證資料完整」的演練，確認備份真的可用，而不是等真正出事才發現備份是壞的。
- 演練需要業主授權並安排時間，AI 代理無法自行在正式專案上執行還原操作。

## 5. 待業主確認事項（本文件無法代為確認）

1. 目前 Supabase 方案等級與備份保留天數。
2. Storage bucket 是否已涵蓋在備份範圍內。
3. 是否要額外訂閱 Point-in-Time Recovery。
4. 業主可接受的 RPO（最多能接受遺失多少時間的資料）與 RTO（最多能接受多久復原）目標，以此反推應該訂閱哪個方案。
