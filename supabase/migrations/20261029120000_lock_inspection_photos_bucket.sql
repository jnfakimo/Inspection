-- 2026-10-29 資安修正：正式庫的 inspection-photos 儲存桶仍是公開且任何登入者都能上傳。
--
-- 問題：20260909180000_inspection_photos_private_hardening.sql 要把這個桶改成私有，但它刪的 policy 名稱
-- （inspection_photos_*）與正式庫實際存在的名稱（allow_public_read、allow_authenticated_upload）不同，
-- 而且該 migration 沒有套用到正式庫：桶仍是 public=true、沒有大小與類型限制，
-- allow_public_read 讓未登入者可讀、allow_authenticated_upload 讓任何登入者（含自行註冊的帳號）可上傳任意檔案，
-- 等於免費的公開檔案空間，可被拿來放釣魚頁或惡意檔案。程式端已不使用這個桶，桶內目前 0 個物件。
--
-- 作法：改成私有、限制大小與圖片類型，移除正式庫上的舊 policy，
-- 改成僅「已啟用的系統帳號」可讀寫（與 20260909180000 的原意一致）。不刪物件、不刪桶。
begin;

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'inspection-photos';

drop policy if exists allow_public_read on storage.objects;
drop policy if exists allow_authenticated_upload on storage.objects;
drop policy if exists inspection_photos_public_read on storage.objects;
drop policy if exists inspection_photos_authenticated_read on storage.objects;
drop policy if exists inspection_photos_authenticated_insert on storage.objects;

create policy inspection_photos_authenticated_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'inspection-photos'
  and public.active_user_id() is not null
);

create policy inspection_photos_authenticated_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'inspection-photos'
  and public.active_user_id() is not null
);

commit;
