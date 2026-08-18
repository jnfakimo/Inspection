-- 派車時段排除約束改為「同一台車」才互斥。
--
-- 2026-08-17 SYS-07 驗收建第二張測試單時撞到 23P01 才發現：
-- vehicle_dispatch_no_time_overlap 的鍵值只有時段，沒有 vehicle_id，
-- 因此任何兩張申請只要時段重疊就互斥——現在只有一台車看不出來，
-- 但加第二台車後，兩台車就不能在重疊時段各自出勤。
--
-- 加入 vehicle_id 需要 btree_gist（GiST 索引才能對 uuid 做 = 比對）。
--
-- 行為變化（刻意）：vehicle_id 為 null 的申請彼此不再互斥。
-- GiST 的 = 運算子對 NULL 不成立，所以「尚未指派車輛」的申請不會互相鎖時段——
-- 這本來就比較合理：還沒決定用哪台車的申請，沒有理由占住別人的時段，
-- 真正的衝突會在指派車輛（assignment guard）時才成立。
--
-- 未一併調整、留待業務決定的部分：生效狀態仍是
-- ('pending_approval','approved','assigned','completed')。
-- 其中 pending_approval 讓未核可的申請就鎖住時段、completed 讓同日已完成的行程
-- 永久占住該時段。這兩者是否該留在集合內屬於流程決策，不在本次修正範圍。

begin;

create extension if not exists btree_gist;

alter table vehicle_dispatch_requests
  drop constraint if exists vehicle_dispatch_no_time_overlap;

alter table vehicle_dispatch_requests
  add constraint vehicle_dispatch_no_time_overlap
  exclude using gist (
    vehicle_id with =,
    tsrange(
      trip_date + planned_departure_time,
      trip_date + planned_return_time,
      '[)'
    ) with &&
  )
  where (status in ('pending_approval','approved','assigned','completed'));

commit;
