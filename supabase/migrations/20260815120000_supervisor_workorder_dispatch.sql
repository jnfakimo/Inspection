-- 維修六階段流程：主管負責派工，報修人與主管分段驗收。
-- V2 使用 repair_requests.status 區分 pending_review（待報修人驗收）與
-- completed（待主管驗收）；closed 僅由主管最終驗收後寫入。
insert into public.role_permissions(role_id,perm,allowed) values
  ('unit_supervisor','dispatch',true),
  ('mgmt_supervisor','dispatch',true)
on conflict(role_id,perm) do update set allowed=excluded.allowed;