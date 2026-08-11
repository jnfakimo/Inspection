'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { LEGACY_BASE } from '@/lib/config';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { zhValue } from '@/lib/zh-tw';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type ModuleData = {
  title: string;
  table: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  summary?: Array<{ label: string; value: number | string }>;
};

function display(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map(display).join('、');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return String(obj.name || obj.title || obj.label || obj.username || Object.values(obj).map(display).filter(Boolean).join('、'));
  }
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('zh-TW', { hour12: false });
  }
  return zhValue(raw);
}

export function ModuleWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  function Workspace({ profile }: { profile: Profile }) {
    const [data, setData] = useState<ModuleData | null>(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [syncing, setSyncing] = useState(false);

    const load = useCallback(async () => {
      setSyncing(true);
      setError('');
      try {
        setData(await invokeAppApi<ModuleData>('module_data', { system: system.key, module: module.key }));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '資料讀取失敗');
      } finally {
        setSyncing(false);
      }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
      if (!data?.table) return;
      const channel = getSupabase().channel(`v2-${system.key}-${module.key}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: data.table }, () => { load(); })
        .subscribe();
      return () => { getSupabase().removeChannel(channel); };
    }, [data?.table, load]);

    const rows = useMemo(() => {
      if (!data || !query.trim()) return data?.rows || [];
      const needle = query.toLowerCase();
      return data.rows.filter(row => Object.values(row).some(value => display(value).toLowerCase().includes(needle)));
    }, [data, query]);

    return <AppShell profile={profile} title={module.title}>
      <div className="page-actions">
        <div><p>{module.description}</p>{error && <span className="inline-message danger">{error}</span>}</div>
        <div className="action-cluster">
          {system.key === 'workorder' && module.key === 'requests' && module.legacy && <a className="primary-btn compact" href={`${LEGACY_BASE}/${module.legacy}`}>＋ 新增報修</a>}
          {module.legacy && <a className="secondary-btn" href={`${LEGACY_BASE}/${module.legacy}`}>專業圖臺／進階作業</a>}
          <button className="primary-btn compact" onClick={load} disabled={syncing}>{syncing ? '同步中…' : '重新同步'}</button>
        </div>
      </div>
      <div className="realtime-state"><i /> 已啟用資料庫即時更新；存取仍受帳號角色與資料列權限保護。</div>
      {data?.summary && <section className="mini-metrics">{data.summary.map(item => <article key={item.label}><span>{zhValue(item.label)}</span><strong>{item.value}</strong></article>)}</section>}
      <section className="panel table-panel">
        <div className="panel-head"><h2>{data?.title || module.title}</h2><div className="table-tools"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋目前資料" /><span>{rows.length} 筆</span></div></div>
        {!data && !error ? <div className="loading-panel">正在透過安全服務載入資料…</div> : <div className="responsive-table"><table><thead><tr>{data?.columns.map(column => <th key={column.key}>{zhValue(column.label)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id || row.request_id || row.record_id || row.user_id || index)}>{data?.columns.map(column => <td key={column.key}>{display(row[column.key])}</td>)}</tr>)}</tbody></table>{data && rows.length === 0 && <p className="empty">查無資料</p>}</div>}
      </section>
    </AppShell>;
  }
  return <AuthGate>{profile => <Workspace profile={profile} />}</AuthGate>;
}
