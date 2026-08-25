begin;

-- 樓層圖包含完整場域配置，不能再以永久公開 URL 暴露給未登入的流量。
-- 圖臺仍由所有已啟用帳號使用，因此讀取政策保留給 active authenticated user；
-- 上傳／更新權限沿用既有的 sys_equipment_manage 政策。
update storage.buckets
set public = false
where id = 'floorplans';

drop policy if exists floorplans_public_read on storage.objects;
drop policy if exists floorplans_authenticated_read on storage.objects;

create policy floorplans_authenticated_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'floorplans'
  and public.active_user_id() is not null
);

commit;
