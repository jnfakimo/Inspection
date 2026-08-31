-- 戰情儀表板納入「系統存取權限」矩陣（SYS-11）。
--
-- 這頁（V2 的 /）本來就存在，但系統入口沒有它的圖卡，也不在 sys_* 權限表裡，
-- 等於是一個沒有人管得到的入口。改成與其他系統一致：入口有圖卡、存取由
-- role_permissions 的 sys_dashboard 控制。
--
-- 預設開給所有既有角色，沿用 sys_officialdocs 當初的做法：不覆寫管理員已經
-- 手動收緊的設定（on conflict do nothing），也不讓任何人因為這次調整突然少了東西。
-- 要限制誰能看，請到「角色權限 → 系統存取權限」取消勾選。

begin;

insert into public.role_permissions(role_id, perm, allowed)
select role_id, 'sys_dashboard', true
from public.roles
on conflict(role_id, perm) do nothing;

commit;
