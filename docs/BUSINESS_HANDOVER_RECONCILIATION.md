# 業管組交接事項與雙方簽認

每筆交接事項保留一份來源紀錄。沒有完成紀錄的事項，自來源班別起自動出現在後續班別；登記完成的當班仍顯示完成結果，下一班起停止續帶。既有紀錄沒有完成證據，一律先視為未完成。崗位勤務點檢的 JSON 紀錄不列入續帶，出勤人數也不重複計入後續班別。

早班 01–09 → 中班 09–17 → 晚班 17–01 → 隔日早班。凌晨 00–01 屬於前一日的晚班。

1. 交班人核對本班事項，選擇另一位在職且有業管組交接權限的接班人，按「本人確認交班」。資料庫保存內容快照、交班人姓名與時間。
2. 指定接班人登入，在自己的班別按「核對上一班內容並確認接班」，檢閱同一份快照後按「本人確認接班」。資料庫另存接班人與時間；重送不改寫原時間。
3. 接班確認不代表事情已做完。實際完成後，由目前當班接班人按該事項的「標記已完成」。完成紀錄包含日期、班別、人員與伺服器時間。
4. 本班由已確認接班者再交給下一班。上線後第一次交班可直接建立起點；建立後不能跳過中間班別。未開始的班別不可簽認。

交班後原內容鎖定；後續完成不改写早班原先簽认的「未完成」快照。需要補充時在目前班別新增事項。紙本報表包含來源、完成與雙方簽認時間，資料較多時跨頁保留全文。

後端入口為 `handlers/business-handover.ts`，使用登入者權杖呼叫交易式 RPC。新表只授予 authenticated SELECT，簽認與完成不可透過直接寫表偽造。完成、交班、原始事項修改使用同一把交易鎖；交班另外比對內容版本，拒絕以過期画面簽認。接班候選人的授權規則與 `has_system_access`／`has_module_access` 一致，若變更四層權限規則須同步調整 `business_receiver_allowed`。

部署順序：先確認既有 `20260911093000_business_handover_module_access.sql`、四層權限 migrations 與 `20260911200000_business_handover_approvals.sql` 均已套用，再套用 `20260915120000_business_handover_reconciliation.sql`，最後部署 app-api 與前端。GitHub Pages 使用雲端 Supabase；內網站台需另外套用同一 migration 與 `tools/sync-local-edge-functions.ps1`，不能只更新靜態網頁。

2026-09-15 正式雲端補套主管批核 migration：原先瀏覽器快取備援掩蓋了批核表未建置，移除假成功備援後出現整頁載入失敗（PostgREST `PGRST205`）。部署檢查需執行 `node tools/check-business-handover-schema.mjs`，以 `limit=0` 唯讀核對完整相依欄位，不能只確認新增的兩張表存在。

驗證：`npm run test:business-handover`、`npm run test:app-api-handlers`、前後端型別檢查、`npm run test:handover-style`、`npm run test:page-headings`。資料庫測試只使用隔離的 PGlite 合成資料，不對正式交接紀錄代簽。
