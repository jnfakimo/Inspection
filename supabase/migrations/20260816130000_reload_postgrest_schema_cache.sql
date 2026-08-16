-- 觸發 PostgREST 重新載入 schema 快取。
--
-- 20260816120000 建立 complete_vehicle_trip 後，PostgREST 的 schema 快取尚未更新，
-- 前端呼叫 rpc 會得到「Could not find the function ... in the schema cache」。
-- Supabase 雖有 DDL event trigger 會自動 reload，但有延遲；此處明確觸發一次。
--
-- NOTIFY 屬交易性指令，於 commit 時送出，因此放在 migration 內即可生效。
-- 日後新增或修改資料庫函式時，請一併在該支 migration 結尾加上這行。

notify pgrst, 'reload schema';
