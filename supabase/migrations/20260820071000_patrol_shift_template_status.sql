-- patrol_shift_template.status：班別範本軟刪除用的狀態欄位。
--
-- system/sql/patrol_shifts.sql 早在 ba110e0 就宣告了這個欄位，但正式環境的
-- patrol_shift_template 建立於該檔更新之前；create table if not exists 對既有表
-- 是 no-op，而該檔之後沒有再重跑，因此欄位始終不存在。
--
-- a06f2ce（2026-08-19）讓排班頁改以 .neq('status','inactive') 過濾範本，正式環境
-- 從那一刻起整頁載入失敗：column patrol_shift_template.status does not exist，
-- 範本清單與「新增當日班別」的套用來源一併空白。app-api 的 patrol_shift_delete
-- （template 分支）也依賴這個欄位。

alter table if exists public.patrol_shift_template
  add column if not exists status text not null default 'active';

do $$
begin
  if to_regclass('public.patrol_shift_template') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.patrol_shift_template'::regclass
         and conname = 'patrol_shift_template_status_check'
     ) then
    alter table public.patrol_shift_template
      add constraint patrol_shift_template_status_check
      check (status in ('active','inactive'));
  end if;
end $$;

-- PostgREST 會快取 schema，不重載就看不到新欄位。
notify pgrst, 'reload schema';
