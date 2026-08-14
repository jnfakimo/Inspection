'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import { zhModuleCode, zhSystemCode } from '@/lib/zh-tw';
import type { Profile } from '@/types/app';

function WorkorderHub({ profile }: { profile: Profile }) {
  return <AppShell profile={profile} title="維修／派工／完工系統">
    <section className="workorder-page-header"><h2><img src="/word-cloud/assets/system-icons/maintenance-icon.png" alt="" /> 維修／派工／完工系統</h2><p>報修、派工及維修完工流程入口</p></section>
    <div className="workorder-note">■ MAINTENANCE WORKFLOW ・ 點選圖卡進入功能系統</div>
    <section className="maintenance-hub-grid">
      <Link className="maintenance-card cyan" href="/systems/workorder/requests/"><span className="maintenance-badge">MAIN-01</span><img src="/word-cloud/assets/system-icons/repair-request-icon.png" alt="報修與維修" /><h3>報修 &amp; 維修</h3><p>新增報修、案件查詢<br />維修進度與狀態管理</p><b>▶ 進入報修與維修</b></Link>
      <Link className="maintenance-card amber" href="/systems/workorder/dispatch/"><span className="maintenance-badge">MAIN-02</span><img src="/word-cloud/assets/system-icons/under-repair-icon.png" alt="派工" /><h3>派工系統</h3><p>建立派工、承辦指派<br />工單處理進度追蹤</p><b>▶ 進入派工系統</b></Link>
      <Link className="maintenance-card green" href="/systems/workorder/orders/"><span className="maintenance-badge">MAIN-03</span><img src="/word-cloud/assets/system-icons/repair-complete-icon.png" alt="維修完工回報" /><h3>維修完工回報</h3><p>填寫完工紀錄、照片回報<br />驗收及主管結案</p><b>▶ 進入完工回報</b></Link>
    </section>
  </AppShell>;
}

export function SystemHubClient({ system }: { system: SystemDefinition }) {
  function Hub({ profile }: { profile: Profile }) {
    const allowed = profile.allowed_systems.includes('*') || profile.allowed_systems.includes(system.key);
    if (system.key === 'workorder' && allowed) return <WorkorderHub profile={profile} />;
    return <AppShell profile={profile} title={system.title}>{allowed ? <><section className="module-hero"><div><span>{zhSystemCode(system.code)}</span><h2>{system.title}</h2><p>{system.description}</p></div><img src={system.icon} alt="" /></section><section className="module-grid">{system.modules.map((module: ModuleDefinition, index: number) => <Link key={module.key} href={`/systems/${system.key}/${module.key}/`}><span>{zhModuleCode(index)}</span><h3>{module.title}</h3><p>{module.description}</p><b>開啟子系統 →</b></Link>)}</section></> : <div className="notice danger">目前角色沒有此系統權限，請由管理員開放。</div>}</AppShell>;
  }
  return <AuthGate>{profile => <Hub profile={profile} />}</AuthGate>;
}
