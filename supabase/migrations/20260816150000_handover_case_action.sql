-- 交接簿案件異動改為單一交易：更新 handover_cases 與寫入 handover_case_logs 一次完成。
--
-- 原本前端四個操作（指派／轉派、狀態變更、重新開啟、新增進度）都是先更新
-- handover_cases 再另外 insert 一筆 handover_case_logs，兩者為獨立請求。其中
-- assignCase、updateCaseStatus、reopenCase 三處完全沒有接 log 寫入的回傳值，
-- addProgressNote 則沒有接 handover_cases 的 updated_at 更新結果。案件狀態已變更
-- 但歷程沒寫進去時不會有任何徵兆——對以稽核為核心的交接簿而言是實質缺陷。
--
-- 兩張表的 RLS 條件並不相同，使上述情況確實可能發生：
--   handover_cases_party_update : sys_handover 且（is_admin 或 created_by=我 或 assigned_to=我）
--   handover_logs_own_insert    : sys_handover 且 created_by=我
--
-- 注意：本函式為 security definer，會繞過 RLS，而 handover_cases 並無 guard
-- trigger，其授權完全仰賴 RLS。因此函式內必須自行完整重作授權判斷，否則等同
-- 開出提權漏洞。下方的檢查刻意逐條對應 handover_cases_party_update 的條件。

begin;

create or replace function public.handover_case_action(
  p_case_id     uuid,
  p_action      text,
  p_content     text default null,
  p_assigned_to uuid default null,
  p_new_status  text default null
)
returns public.handover_cases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id  uuid;
  v_case      public.handover_cases;
  v_log_action text;
  v_old       jsonb := null;
  v_new       jsonb := null;
  v_content   text  := nullif(btrim(coalesce(p_content, '')), '');
begin
  select u.user_id into v_actor_id
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;

  if v_actor_id is null then
    raise exception using errcode = '42501', message = '找不到有效的交接簿人員帳號';
  end if;

  if not public.has_system_access('sys_handover') then
    raise exception using errcode = '42501', message = '目前角色沒有電子交接簿權限';
  end if;

  select * into v_case
  from public.handover_cases
  where case_id = p_case_id
  for update;

  if not found then
    raise exception using errcode = '02000', message = '找不到這筆案件';
  end if;

  -- 對應 handover_cases_party_update：管理者、建立者或承辦人才能異動。
  if not (public.is_admin()
          or v_case.created_by = v_actor_id
          or v_case.assigned_to = v_actor_id) then
    raise exception using errcode = '42501', message = '只有案件建立者、承辦人或管理者可以異動此案件';
  end if;

  if p_action = 'assign' then
    v_log_action := case when v_case.assigned_to is not null then 'transfer' else 'assign' end;
    v_old := jsonb_build_object('assigned_to', v_case.assigned_to);
    v_new := jsonb_build_object('assigned_to', p_assigned_to);
    update public.handover_cases
    set assigned_to = p_assigned_to, updated_at = now()
    where case_id = p_case_id
    returning * into v_case;

  elsif p_action = 'status' then
    if p_new_status is null or p_new_status not in ('open','in_progress','pending','closed') then
      raise exception using errcode = '22023', message = '案件狀態值無效';
    end if;
    if p_new_status = v_case.status then
      raise exception using errcode = '22023', message = '狀態未變更';
    end if;
    v_log_action := case when p_new_status = 'closed' then 'close' else 'update' end;
    v_old := jsonb_build_object('status', v_case.status);
    v_new := jsonb_build_object('status', p_new_status);
    update public.handover_cases
    set status    = p_new_status,
        closed_at = case when p_new_status = 'closed' then now() else closed_at end,
        closed_by = case when p_new_status = 'closed' then v_actor_id else closed_by end,
        updated_at = now()
    where case_id = p_case_id
    returning * into v_case;

  elsif p_action = 'reopen' then
    v_log_action := 'reopen';
    v_content := coalesce(v_content, '案件重新開啟');
    v_old := jsonb_build_object('status', v_case.status);
    v_new := jsonb_build_object('status', 'open');
    update public.handover_cases
    set status = 'open', closed_at = null, closed_by = null, updated_at = now()
    where case_id = p_case_id
    returning * into v_case;

  elsif p_action = 'note' then
    if v_content is null then
      raise exception using errcode = '23514', message = '請輸入進度說明';
    end if;
    v_log_action := 'update';
    update public.handover_cases
    set updated_at = now()
    where case_id = p_case_id
    returning * into v_case;

  else
    raise exception using errcode = '22023', message = '不支援的案件操作';
  end if;

  insert into public.handover_case_logs
    (case_id, action, content, old_data, new_data, created_by)
  values (p_case_id, v_log_action, v_content, v_old, v_new, v_actor_id);

  return v_case;
end;
$$;

revoke all on function public.handover_case_action(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.handover_case_action(uuid, text, text, uuid, text) to authenticated;

-- 新增函式後一併通知 PostgREST 重新載入 schema 快取，避免前端立即呼叫時
-- 得到 "Could not find the function ... in the schema cache"。
notify pgrst, 'reload schema';

commit;
