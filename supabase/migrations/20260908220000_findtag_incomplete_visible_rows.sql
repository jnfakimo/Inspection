-- Preserve incomplete visible rows separately, without guessing identity or GPS.
begin;
create or replace function public.findtag_ingest(p_token text,p_captured_at timestamptz,p_observations jsonb,p_status text default 'readable',p_live_read boolean default true)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key public.findtag_collector_credentials%rowtype; v_source public.findtag_collectors%rowtype;
  v_row jsonb; v_rows jsonb; v_hash text; v_id uuid; v_existing uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception '桌機授權無效'; end if;
  select * into v_key from public.findtag_collector_credentials
    where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not found or v_key.token_expires_at is null or v_key.token_expires_at<now() then raise exception '桌機授權無效或已到期'; end if;
  select * into v_source from public.findtag_collectors where collector_id=v_key.collector_id for update;
  if not v_source.active or not public.findtag_issuer_active(v_source.created_by) then
    raise exception '桌機授權已停用';
  end if;
  if v_source.last_contact_at>now()-interval '20 seconds' then raise exception '同步過於頻繁，請稍後重試'; end if;
  if p_status is null or p_status not in ('readable','read_failed') then raise exception '同步狀態無效'; end if;
  if p_status='read_failed' then
    if p_observations is not null then raise exception '讀取失敗不可傳送畫面內容'; end if;
    update public.findtag_collectors set last_contact_at=now(),last_status='read_failed' where collector_id=v_key.collector_id;
    return jsonb_build_object('accepted',true,'status','read_failed');
  end if;
  if p_observations is null or jsonb_typeof(p_observations)<>'array' or pg_column_size(p_observations)>524288
    or jsonb_array_length(p_observations) not between 1 and 200 then raise exception '可見清單格式或筆數不符'; end if;
  if p_captured_at is null or not isfinite(p_captured_at) or p_captured_at>now()+interval '5 minutes' or p_captured_at<'2020-01-01T00:00:00Z' then
    raise exception '擷取時間無效';
  end if;
  for v_row in select value from jsonb_array_elements(p_observations) loop
    if jsonb_typeof(v_row)<>'object' or (v_row - array['device_label','address_text','source_time_text'])<>'{}'::jsonb
      or jsonb_typeof(v_row->'device_label') is distinct from 'string'
      or length(trim(v_row->>'device_label')) not between 1 and 256 then
      raise exception '只接受設備名稱、地址與原始時間文字，不接受推估座標';
    end if;
    if v_row ? 'address_text' and v_row ? 'source_time_text'
       and v_row->'address_text'='null'::jsonb and v_row->'source_time_text'='null'::jsonb then
      continue;
    end if;
    if jsonb_typeof(v_row->'address_text') is distinct from 'string'
      or jsonb_typeof(v_row->'source_time_text') is distinct from 'string'
      or length(trim(v_row->>'address_text')) not between 1 and 1536
      or (v_row->>'source_time_text') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$' then
      raise exception '地址與時間須完整配對，缺少資料時必須同時為空';
    end if;
    perform (v_row->>'source_time_text')::timestamp;
  end loop;
  -- Sort and deduplicate whole rows, never merge same-name devices.
  select jsonb_agg(value order by value::text) into v_rows from (select distinct value from jsonb_array_elements(p_observations)) rows;
  v_hash=encode(sha256(convert_to(v_rows::text,'UTF8')),'hex');
  select snapshot_id into v_existing from public.findtag_visible_snapshots where collector_id=v_key.collector_id and content_hash=v_hash;
  insert into public.findtag_visible_snapshots(collector_id,content_hash,captured_at,observations)
    values(v_key.collector_id,v_hash,p_captured_at,v_rows) on conflict(collector_id,content_hash) do nothing
    returning snapshot_id into v_id;
  if v_id is null then v_id=v_existing; end if;
  update public.findtag_collectors set last_contact_at=now(),last_status=case when p_live_read is true then 'readable' else 'read_failed' end,last_read_at=greatest(last_read_at,p_captured_at),
    last_received_at=case when v_existing is null then now() else last_received_at end,
    latest_snapshot_id=case when v_source.last_read_at is null or p_captured_at>=v_source.last_read_at then v_id else latest_snapshot_id end
    where collector_id=v_key.collector_id;
  return jsonb_build_object('accepted',true,'duplicate',v_existing is not null,'snapshot_id',v_id);
end$$;
revoke all on function public.findtag_ingest(text,timestamptz,jsonb,text,boolean) from public,authenticated;
grant execute on function public.findtag_ingest(text,timestamptz,jsonb,text,boolean) to anon;
notify pgrst, 'reload schema';
commit;
