'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import { zhModuleCode, zhSystemCode } from '@/lib/zh-tw';
import type { Profile } from '@/types/app';
import '../[module]/operations.module.css';

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

function OperationsHub({ system, profile }: { system: SystemDefinition; profile: Profile }) {
  const handover = system.key === 'handover';
  const cards = handover ? [
    ['records', '新增交接／交接記錄', '填寫班別、異常、待辦與備註，送出後由接班人接收。', 'handover-icon.png', 'HANDOVER 01'],
    ['open-items', '未結事項', '查看跨班延續的異常與待辦事項。', 'handover-icon.png', 'HANDOVER 02'],
    ['equipment', '設備概況', '查看交接時的設備運轉摘要。', 'equipment-icon.png', 'HANDOVER 03'],
  ] : [
    ['checkins', '駐衛警巡檢表', '查詢樓層與巡檢點的打卡狀態，掌握待巡與逾期項目。', 'guardpatrol-list-icon.png', 'PATROL 01'],
    ['map3d', '3D 駐警巡檢雲台', '以立體場域視角查看巡檢點位與打卡狀態。', 'guardpatrol-3d-icon.png', 'PATROL 02'],
    ['shifts', '巡檢排班系統', '管理每日巡檢班別、執勤人員與時段。', 'guardpatrol-schedule-icon.png', 'PATROL 03'],
    ['notifications', 'LINE 推播紀錄', '查詢巡檢逾時推播與回應狀態。', 'guardpatrol-line-push-icon.png', 'PATROL 04'],
  ];
  return <AppShell profile={profile} title={system.title}><section className="operations-portal-hero"><img src={system.icon} alt="" /><div><h1>{system.title}</h1><p>{system.description}</p></div></section><div className="operations-portal-note">{handover ? 'HANDOVER WORKFLOW · 依班別完成交接與接收稽核' : 'GUARD PATROL WORKFLOW · 點選圖卡進入功能系統'}</div><section className={`operations-portal-grid ${handover ? 'handover' : 'patrol'}`}>{cards.map(([key, title, description, icon, code]) => <Link key={key} href={`/systems/${system.key}/${key}/`} className="operations-portal-card"><span className="operations-portal-code">{code}</span><img src={`/word-cloud/assets/system-icons/${icon}`} alt="" /><h2>{title}</h2><p>{description}</p><b>▶ 進入功能</b></Link>)}</section></AppShell>;
}

export function SystemHubClient({ system }: { system: SystemDefinition }) {
  function Hub({ profile }: { profile: Profile }) {
    const allowed = profile.allowed_systems.includes('*') || profile.allowed_systems.includes(system.key);
    if (system.key === 'workorder' && allowed) return <WorkorderHub profile={profile} />;
    if ((system.key === 'handover' || system.key === 'guardpatrol') && allowed) return <OperationsHub system={system} profile={profile} />;
    return <AppShell profile={profile} title={system.title}>{allowed ? <><section className="module-hero"><div><span>{zhSystemCode(system.code)}</span><h2>{system.title}</h2><p>{system.description}</p></div><img src={system.icon} alt="" /></section><section className="module-grid">{system.modules.map((module: ModuleDefinition, index: number) => <Link key={module.key} href={`/systems/${system.key}/${module.key}/`}><span>{zhModuleCode(index)}</span><h3>{module.title}</h3><p>{module.description}</p><b>開啟子系統 →</b></Link>)}</section></> : <div className="notice danger">目前角色沒有此系統權限，請由管理員開放。</div>}</AppShell>;
  }
  return <AuthGate>{profile => <Hub profile={profile} />}</AuthGate>;
}
