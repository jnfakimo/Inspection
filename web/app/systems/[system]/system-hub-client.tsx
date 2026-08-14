'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import { zhModuleCode, zhSystemCode } from '@/lib/zh-tw';
import type { Profile } from '@/types/app';

type WorkorderData = { rows: Array<Record<string, unknown>> };
type ModuleData = { rows: Array<Record<string, unknown>> };

function text(value: unknown): string { return value == null || value === '' ? '—' : String(value); }
function date(value: unknown): string { if (!value) return '—'; const raw = String(value); return raw.slice(0, 10); }
function repairStatus(value: unknown): string { return ({ pending: '待處理', assigned: '已派工', in_progress: '維修中', pending_review: '待驗收', closed: '已結案', cancelled: '已取消' } as Record<string, string>)[String(value)] || text(value); }
function repairStatusClass(value: unknown): string { return ({ pending: 'pending', assigned: 'assigned', in_progress: 'in-progress', pending_review: 'review', closed: 'closed', cancelled: 'cancelled' } as Record<string, string>)[String(value)] || 'unknown'; }

function WorkorderHub({ profile }: { profile: Profile }) {
  const [data, setData] = useState<WorkorderData>({ rows: [] });
  const [error, setError] = useState('');
  const [repairFilter, setRepairFilter] = useState('');
  const [maintenanceFilter, setMaintenanceFilter] = useState('');

  async function load() {
    setError('');
    try {
      const result = await invokeAppApi<ModuleData>('module_data', { system: 'workorder', module: 'requests' });
      setData({ rows: result.rows });
    } catch (caught) { setError(caught instanceof Error ? caught.message : '報修案件載入失敗'); }
  }
  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => data.rows.filter(row => {
    const status = String(row.status || '');
    const maintenanceStatus = String(row.maintenance_status || '');
    return (!repairFilter || status === repairFilter) && (!maintenanceFilter || (maintenanceFilter === '__none__' ? !maintenanceStatus : maintenanceStatus === maintenanceFilter));
  }), [data.rows, repairFilter, maintenanceFilter]);

  return <AppShell profile={profile} title="維修／派工／完工系統">
    <section className="workorder-page-header"><h2><img src="/word-cloud/assets/system-icons/maintenance-icon.png" alt="" /> 維修／派工／完工系統</h2><p>報修、派工及維修完工流程入口</p></section>
    <div className="workorder-note">■ MAINTENANCE WORKFLOW ・ 點選圖卡進入功能系統</div>
    <section className="maintenance-hub-grid">
      <Link className="maintenance-card cyan" href="/systems/workorder/requests/"><span className="maintenance-badge">MAIN-01</span><img src="/word-cloud/assets/system-icons/repair-request-icon.png" alt="報修與維修" /><h3>報修 &amp; 維修</h3><p>新增報修、案件查詢<br />維修進度與狀態管理</p><b>▶ 進入報修與維修</b></Link>
      <Link className="maintenance-card amber" href="/systems/workorder/dispatch/"><span className="maintenance-badge">MAIN-02</span><img src="/word-cloud/assets/system-icons/under-repair-icon.png" alt="派工" /><h3>派工系統</h3><p>建立派工、承辦指派<br />工單處理進度追蹤</p><b>▶ 進入派工系統</b></Link>
      <Link className="maintenance-card green" href="/systems/workorder/orders/"><span className="maintenance-badge">MAIN-03</span><img src="/word-cloud/assets/system-icons/repair-complete-icon.png" alt="維修完工回報" /><h3>維修完工回報</h3><p>填寫完工紀錄、照片回報<br />驗收及主管結案</p><b>▶ 進入完工回報</b></Link>
    </section>
    <h3 className="maintenance-overview-title">報修與維修案件總覽</h3>
    <section className="panel maintenance-overview">
      <div className="maintenance-filters"><select value={repairFilter} onChange={event => setRepairFilter(event.target.value)}><option value="">全部報修狀態</option><option value="pending">待處理</option><option value="assigned">已派工</option><option value="in_progress">維修中</option><option value="closed">已結案</option></select><select value={maintenanceFilter} onChange={event => setMaintenanceFilter(event.target.value)}><option value="">全部維修狀態</option><option value="__none__">未建立工單</option><option value="in_progress">維修中</option><option value="pending_review">待驗收</option><option value="closed">已結案</option></select><button className="secondary-btn" onClick={() => void load()}>重新載入</button></div>
      {error && <p className="inline-message danger">{error}</p>}
      <div className="responsive-table"><table><thead><tr><th>報修單編號</th><th>設備</th><th>報修人</th><th>故障說明</th><th>發生位置</th><th>來源</th><th>報修狀態</th><th>維修狀態</th><th>建立時間</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={String(row.request_id || row.req_no || index)}><td className="mono cyan-text">{text(row.req_no)}</td><td>{text(row.equipment_id)}</td><td>{text(row.reporter)}</td><td>{text(row.fault_desc).slice(0, 48)}</td><td>{text(row.fault_location)}</td><td>{row.source === 'inspection' ? '巡檢' : '直接通報'}</td><td><span className={`status-pill ${repairStatusClass(row.status)}`}>{repairStatus(row.status)}</span></td><td>{row.maintenance_status ? <span className={`status-pill ${repairStatusClass(row.maintenance_status)}`}>{repairStatus(row.maintenance_status)}</span> : '—'}</td><td className="mono">{date(row.created_at)}</td></tr>) : <tr><td colSpan={9} className="empty">{error ? '資料載入失敗' : '目前無紀錄'}</td></tr>}</tbody></table></div>
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
