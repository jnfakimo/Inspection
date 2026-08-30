-- 擴充市場分析模板圖表類型；僅更新檢查條件，不變更或刪除既有資料。
begin;

alter table public.market_analysis_templates
  drop constraint if exists market_analysis_templates_chart_type_check;

alter table public.market_analysis_templates
  add constraint market_analysis_templates_chart_type_check
  check (chart_type in ('bar','pie','doughnut','line','area','table','cards'));

commit;

notify pgrst, 'reload schema';
