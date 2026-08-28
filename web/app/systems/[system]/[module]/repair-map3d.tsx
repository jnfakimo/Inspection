'use client';

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './structuremap-floor3d.css';
import { getSupabase } from '@/lib/supabase';
import { signFloorPlanVariants, type FloorPlanUrls } from '@/lib/floorplan-storage';
import { canonicalFloor } from '@/lib/floor';
import { floorOrder, FloorStack3D, type FloorStackApi, type StackMarker } from './floor-stack-3d';
import { StructuremapTopbarActions } from './structuremap-topbar-actions';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import type { Row } from '@/components/admin/shared';

const REPAIR_COLOR = '#ff3b3b';
const SPACE_COLOR = '#00d4ff';
const GAP_DEFAULT = 6;
const GAP_PER_STEP = 1.6 / GAP_DEFAULT;

export function RepairMap3DModule({ module, profile: _profile, system: _system }: { module: ModuleDefinition; profile: Profile; system: SystemDefinition }) {
  const [models, setModels] = useState<Row[]>([]), [markers, setMarkers] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [explode, setExplode] = useState(GAP_DEFAULT), [showMarkers, setShowMarkers] = useState(true), [showLabels, setShowLabels] = useState(false);
  const [visibleFloors, setVisibleFloors] = useState<Record<string, boolean>>({});
  const [pointsOpen, setPointsOpen] = useState(false), [ctrlOpen, setCtrlOpen] = useState(false), [floorsOpen, setFloorsOpen] = useState(false);
  const apiRef = useRef<FloorStackApi | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote(''); const client = getSupabase();
    const [m, p] = await Promise.all([
      client.from('floor_models').select('floor_id,name,image_path,level').order('floor_id').limit(200),
      client.from('plan_markers').select('marker_id,floor_id,label,kind,x,y,color,status').in('kind', ['repair', 'space']).limit(5000),
    ]);
    if (m.error || p.error) setNote(`失敗：${String((m.error || p.error)?.message || '圖資載入失敗')}`);
    const source = (m.data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) })).sort((a, b) => floorOrder(String(a.floor_id)) - floorOrder(String(b.floor_id)));
    let variants = new Map<string, FloorPlanUrls>();
    try { variants = await signFloorPlanVariants(source.map(row => String(row.image_path || '')), client); } catch (error) { setNote(`失敗：${String(error)}`); }
    const ready = source.map(row => { const urls = variants.get(String(row.image_path || '')); return { ...row, image_url: urls?.raw || '', light_url: urls?.light || '', tech_url: urls?.tech || '' }; }).filter(row => row.image_url || row.light_url || row.tech_url);
    setModels(ready); setVisibleFloors(Object.fromEntries(ready.map(row => [String(row.floor_id), true])));
    setMarkers((p.data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }))); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const active = useMemo(() => markers.filter(row => row.status !== 'inactive'), [markers]);
  const stackMarkers: StackMarker[] = useMemo(() => active.map(row => ({
    id: String(row.marker_id), floor_id: String(row.floor_id), x: Number(row.x) || 0, y: Number(row.y) || 0,
    color: String(row.kind) === 'space' ? SPACE_COLOR : REPAIR_COLOR, kind: String(row.kind), label: String(row.label || ''),
  })), [active]);
  const shownFloors = models.filter(row => visibleFloors[String(row.floor_id)] !== false);
  const shownFloorText = shownFloors.length === models.length ? `全部 ${models.length} 層` : shownFloors.map(row => String(row.floor_id)).join('、') || '未選取任何樓層';
  const resetView = () => { setExplode(GAP_DEFAULT); apiRef.current?.resetView(); };

  return <div className="f3-root">
    {busy && <div className="f3-loading"><div className="ld-t">載入報修 3D 平面圖…</div><div className="ld-bar"><div className="ld-fill" style={{ width: '70%' }} /></div><div className="ld-m">讀取共用樓層圖資與報修標記…</div></div>}
    <div className="f3-topbar" data-system-page-heading="compact" data-system-key="workorder" data-module-key="repairmap3d">
      <span className="tb-logo">臺北農產公司 第一果菜市場</span><span className="tb-sep" />
      <img className="tb-system-icon" src="/Inspection/assets/system-icons/maintenance-icon.png" alt="" data-system-page-logo /><span className="tb-title">{module.title}</span><span className="tb-space" />
      <StructuremapTopbarActions planeHref="/Inspection/v2/systems/structuremap/floor2d/?kind=repair" label="切換平面圖" />
    </div>
    <div className="f3-stage">{models.length ? <FloorStack3D models={models as never} markers={stackMarkers} showMarkers={showMarkers} showLabels={showLabels} visibleFloors={visibleFloors} gap={explode * GAP_PER_STEP} apiRef={apiRef} /> : !busy && <p className="f3-empty">尚未設定樓層圖資，請至「圖資專案設定」建立。</p>}</div>
    {note && <div className="f3-error">{note}</div>}
    {!ctrlOpen && <button className="f3-toggle ctrl" onClick={() => setCtrlOpen(true)}>立體控制</button>}
    {!pointsOpen && <button className="f3-toggle marks" onClick={() => setPointsOpen(true)}>標記顯示</button>}
    {!floorsOpen && <button className="f3-toggle floors" onClick={() => setFloorsOpen(true)}>樓層顯示</button>}
    {pointsOpen && <div className="f3-mkpanel"><div className="panel-head"><span className="p-t">標記顯示</span><button className="panel-close" onClick={() => setPointsOpen(false)}>隱藏</button></div><label className="chk all"><input type="checkbox" checked={showMarkers} onChange={e => setShowMarkers(e.target.checked)} />顯示報修點與空間</label><label className="chk labels"><input type="checkbox" disabled={!showMarkers} checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />文字標籤</label><div className="chk kind legend" style={{ '--kind-color': REPAIR_COLOR } as React.CSSProperties}><span className="legend-dot" />報修點 {active.filter(r => r.kind === 'repair').length}</div><div className="chk kind legend" style={{ '--kind-color': SPACE_COLOR } as React.CSSProperties}><span className="legend-dot" />空間 {active.filter(r => r.kind === 'space').length}</div></div>}
    {floorsOpen && <div className="f3-floors"><div className="panel-head"><span className="p-t">樓層顯示</span><button className="panel-close" onClick={() => setFloorsOpen(false)}>隱藏</button></div>{models.slice().reverse().map(row => { const id = String(row.floor_id); const on = visibleFloors[id] !== false; return <button key={id} className={`fbtn${on ? ' on' : ''}`} onClick={() => setVisibleFloors(current => ({ ...current, [id]: !on }))}><span className="dot" />{String(row.name || id)}</button>; })}<div className="f3-floors-count">顯示 {shownFloors.length}／{models.length} 層</div></div>}
    {ctrlOpen && <div className="f3-panel"><div className="panel-head"><span className="p-t">立體控制</span><button className="panel-close" onClick={() => setCtrlOpen(false)}>隱藏</button></div><label htmlFor="repair-gap">樓層間距（視覺）</label><input id="repair-gap" type="range" min="1" max="20" step="0.5" value={explode} onChange={e => setExplode(Number(e.target.value))} /><div className="h-r">放大倍率：<span>{explode}×</span></div><div className="btnrow"><button className="mini" onClick={resetView}>⊡ 重置</button><button className="mini" onClick={() => apiRef.current?.topView()}>⊤ 俯視</button><button className="mini" onClick={() => setExplode(1)}>真實比例</button></div><p className="f2-note">圖資與標記同步讀取 3D 雲台使用的 floor_models、plan_markers。</p></div>}
    <div className="f3-bottomright"><div className="f3-hint">左鍵拖曳：旋轉環繞　｜　右鍵拖曳：平移　｜　滾輪／雙指：縮放</div><div className="f3-hud"><div className="h-t">{module.title}</div><div className="h-r">顯示樓層：<span>{shownFloorText}</span></div><div className="h-r">標記：<span>報修點 {active.filter(r => r.kind === 'repair').length}／空間 {active.filter(r => r.kind === 'space').length}</span></div></div></div>
  </div>;
}
