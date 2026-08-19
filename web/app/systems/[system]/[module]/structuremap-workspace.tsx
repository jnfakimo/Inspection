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
import { ComboboxSelect } from '@/components/ComboboxSelect';
import { MARKET_ID } from '@/lib/config';
import { canonicalFloor, floorOrder } from '@/lib/floor';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, AdminModal, errorMessage, fmt, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import { AreaListModule } from './structuremap-arealist';
import { ModelHubModule } from './structuremap-modelhub';
import { SystemRelations } from './system-relations';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

const MARKER_KIND: Record<string, string> = {
  equipment: '設備', patrol: '巡檢點', repair: '報修', note: '註記', other: '其他',
};
const ACTIVE_LABEL: Record<string, string> = { active: '啟用', inactive: '停用' };
const ACTIVE_TONE: Record<string, string> = { active: 'closed', inactive: 'cancelled' };

function Pill({ value, labels, tones }: { value: unknown; labels: Record<string, string>; tones: Record<string, string> }) {
  const key = String(value || '');
  return <span className={`status-pill ${tones[key] || 'pending'}`}>{labels[key] || fmt(value)}</span>;
}

export function StructureMapWorkspace({ system, module, profile }: Props) {
  if (module.key === 'areas') return <AreaListModule module={module} profile={profile} />;
  if (module.key === 'markers') return <MarkersModule system={system} module={module} profile={profile} />;
  if (module.key === 'models') return <ModelHubModule module={module} profile={profile} />;
  return <RelationsModule system={system} module={module} profile={profile} />;
}

/* ──────────────────────────── 整合標記 ──────────────────────────── */

function MarkersModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [equipment, setEquipment] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [floor, setFloor] = useState(''), [kind, setKind] = useState(''), [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [m, e] = await Promise.all([
      client.from('plan_markers').select('*,equipment(name,asset_code)').order('floor_id').order('label').limit(5000),
      client.from('equipment').select('equipment_id,name,asset_code,floor').neq('status', 'retired').order('name').limit(5000),
    ]);
    if (m.error || e.error) setNote(`失敗：${errorMessage(m.error || e.error, '標記資料載入失敗')}`);
    setRows(m.data || []); setEquipment(e.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, floor, kind]);

  const floors = useMemo(() => [...new Set(rows.map(r => String(r.floor_id || '')))].filter(Boolean)
    .sort((a, b) => floorOrder(a) - floorOrder(b)), [rows]);
  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    const eq = (row.equipment as Row) || {};
    return (!floor || String(row.floor_id) === floor) && (!kind || String(row.kind) === kind) &&
      (!q || [row.label, row.floor_id, row.note, eq.name, eq.asset_code].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, floor, kind]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const save = async () => {
    if (!editor) return;
    const floorValue = canonicalFloor(editor.floor_id);
    if (!floorValue) { setNote('失敗：請填寫樓層'); return; }
    if (!String(editor.label || '').trim()) { setNote('失敗：請填寫標記名稱'); return; }
    const x = Number(editor.x), y = Number(editor.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { setNote('失敗：X／Y 座標必須是數字'); return; }
    setBusy(true); setNote('');
    const payload = {
      floor_id: floorValue, label: String(editor.label).trim(), kind: String(editor.kind || 'note'),
      x, y, color: String(editor.color || '').trim() || null,
      note: String(editor.note || '').trim() || null, status: String(editor.status || 'active'),
      equipment_id: editor.kind === 'equipment' ? (editor.equipment_id || null) : null,
    };
    const client = getSupabase();
    const { error } = editor.marker_id
      ? await client.from('plan_markers').update(payload).eq('marker_id', editor.marker_id)
      : await client.from('plan_markers').insert({ ...payload, created_by: profile.user_id });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    setEditor(null); await load(); setNote(editor.marker_id ? '標記已更新' : '標記已新增');
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => setEditor({ kind: 'note', status: 'active', x: 0, y: 0, floor_id: floor || '' })}>＋ 新增標記</button>} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋標記名稱、樓層、設備或說明" />
        <select value={floor} onChange={e => setFloor(e.target.value)}>
          <option value="">全部樓層</option>{floors.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">全部類型</option>
          {Object.entries(MARKER_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span>共 {filtered.length} 個標記</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>樓層</th><th>標記名稱</th><th>類型</th><th>座標</th><th>關聯設備</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{paged.map(row => {
          const eq = (row.equipment as Row) || {};
          return <tr key={String(row.marker_id)}>
            <td><strong>{fmt(row.floor_id)}</strong></td>
            <td>{fmt(row.label)}{row.note ? <small>{String(row.note)}</small> : null}</td>
            <td>{MARKER_KIND[String(row.kind)] || fmt(row.kind)}</td>
            <td>{row.x != null && row.y != null ? `${row.x}, ${row.y}` : '—'}</td>
            <td>{eq.name ? <>{String(eq.name)}<small>{fmt(eq.asset_code)}</small></> : '—'}</td>
            <td><Pill value={row.status} labels={ACTIVE_LABEL} tones={ACTIVE_TONE} /></td>
            <td><div className="admin-row-actions"><button onClick={() => setEditor({ ...row })}>編輯</button></div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有標記</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
      <p className="inline-message">此頁維護標記的屬性與座標數值；要在平面圖上直接點選定位，請使用「平面樓層圖」模組。</p>
    </section>

    {editor && <AdminModal title={editor.marker_id ? `編輯標記｜${fmt(editor.label)}` : '新增標記'} onClose={() => setEditor(null)}>
      <div className="admin-form-grid">
        <label>樓層（必填）<input value={String(editor.floor_id || '')} onChange={e => setEditor({ ...editor, floor_id: e.target.value })} placeholder="例：B1／1F" /></label>
        <label>類型<select value={String(editor.kind || 'note')} onChange={e => setEditor({ ...editor, kind: e.target.value })}>
          {Object.entries(MARKER_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        <label className="wide">標記名稱（必填）<input value={String(editor.label || '')} onChange={e => setEditor({ ...editor, label: e.target.value })} /></label>
        <label>X 座標<input type="number" step="0.0001" value={String(editor.x ?? 0)} onChange={e => setEditor({ ...editor, x: e.target.value })} /></label>
        <label>Y 座標<input type="number" step="0.0001" value={String(editor.y ?? 0)} onChange={e => setEditor({ ...editor, y: e.target.value })} /></label>
        {editor.kind === 'equipment' && <label className="wide">關聯設備
          <select value={String(editor.equipment_id || '')} onChange={e => setEditor({ ...editor, equipment_id: e.target.value || null })}>
            <option value="">-- 未關聯 --</option>
            {equipment.map(eq => <option key={String(eq.equipment_id)} value={String(eq.equipment_id)}>{`${eq.asset_code || ''} ${eq.name || ''}`.trim()}</option>)}
          </select></label>}
        <label>顏色<input value={String(editor.color || '')} onChange={e => setEditor({ ...editor, color: e.target.value })} placeholder="#00d4ff" /></label>
        <label>狀態<select value={String(editor.status || 'active')} onChange={e => setEditor({ ...editor, status: e.target.value })}>
          {Object.entries(ACTIVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        <label className="wide">說明<textarea rows={2} value={String(editor.note || '')} onChange={e => setEditor({ ...editor, note: e.target.value })} /></label>
      </div>
      <footer>
        <button className="secondary-btn" onClick={() => setEditor(null)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存'}</button>
      </footer>
    </AdminModal>}
  </AppShell>;
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
