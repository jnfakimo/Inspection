'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { MetricCard } from '@/components/MetricCard';
import { invokeAppApi } from '@/lib/supabase';
import { zhValue } from '@/lib/zh-tw';
import type { DashboardData, Profile } from '@/types/app';

function Dashboard({ profile }: { profile: Profile }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { invokeAppApi<DashboardData>('dashboard').then(setData).catch(e => setError(e.message)); }, []);
  return <AppShell profile={profile} title="戰情儀表板">
    {error && <div className="notice danger">{error}</div>}
    {!data ? <div className="panel loading-panel">正在彙整巡檢、設備與維修數據…</div> : <>
      <section className="metrics-grid">
        <MetricCard label="設備總數" value={data.metrics.equipment} unit="台" hint="設備主檔即時統計" />
        <MetricCard label="近 30 日巡檢" value={data.metrics.inspections} unit="筆" tone="green" hint={`異常 ${data.metrics.abnormal} 筆`} />
        <MetricCard label="未結維修" value={data.metrics.open_repairs} unit="件" tone="amber" hint="待處理與進行中" />
        <MetricCard label="巡檢正常率" value={data.metrics.completion_rate} unit="%" tone="violet" hint="近 30 日結果" />
      </section>
      <section className="dashboard-grid">
        <article className="panel"><div className="panel-head"><h2>30 日巡檢趨勢</h2><span>分析層</span></div><div className="trend-chart">{data.inspection_trend.map(row => { const max=Math.max(...data.inspection_trend.map(x=>x.total),1); return <div key={row.date} title={`${row.date}：${row.total} 筆／異常 ${row.abnormal}`}><i style={{height:`${Math.max(6,row.total/max*100)}%`}} className={row.abnormal?'has-alert':''}/><small>{row.date.slice(5)}</small></div>; })}</div></article>
        <article className="panel"><div className="panel-head"><h2>近期維修事件</h2><a href="/word-cloud/v2/systems/workorder/">開啟完整流程</a></div><DataList rows={data.recent_repairs} empty="目前沒有維修事件" /></article>
        <article className="panel span-2"><div className="panel-head"><h2>最新巡檢紀錄</h2><a href="/word-cloud/v2/inspections/">查看巡檢</a></div><DataList rows={data.recent_inspections} empty="目前沒有巡檢紀錄" /></article>
      </section>
    </>}
  </AppShell>;
}

function DataList({ rows, empty }: { rows: Array<Record<string, unknown>>; empty: string }) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  return <div className="data-list">{rows.map((row, index) => <div key={String(row.request_id || row.record_id || index)}><strong>{String(row.req_no || row.equipment_name || row.fault_location || '系統紀錄')}</strong><span>{zhValue(row.status || row.run_status || '')}</span><small>{new Date(String(row.created_at || row.inspect_time || Date.now())).toLocaleString('zh-TW',{hour12:false})}</small></div>)}</div>;
}

export default function Page() { return <AuthGate>{profile => <Dashboard profile={profile} />}</AuthGate>; }
