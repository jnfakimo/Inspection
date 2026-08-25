-- 2026-08-25：system_settings 的 updated_at 只在 INSERT 時由 default now() 填入，
-- UPDATE 一律不動它。這張表裝的是 LINE 群組、通知開關、告警門檻等系統組態，
-- 「這筆設定是什麼時候被改的」因此完全查不到，與專案「全程可稽核」的原則牴觸。
--
-- 發現經過：LINE webhook 設定完成後要確認它是否真的把 line_group_id 寫回來，
-- 拿 updated_at 當證據，結果它停在 2026-06-24 的建立時間動也不動，一度被誤判成
-- webhook 沒生效。真正的原因是這張表從來沒有 BEFORE UPDATE trigger。
--
-- 既有的 trg_sync_security_line_setting_alias 是 AFTER UPDATE，且只處理
-- line_notify_security 這兩個 key，與本 trigger 不衝突（BEFORE 先跑，AFTER 後跑）。
--
-- 本 migration 只加 trigger，不改任何一列既有資料。已存在的 updated_at 值維持原樣，
-- 要等該列下一次被更新才會跟上。
--
-- 刻意不含其他 15 張同樣缺 trigger 的表：repair_requests、maintenance_orders、
-- vehicle_dispatch_requests 等把 updated_at 當成清單排序鍵，補上 trigger 會改變
-- 使用者看得到的排序行為，那應該是獨立一筆、單獨驗收。

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_row_updated_at() is
  '通用 BEFORE UPDATE trigger：把 updated_at 設為 now()。供有 updated_at 欄位的表共用。';

drop trigger if exists trg_system_settings_updated_at on public.system_settings;

create trigger trg_system_settings_updated_at
  before update on public.system_settings
  for each row
  execute function public.set_row_updated_at();
