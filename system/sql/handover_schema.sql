-- ============================================================
-- 電子交接簿 — 臺北農產 設備巡檢維修系統
-- Version 1.0  |  Run ONCE in Supabase SQL Editor
-- ============================================================

create table if not exists handover_records (
  record_id    uuid        primary key default gen_random_uuid(),
  shift_date   date        not null default current_date,
  shift_type   text        not null default 'morning'
                             check (shift_type in ('morning','afternoon','night')),
  dept_id      uuid        references departments(dept_id),
  location_id  uuid        references locations(location_id),
  handover_by  uuid        references users(user_id),
  takeover_by  uuid        references users(user_id),
  eq_normal    int         not null default 0,
  eq_abnormal  int         not null default 0,
  issues       text        not null default '',   -- newline-separated
  pending      text        not null default '',   -- newline-separated
  notes        text        not null default '',
  status       text        not null default 'draft'
                             check (status in ('draft','confirmed')),
  created_by   uuid        references users(user_id),
  created_at   timestamptz default now(),
  confirmed_at timestamptz,
  confirmed_by uuid        references users(user_id)
);

-- 雙層交接稽核：
-- draft = 草稿；confirmed 且 confirmed_by/confirmed_at 尚空白 = 已送出、待指定接班人接收；
-- confirmed_by 必須等於 takeover_by 且 confirmed_at 有值，前端才判定為交接完成。
comment on column handover_records.confirmed_by is '實際點選接收的接班人；必須與 takeover_by 相同才算交接完成';
comment on column handover_records.confirmed_at is '指定接班人點選接收的時間；空白表示尚未完成交接';

create index if not exists idx_ho_date on handover_records(shift_date desc);
create index if not exists idx_ho_dept on handover_records(dept_id);

alter table handover_records enable row level security;
create policy "allow_all_for_now" on handover_records for all using (true);

-- 禁止建立已結束的過去班次；班別時間優先讀取 system_settings.shifts。
create or replace function handover_shift_end_at(p_shift_date date,p_shift_type text)
returns timestamptz language plpgsql stable set search_path=public as $$
declare v_start text;v_end text;v_config text;
begin
  v_start:=case p_shift_type when 'morning' then '06:00' when 'afternoon' then '14:00' when 'night' then '22:00' else null end;
  v_end:=case p_shift_type when 'morning' then '14:00' when 'afternoon' then '22:00' when 'night' then '06:00' else null end;
  begin
    select value into v_config from system_settings where key='shifts';
    if nullif(v_config,'') is not null then
      select item->>'start',item->>'end' into v_start,v_end from jsonb_array_elements(v_config::jsonb) item where item->>'id'=p_shift_type limit 1;
    end if;
  exception when others then null;
  end;
  if v_start is null or v_end is null or v_start!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_end!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception using errcode='22023',message='找不到有效的交接班別時間設定'; end if;
  return ((p_shift_date+case when v_end::time<=v_start::time then 1 else 0 end)+v_end::time) at time zone 'Asia/Taipei';
end;
$$;
create or replace function guard_handover_time_window()
returns trigger language plpgsql set search_path=public as $$
begin
  if handover_shift_end_at(new.shift_date,new.shift_type)<=now() then raise exception using errcode='22023',message='所選交接日期與班別已經結束，不能建立過去班次的交接單'; end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_handover_time_window on handover_records;
create trigger trg_guard_handover_time_window before insert or update of shift_date,shift_type,status on handover_records for each row execute function guard_handover_time_window();
