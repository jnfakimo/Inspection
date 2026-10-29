-- 2026-10-29 資安修正：停用舊表 patrol_checkins 的「全部開放」policy。
--
-- 問題：patrol_checkins 是舊版巡邏點簽到表（已被 checkin_logs 取代，目前 0 筆資料，程式、函式、view 都沒有使用），
-- 但留有 allow_all_for_now（for all to public using true），且 authenticated 持有全部權限。
-- Supabase Auth 目前開放自行註冊且免驗證 Email，任何人註冊後都能對這張表任意讀寫刪。
-- 目前表是空的、影響有限，但這是一個隨時可能被塞垃圾資料的開放入口。
--
-- 作法：移除該 policy，並收回 anon／authenticated／PUBLIC 的全部權限。不刪資料表、不動資料；
-- RLS 維持啟用，之後若要重新使用，必須明確建立依角色限制的 policy 並授權。
begin;

drop policy if exists allow_all_for_now on public.patrol_checkins;

revoke all on table public.patrol_checkins from public, anon, authenticated;

commit;
