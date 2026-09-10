-- Nullable: historical records without a cost are not represented as zero-cost repairs.
alter table public.mechanical_handover_entries
  add column if not exists repair_cost numeric(11,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mechanical_repair_cost_nonnegative'
    and conrelid = 'public.mechanical_handover_entries'::regclass) then
    alter table public.mechanical_handover_entries add constraint mechanical_repair_cost_nonnegative
      check (repair_cost is null or (repair_cost >= 0 and repair_cost <= 999999999.99));
  end if;
end $$;
comment on column public.mechanical_handover_entries.repair_cost is '維修費用，新臺幣元；NULL 表示未填，0 表示無費用';
notify pgrst, 'reload schema';
