'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import { zhModuleCode, zhSystemCode, zhValue } from '@/lib/zh-tw';
import type { Profile } from '@/types/app';
import { HandoverModules } from './[module]/handover-workspace';
import { invokeAppApi } from '@/lib/supabase';

const meetingroomModuleIcons: Record<string, string> = {
  bookings: '/Inspection/assets/system-icons/meeting-booking-icon-v1.png',
  rooms: '/Inspection/assets/system-icons/meeting-room-master-icon-v1.png',
  changes: '/Inspection/assets/system-icons/meeting-change-icon-v1.png',
  notifications: '/Inspection/assets/system-icons/meeting-notification-icon-v1.png',
};

function WorkorderHub({ profile }: { profile: Profile }) {
  const [summary, setSummary] = useState<Array<{ label: string; value: number | string }>>([]);
  useEffect(() => {
    let active = true;
    invokeAppApi<{ summary?: Array<{ label: string; value: number | string }> }>('module_data', { system: 'workorder', module: 'requests' })
      .then(res => { if (active) setSummary(res.summary || []); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return <AppShell profile={profile} title="維修／派工／完工系統">
    <section className="workorder-page-header"><h2><img src="/Inspection/assets/system-icons/maintenance-icon.png" alt="" /> 維修／派工／完工系統</h2><p>報修、派工及維修完工流程入口</p></section>
    {summary.length > 0 && <section className="mini-metrics workorder-summary">{summary.map(item => <article key={item.label} data-label={item.label}><span>{zhValue(item.label)}</span><strong>{item.value}</strong></article>)}</section>}
    <div className="workorder-note">■ 維修作業流程 ・ 點選圖卡進入功能系統</div>
    <section className="maintenance-hub-grid">
      <Link className="maintenance-card cyan" href="/systems/workorder/requests/"><span className="maintenance-badge">MAIN-01</span><img src="/Inspection/assets/system-icons/repair-request-icon.png" alt="報修與維修" /><h3>報修 &amp; 維修</h3><p>新增報修、案件查詢<br />維修進度與狀態管理</p><b>▶ 進入報修與維修</b></Link>
      <Link className="maintenance-card amber" href="/systems/workorder/dispatch/"><span className="maintenance-badge">MAIN-02</span><img src="/Inspection/assets/system-icons/under-repair-icon.png" alt="派工" /><h3>派工系統</h3><p>建立派工、承辦指派<br />工單處理進度追蹤</p><b>▶ 進入派工系統</b></Link>
      <Link className="maintenance-card green" href="/systems/workorder/orders/"><span className="maintenance-badge">MAIN-03</span><img src="/Inspection/assets/system-icons/repair-complete-icon.png" alt="維修完工回報" /><h3>維修完工回報</h3><p>填寫完工紀錄、照片回報<br />驗收及主管結案</p><b>▶ 進入完工回報</b></Link>
    </section>
  </AppShell>;
}

function OperationsHub({ system, profile }: { system: SystemDefinition; profile: Profile }) {
  // 交接簿的系統入口直接顯示交接紀錄模組（system.modules[0] 即 records）。
  if (system.key === 'handover') return <HandoverModules system={system} module={system.modules[0]} profile={profile} />;
  const handover = system.key === 'handover';
  if (system.key === 'vehicle') {
    const vehicleCards = [
      ['requests', '派車申請', '提出用車申請並追蹤多階段核可流程。', 'vehicle-request-icon-ai.png', 'MODULE 01', '進入系統　→'],
      ['vehicles', '公務車輛', '管理車號、狀態與目前里程資料。', 'vehicle-car-icon-ai.png', 'MODULE 02', '管理車輛　→'],
      ['drivers', '駕駛人員', '維護可指派駕駛與啟用狀態。', 'vehicle-driver-icon-ai.png', 'MODULE 03', '管理駕駛　→'],
      ['managers', '派車管理員', '設定派車管理與授權人員。', 'vehicle-manager-icon-ai.png', 'MODULE 04', '管理權限　→'],
      ['logs', '派車紀錄', '查詢狀態變更與行車歷程。', 'vehicle-log-icon-ai.png', 'MODULE 05', '查看紀錄　→'],
    ] as const;
    return <AppShell profile={profile} title={system.title}
      heading={{ system, module: system.modules[0], title: system.title, metaTitle: '系統入口', description: system.description }}>
      <div className="operations-portal-note">公務車派車流程 · 點選圖卡進入功能系統</div>
      <section className="operations-portal-grid vehicle">{vehicleCards.map(([key, title, description, icon, code, action], index) => <Link key={key} href={`/systems/${system.key}/${key}/`} className="operations-portal-card"><div className="operations-portal-card-top"><span className="operations-portal-code">{code}</span><span className="operations-portal-status">● 系統連線</span></div><img src={`/Inspection/assets/system-icons/${icon}`} alt="" /><h2>{title}</h2><p>{description}</p><b>{action}</b></Link>)}</section>
    </AppShell>;
  }
  if (system.key === 'meetingroom') {
    const meetingCards = [
      ['bookings', '會議室預約', '建立、查詢與管理會議室預約。', 'meeting-booking-icon-v1.png', 'MODULE 01', '進入系統　→'],
      ['rooms', '會議室管理', '維護會議室資料與設備狀態。', 'meeting-room-master-icon-v1.png', 'MODULE 02', '管理會議室　→'],
      ['changes', '異動申請', '審核預約取消與時間異動申請。', 'meeting-change-icon-v1.png', 'MODULE 03', '查看申請　→'],
      ['notifications', '通知紀錄', '查詢預約通知與發送結果。', 'meeting-notification-icon-v1.png', 'MODULE 04', '查看通知　→'],
    ] as const;
    return <AppShell profile={profile} title={system.title}
      heading={{ system, module: system.modules[0], title: system.title, metaTitle: '系統入口', description: system.description }}>
      <div className="operations-portal-note">會議室管理流程 · 點選圖卡進入功能系統</div>
      <section className="operations-portal-grid meetingroom">{meetingCards.map(([key, title, description, icon, code, action]) => <Link key={key} href={`/systems/${system.key}/${key}/`} className="operations-portal-card"><div className="operations-portal-card-top"><span className="operations-portal-code">{code}</span><span className="operations-portal-status">● 系統連線</span></div><img src={`/Inspection/assets/system-icons/${icon}`} alt="" /><h2>{title}</h2><p>{description}</p><b>{action}</b></Link>)}</section>
    </AppShell>;
  }
  if (system.key === 'officialdocs') {
    return <AppShell profile={profile} title={system.title}
      heading={{ system, module: system.modules[0], title: system.title, metaTitle: '系統入口', description: system.description }}>
      <div className="operations-portal-note">公文傳送流程 · 點選圖卡進入功能系統</div>
      <section className="operations-portal-grid officialdocs"><Link href="/systems/officialdocs/routing/" className="operations-portal-card"><div className="operations-portal-card-top"><span className="operations-portal-code">MODULE 01</span><span className="operations-portal-status">● 系統連線</span></div><img src="/Inspection/assets/system-icons/handover-icon.png" alt="" /><h2>公文傳送</h2><p>傳送、收文、簽收與核決流程管理。</p><b>進入系統　→</b></Link></section>
    </AppShell>;
  }
  if (system.key === 'equipment' || system.key === 'structuremap') {
    return <AppShell profile={profile} title={system.title}
      heading={{ system, module: system.modules[0], title: system.title, metaTitle: '系統入口', description: system.description }}>
      <div className="operations-portal-note">{system.title}流程 · 點選圖卡進入功能系統</div>
      <section className={`operations-portal-grid ${system.key}-portal`}>{system.modules.map((module, index) => <Link key={module.key} href={`/systems/${system.key}/${module.key}/`} className="operations-portal-card"><div className="operations-portal-card-top"><span className="operations-portal-code">{`MODULE ${String(index + 1).padStart(2, '0')}`}</span><span className="operations-portal-status">● 系統連線</span></div><img src={system.icon} alt="" /><h2>{module.title}</h2><p>{module.description}</p><b>進入系統　→</b></Link>)}</section>
    </AppShell>;
  }
  const cards = handover ? [
    ['records', '新增交接／交接記錄', '填寫班別、異常、待辦與備註，送出後由接班人接收。', 'handover-icon.png', 'HANDOVER 01'],
    ['open-items', '未結事項', '查看跨班延續的異常與待辦事項。', 'handover-icon.png', 'HANDOVER 02'],
    ['equipment', '設備概況', '查看交接時的設備運轉摘要。', 'equipment-icon.png', 'HANDOVER 03'],
  ] : [
    ['checkins', '駐衛警巡檢表', '查詢各樓層與巡檢點的打卡狀態，即時掌握待巡與逾期項目。', 'guardpatrol-list-icon.png', 'MODULE 01'],
    ['map3d', '3D 駐警巡檢雲台', '以立體場域視角查看巡檢點位與打卡狀態，快速定位異常區域。', 'guardpatrol-3d-icon.png', 'MODULE 02'],
    ['shifts', '巡檢排班系統', '管理每日巡檢班別、執勤人員與時段，維持排班資訊清楚且一致。', 'guardpatrol-schedule-icon.png', 'MODULE 03'],
    ['notifications', 'LINE推播紀錄', '查詢巡檢逾時推播的發送時間、完成狀況、排定人員與 LINE 回應。', 'guardpatrol-line-push-icon.png', 'MODULE 04'],
  ];
  return <AppShell profile={profile} title={system.title}
    heading={{ system, module: system.modules[0], title: system.title, metaTitle: '系統入口', description: system.description }}>
    <div className="operations-portal-note">駐衛警巡檢流程 · 點選圖卡進入功能系統</div>
    <section className="operations-portal-grid patrol">{cards.map(([key, title, description, icon, code]) => <Link key={key} href={`/systems/${system.key}/${key}/`} className="operations-portal-card"><div className="operations-portal-card-top"><span className="operations-portal-code">{code}</span><span className="operations-portal-status">● 系統連線</span></div><img src={`/Inspection/assets/system-icons/${icon}`} alt="" /><h2>{title}</h2><p>{description}</p><b>{key === 'checkins' ? '進入系統　→' : key === 'map3d' ? '開啟立體檢視　→' : key === 'shifts' ? '管理巡檢班別　→' : '查看通知　→'}</b></Link>)}</section>
  </AppShell>;
}

export function SystemHubClient({ system }: { system: SystemDefinition }) {
  function Hub({ profile }: { profile: Profile }) {
    const allowed = profile.allowed_systems.includes('*') || profile.allowed_systems.includes(system.key);
    if (system.key === 'workorder' && allowed) return <WorkorderHub profile={profile} />;
    if ((system.key === 'handover' || system.key === 'guardpatrol' || system.key === 'vehicle' || system.key === 'meetingroom' || system.key === 'officialdocs' || system.key === 'equipment' || system.key === 'structuremap') && allowed) return <OperationsHub system={system} profile={profile} />;
    return <AppShell profile={profile} title={system.title}>{allowed ? <><section className={`module-hero ${system.key}-module-hero`}><div><span>{zhSystemCode(system.code)}</span><h2>{system.title}</h2><p>{system.description}</p></div><img src={system.icon} alt="" /></section><section className={`module-grid ${system.key}-module-grid`}>{system.modules.map((module: ModuleDefinition, index: number) => <Link key={module.key} href={`/systems/${system.key}/${module.key}/`} className={system.key === 'meetingroom' ? 'meetingroom-module-card' : undefined}>{system.key === 'meetingroom' && <img src={meetingroomModuleIcons[module.key]} alt="" aria-hidden="true" />}<span>{zhModuleCode(index)}</span><h3>{module.title}</h3><p>{module.description}</p><b>開啟子系統 →</b></Link>)}</section></> : <div className="notice danger">目前角色沒有此系統權限，請由管理員開放。</div>}</AppShell>;
  }
  return <AuthGate>{profile => <Hub profile={profile} />}</AuthGate>;
}

