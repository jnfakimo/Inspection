'use client';

import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { DashboardClient } from './dashboard-client';

// 戰情儀表板在系統入口是 SYS-11，存取權比照其他系統由「角色權限 → 系統存取權限」
// 的 sys_dashboard 控制。登入後是導向 /systems/（入口頁）而不是這裡，
// 所以擋下來不會有人被關在門外。
export default function Page() {
  return <AuthGate>{profile => {
    const allowed = profile.allowed_systems.includes('*') || profile.allowed_systems.includes('dashboard');
    if (!allowed) {
      return <AppShell profile={profile} title="戰情儀表板">
        <div className="notice danger">目前角色沒有此系統權限，請由管理員開放。</div>
      </AppShell>;
    }
    return <DashboardClient profile={profile} />;
  }}</AuthGate>;
}
