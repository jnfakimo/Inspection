-- 市場公開看板納入「系統存取權限」矩陣（SYS-12）。
--
-- SYS-12（長官模式看板）比照其他系統：系統入口有圖卡、存取由 role_permissions
-- 的 sys_marketboard 控制，頁面本身也擋。看板資料沿用 SYS-10 的正式行情資料來源，
-- 不新增資料表。
--
-- 預設開給所有既有角色，沿用 sys_dashboard／sys_officialdocs 當初的做法：
-- 不覆寫管理員已手動收緊的設定（on conflict do nothing），也不讓任何人因為這次
-- 調整突然少了東西。要限制誰能看，請到「角色權限 → 系統存取權限」取消勾選。

begin;

insert into public.role_permissions(role_id, perm, allowed)
select role_id, 'sys_marketboard', true
from public.roles
on conflict(role_id, perm) do nothing;

commit;
