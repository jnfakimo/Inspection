-- 公文查詢條碼與公文編號一致；既有資料先校正，之後由 trigger 維持一致。
-- 不刪除資料，只更新公文主檔的查詢欄位。

begin;

update public.official_documents
set barcode_value = document_no,
    updated_at = now()
where barcode_value is distinct from document_no;

create or replace function public.sync_official_document_barcode_number()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  new.barcode_value := new.document_no;
  return new;
end;
$$;

drop trigger if exists trg_official_document_barcode_number on public.official_documents;
create trigger trg_official_document_barcode_number
before insert or update of document_no, barcode_value on public.official_documents
for each row execute function public.sync_official_document_barcode_number();

commit;
