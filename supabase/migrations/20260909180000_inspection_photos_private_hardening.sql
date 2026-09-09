begin;

-- 巡檢照片涉及市場各區域現場實況與異常設備，不能以永久公開 URL 暴露給未登入流量。
-- 將 inspection-photos 儲存桶改為私有（private），讀取與上傳政策限已登入且已啟用帳號。
update storage.buckets
set public = false
where id = 'inspection-photos';

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
