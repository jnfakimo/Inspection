-- Floor plans remain publicly readable for the static 2D/3D viewers, but only
-- designated equipment managers may create or replace plan objects.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname ilike 'floorplans%'
  loop execute format('drop policy if exists %I on storage.objects',p.policyname); end loop;
end $$;
create policy floorplans_public_read on storage.objects for select to public using(bucket_id='floorplans');
create policy floorplans_manager_insert on storage.objects for insert to authenticated
with check(bucket_id='floorplans' and public.has_system_access('sys_equipment_manage'));
create policy floorplans_manager_update on storage.objects for update to authenticated
using(bucket_id='floorplans' and public.has_system_access('sys_equipment_manage'))
with check(bucket_id='floorplans' and public.has_system_access('sys_equipment_manage'));
-- No DELETE policy: published plan objects are permanent; replacements use UPDATE.
