'use client';

// SYS-06 專案關係與設備圖臺：三個資料模組（區域位置表／整合標記／專案關係）。
// 模型管理是 V1 modelhub 的子系統導覽頁，不做資料維護，另放 structuremap-modelhub.tsx。
//
// 2D 平面圖與 3D 樓層由 structuremap-viewers.tsx 承接，兩者依賴 OpenSeadragon 與
// Three.js，載入方式與資產路徑另行處理。
//
// 這三張表的寫入政策為 has_system_access('sys_structuremap') 加上
// has_app_permission('create')／('update')（20260817110000 將其由 sys_equipment
// 收斂而來），伺服器端把關已存在，因此比照 SYS-05 直接走資料表。

import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { MARKET_ID } from '@/lib/config';
import { floorOrder } from '@/lib/floor';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, errorMessage, fmt, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import { AreaListModule } from './structuremap-arealist';
import { MarkerBoardModule } from './structuremap-markerboard';
import { ModelHubModule } from './structuremap-modelhub';
import { SystemRelations } from './system-relations';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

const ACTIVE_LABEL: Record<string, string> = { active: '啟用', inactive: '停用' };
const ACTIVE_TONE: Record<string, string> = { active: 'closed', inactive: 'cancelled' };

function Pill({ value, labels, tones }: { value: unknown; labels: Record<string, string>; tones: Record<string, string> }) {
  const key = String(value || '');
  return <span className={`status-pill ${tones[key] || 'pending'}`}>{labels[key] || fmt(value)}</span>;
}

export function StructureMapWorkspace({ system, module, profile }: Props) {
  if (module.key === 'areas') return <AreaListModule module={module} profile={profile} />;
  if (module.key === 'markers') return <MarkerBoardModule profile={profile} />;
  if (module.key === 'models') return <ModelHubModule module={module} profile={profile} />;
  return <RelationsModule system={system} module={module} profile={profile} />;
}

/* ──────────────────────────── 專案關係（場域位置） ──────────────────────────── */

function RelationsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [floor, setFloor] = useState(''), [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase().from('locations').select('*')
      .eq('market_id', MARKET_ID).order('floor_order').order('area_order').order('detail_order').limit(5000);
    if (error) setNote(`失敗：${errorMessage(error, '場域位置載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, floor]);

  const floors = useMemo(() => [...new Set(rows.map(r => String(r.floor || '')))].filter(Boolean)
    .sort((a, b) => floorOrder(a) - floorOrder(b)), [rows]);
  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    return (!floor || String(row.floor) === floor) &&
      (!q || [row.floor, row.area, row.detail].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, floor]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 樓層 → 區域 → 細部位置的層級統計，對應 V1 專案關係圖想呈現的結構。
  const tree = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of filtered) {
      const f = String(row.floor || '未分類'), a = String(row.area || '未分區');
      if (!map.has(f)) map.set(f, new Map());
      const areas = map.get(f)!;
      areas.set(a, (areas.get(a) || 0) + 1);
    }
    return [...map.entries()].sort((x, y) => floorOrder(x[0]) - floorOrder(y[0]));
  }, [filtered]);

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <SystemRelations />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋樓層、區域或細部位置" />
        <select value={floor} onChange={e => setFloor(e.target.value)}>
          <option value="">全部樓層</option>{floors.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <span>{floors.length} 個樓層／共 {filtered.length} 筆位置</span>
      </div>
      <div className="detail-timeline">
        <h3>樓層／區域結構</h3>
        <ol>{tree.map(([f, areas]) => <li key={f}>
          <b>{f}</b><span>{areas.size} 個區域、{[...areas.values()].reduce((a, b) => a + b, 0)} 筆位置</span>
          <p>{[...areas.entries()].map(([a, n]) => `${a}（${n}）`).join('、')}</p>
        </li>)}</ol>
      </div>
    </section>
    <section className="panel admin-panel">
      <div className="responsive-table"><table>
        <thead><tr><th>樓層</th><th>區域</th><th>細部位置</th><th>狀態</th></tr></thead>
        <tbody>{paged.map(row => <tr key={String(row.location_id)}>
          <td><strong>{fmt(row.floor)}</strong></td>
          <td>{fmt(row.area)}</td>
          <td>{fmt(row.detail)}</td>
          <td><Pill value={row.status} labels={ACTIVE_LABEL} tones={ACTIVE_TONE} /></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有場域位置資料</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
      <p className="inline-message">場域位置的新增與停用屬後台管理系統的「場域位置」模組（走 admin-api 的 admin_save_location／admin_toggle_location），此頁為結構檢視。</p>
    </section>
  </AppShell>;
}
