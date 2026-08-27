-- 公文類別與承辦單位／人員；既有資料維持相容。
begin;

alter table public.official_documents
  add column if not exists document_type text not null default 'official_document';

alter table public.official_documents
  add column if not exists responsible_dept_id uuid references public.departments(dept_id);

alter table public.official_documents
  add column if not exists responsible_user_id uuid references public.users(user_id);

update public.official_documents
set responsible_dept_id = originator_dept_id,
    responsible_user_id = originator_id
where responsible_dept_id is null
   or responsible_user_id is null;

create index if not exists official_documents_responsible_dept_idx
  on public.official_documents(responsible_dept_id, updated_at desc);

create index if not exists official_documents_responsible_user_idx
  on public.official_documents(responsible_user_id, updated_at desc);

commit;
