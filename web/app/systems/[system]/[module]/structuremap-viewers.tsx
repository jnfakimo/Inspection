'use client';

// SYS-06 平面樓層圖：與 3D 立體樓層共用同一批 GLB，由 Three.js 正上方投影顯示。
//
// PNG 僅保留給舊資料與編修流程；此檢視器不簽署、不下載 PNG，也沒有 PNG 失敗備援。
//
// 2026-08-21 起本頁改為全螢幕工具頁，與 3D 模型圖同一套版面：自帶頂列（含共用的六個
// 動作）、圖面滿版、控制項收進三個可收合的浮動面板。原本套的是 AppShell ＋ 後台面板
// 版型，圖面被擠在卡片裡，與相鄰的 3D 模型圖看起來像兩個系統。
// 外殼樣式沿用 structuremap-floor3d.css 的 .f3-* 類別，不另寫一份——那份現在是兩個
// 檢視器共用的骨架，只有本檔專屬的 .f2-* 是額外加的。

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import './structuremap-floor3d.css';
import './structuremap-pin.css';
import { AuthGate } from '@/components/AuthGate';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { errorMessage, fmt, type Row } from '@/components/admin/shared';
import { canonicalFloor } from '@/lib/floor';
import { FloorStack3D, type StackMarker } from './floor-stack-3d';
import { loadMarketBimModels } from '@/lib/market-bim-models';
import { STRUCTUREMAP_ROUTES } from '@/lib/structuremap-routes';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import { StructuremapTopbarActions } from './structuremap-topbar-actions';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

const MARKER_KIND: Record<string, string> = {
  equipment: '設備', space: '空間', patrol: '巡檢點', repair: '報修點', note: '註記', other: '其他',
};
const KIND_COLOR: Record<string, string> = {
  equipment: '#00d4ff', space: '#00d4ff', patrol: '#00ff9d', repair: '#ff3b3b', note: '#ffb300', other: '#b48aff',
};
// 標記大小：0.5〜3 倍、預設 1 倍，與立體巡檢雲臺同一組刻度。
const DOT_MIN = 0.5, DOT_MAX = 3, DOT_STEP = 0.1, DOT_DEFAULT = 1;
const CHECKED_COLOR = '#00ff9d';
const UNCHECKED_COLOR = '#ff3b3b';

export function StructureMapViewers({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  // floor3d 於 2026-08-19 改為 V1 floor3d.html 的全螢幕移植，元件在
  // structuremap-floor3d.tsx；此處只留下 2D 平面樓層圖。
  return <AuthGate>{profile => <Floor2DViewer system={system} module={module} profile={profile} />}</AuthGate>;
}

/** 兩個檢視器共用的樓層與標記資料。 */
function useFloorData() {
  const [models, setModels] = useState<Row[]>([]);
  const [markers, setMarkers] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    let glbModels;
    let k;
    try {
      [glbModels, k] = await Promise.all([
        loadMarketBimModels(),
        client.from('plan_markers').select('marker_id,floor_id,label,kind,x,y,color,status,note,equipment_id').limit(1000),
      ]);
    } catch (error) {
      setNote(`失敗：${errorMessage(error, 'GLB 樓層模型載入失敗')}`);
      setModels([]); setBusy(false);
      return;
    }
    if (k.error) setNote(`失敗：${errorMessage(k.error, '標記載入失敗')}`);
    setModels(glbModels as unknown as Row[]);
    setMarkers((k.data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) })));
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { models, markers, busy, note, setNote, reload: load };
}

/* ──────────────────────────── 2D 平面樓層圖 ──────────────────────────── */

function Floor2DViewer({ system, module, profile }: Props) {
  const { models, markers, busy, note, setNote, reload } = useFloorData();
  const [floor, setFloor] = useState('');
  // 類型篩選由單選下拉改為逐項核取，與 3D 模型圖的標記面板一致：現場常要「只看報修
  // 加巡檢點」，單選做不到。
  const [showMarkers, setShowMarkers] = useState(true);
  const patrolOnly = typeof location !== 'undefined' && new URLSearchParams(location.search).get('kind') === 'patrol';
  const repairOnly = typeof location !== 'undefined' && new URLSearchParams(location.search).get('kind') === 'repair';
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  const [checkins, setCheckins] = useState<Row[]>([]);
  // ?kind=patrol：從駐衛警巡檢的立體巡檢雲臺跳過來時只看巡檢點。不另外複製一份
  // 頁面，也不改預設——直接進本頁仍是全部類型都顯示。
  const [visibleKinds, setVisibleKinds] = useState<Record<string, boolean>>(() => {
    // 只認得的類型才套用，理由同 3D 模型圖：給了不存在的值會全部關掉變成空圖。
    const raw = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('kind');
    const only = raw && MARKER_KIND[raw] ? raw : null;
    const repairKinds = new Set(['repair', 'space']);
    return Object.fromEntries(Object.keys(MARKER_KIND).map(kind => [kind, repairOnly ? repairKinds.has(kind) : only ? kind === only : true]));
  });
  // 與 3D 模型圖同名同語意的開關：關閉時標籤只在滑過圖釘時浮現。
  const [showLabels, setShowLabels] = useState(false);
  const [dotScale, setDotScale] = useState(DOT_DEFAULT);
  const [placing, setPlacing] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  // 三個面板一律預設收合，與 3D 模型圖相同：進場先看到完整圖面。
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [kindsOpen, setKindsOpen] = useState(false);
  const [placePanelOpen, setPlacePanelOpen] = useState(false);

  useEffect(() => {
    if (!patrolOnly) return;
    let cancelled = false;
    void getSupabase().from('checkin_logs').select('checkin_id,target_id,label,floor_id')
      .gte('checkin_at', `${date}T00:00:00+08:00`).lte('checkin_at', `${date}T23:59:59+08:00`)
      .limit(1000).then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setNote(`失敗：${errorMessage(error, '打卡資料載入失敗')}`); return; }
        setCheckins((data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) })));
      });
    return () => { cancelled = true; };
  }, [date, patrolOnly, setNote]);

  const checkedIds = useMemo(() => {
    const ids = new Set<string>();
    checkins.forEach(row => { if (row.target_id) ids.add(String(row.target_id)); ids.add(`${row.floor_id}|${row.label}`); });
    return ids;
  }, [checkins]);
  const isChecked = useCallback((marker: Row) =>
    checkedIds.has(String(marker.marker_id)) || checkedIds.has(`${marker.floor_id}|${marker.label}`), [checkedIds]);

  useEffect(() => { if (!floor && models.length) setFloor(String(models[0].floor_id)); }, [models, floor]);
  const model = useMemo(() => models.find(m => String(m.floor_id) === floor), [models, floor]);
  const visible = useMemo(() => (showMarkers ? markers.filter(m =>
    String(m.floor_id) === floor && m.status !== 'inactive'
      && (patrolOnly ? String(m.kind) === 'patrol' : repairOnly ? (String(m.kind) === 'repair' || String(m.kind) === 'space') : visibleKinds[String(m.kind)] !== false))
    .map(m => patrolOnly && String(m.kind) === 'patrol'
      ? { ...m, color: isChecked(m) ? CHECKED_COLOR : UNCHECKED_COLOR } : m) : []),
    [markers, floor, visibleKinds, showMarkers, patrolOnly, repairOnly, isChecked]);
  const patrolMarkers = useMemo(() => markers.filter(m => String(m.kind) === 'patrol' && m.status !== 'inactive'), [markers]);
  const done = patrolMarkers.filter(isChecked).length;
  const stackMarkers: StackMarker[] = useMemo(() => visible.map(marker => ({
    id: String(marker.marker_id),
    floor_id: String(marker.floor_id),
    x: Number(marker.x) || 0,
    y: Number(marker.y) || 0,
    color: String(marker.color || KIND_COLOR[String(marker.kind)] || '#00d4ff'),
    kind: String(marker.kind || ''),
    label: String(marker.label || ''),
  })), [visible]);
  const selectMarker = useCallback((markerId: string) => {
    const marker = visible.find(row => String(row.marker_id) === markerId);
    if (marker) setSelected(marker);
  }, [visible]);
  const placeOnGlb = useCallback(async ({ x, y }: { x: number; y: number }) => {
    if (!placing || !selected) return;
    setSaving(true); setNote('');
    const marker_id = selected.marker_id;
    if (!marker_id) { setNote('失敗：未選取標記'); setSaving(false); return; }
    try {
      await invokeAppApi<{ marker_id: string }>('move_structuremap_marker', {
        marker_id, x: Number(x.toFixed(4)), y: Number(y.toFixed(4)),
      });
      setPlacing(false); setSelected(null); await reload();
      setNote(`已更新標記座標：${x.toFixed(4)}, ${y.toFixed(4)}`);
    } catch (error) {
      setNote(`失敗：${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }, [placing, selected, reload, setNote]);

  const shownFloor = model ? String(model.name || model.floor_id) : '—';
  const noteIsError = note.startsWith('失敗');

  // 平面圖沒有 3D 的「控制」面板，左欄少一顆按鈕；標記面板要跟右邊的樓層面板同高。
  // 標記大小用 CSS 變數往下傳：OSD 會自行增刪覆蓋層節點，交給 CSS 才不必逐顆重算。
  return <div className="f3-root f3-no-ctrl" style={{ '--pin-scale': dotScale } as React.CSSProperties}>
    {busy && <div className="f3-loading">
      <div className="ld-t">載入樓層平面圖…</div>
      <div className="ld-bar"><div className="ld-fill" style={{ width: '70%' }} /></div>
      <div className="ld-m">讀取樓層模型與標記…</div>
    </div>}

    <div className="f3-topbar" data-system-page-heading="compact" data-system-key={system.key} data-module-key={module.key}>
      <span className="tb-logo">臺北農產公司 第一果菜市場</span>
      <span className="tb-sep" />
      <img className="tb-system-icon" src={system.icon} alt="" data-system-page-logo />
      <span className="tb-title">{module.title}</span>
      <span className="tb-space" />
      <StructuremapTopbarActions planeHref={repairOnly ? '/Inspection/v2/systems/workorder/repairmap3d/' : `${STRUCTUREMAP_ROUTES.patrolMap3d}?kind=patrol`} label="切換3D圖" />
    </div>

    {/* 平面圖與 3D 圖共用 GLB；此處鎖定正上方俯角，但允許平面旋轉。 */}
    <div className="f3-stage">
      {model && <FloorStack3D
        models={[model] as never}
        markers={stackMarkers}
        showMarkers={showMarkers}
        showLabels={showLabels}
        markerScale={dotScale}
        gap={0}
        planMode
        onMarkerClick={selectMarker}
        onPlanClick={placeOnGlb}
      />}
      {!model && !busy && <p className="f3-empty">
        這個樓層尚未建立 GLB 模型，請先更新模型 manifest。
      </p>}
    </div>

    {note && <div className={`f3-error${noteIsError ? '' : ' ok'}`}>{note}</div>}

    {placing && <div className="f3-focus">
      定位模式：點圖面上的位置，即可更新「{fmt(selected?.label)}」的座標
      <button onClick={() => setPlacing(false)} aria-label="取消定位">✕</button>
    </div>}

    {!kindsOpen && <button className="f3-toggle marks" onClick={() => setKindsOpen(true)}>標記顯示</button>}
    {!floorsOpen && <button className="f3-toggle floors" onClick={() => setFloorsOpen(true)}>樓層顯示</button>}

    {floorsOpen && <div className="f3-floors">
      <div className="panel-head">
        <span className="p-t">樓層顯示</span>
        <button className="panel-close" onClick={() => setFloorsOpen(false)}>隱藏</button>
      </div>
      {/* 由上而下排列，與實際樓層高低一致。平面圖一次只呈現一層，所以是單選而非開關。 */}
      {models.slice().reverse().map(row => {
        const id = String(row.floor_id);
        const on = id === floor;
        return <button key={id} className={`fbtn${on ? ' on' : ''}`} aria-pressed={on}
          onClick={() => { setFloor(id); setSelected(null); setPlacing(false); }}>
          <span className="dot" />{String(row.name || id)}
        </button>;
      })}
      <div className="f3-floors-count">一次顯示一層，共 {models.length} 層</div>
    </div>}

    {kindsOpen && <div className="f3-mkpanel">
      <div className="panel-head">
        <span className="p-t">{patrolOnly ? '巡檢點顯示' : '標記顯示'}</span>
        <button className="panel-close" onClick={() => setKindsOpen(false)}>隱藏</button>
      </div>
      {patrolOnly && <>
        <label htmlFor="f2-date">巡檢日期</label>
        <LocalizedDateInput id="f2-date" aria-label="巡檢日期（年/月/日）"
          value={date} onChange={event => setDate(event.target.value)} />
      </>}
      <label className="chk all">
        <input type="checkbox" checked={showMarkers}
        onChange={event => setShowMarkers(event.target.checked)} />{patrolOnly ? '顯示巡檢點' : repairOnly ? '顯示報修點與空間' : '所有標記'}
      </label>
      {/* 類型色以自訂屬性傳給 CSS，淺色主題才有機會把霓虹色壓深到可讀。 */}
      {!patrolOnly && !repairOnly && Object.entries(MARKER_KIND).map(([kind, label]) => <label key={kind} className="chk kind"
        style={{ '--kind-color': KIND_COLOR[kind] } as React.CSSProperties}>
        <input type="checkbox" disabled={!showMarkers} checked={visibleKinds[kind] !== false}
          onChange={event => setVisibleKinds(current => ({ ...current, [kind]: event.target.checked }))} />
        {label}
      </label>)}
      <label className="chk labels">
        <input type="checkbox" disabled={!showMarkers} checked={showLabels}
          onChange={event => setShowLabels(event.target.checked)} />文字標籤
      </label>
      <label htmlFor="f2-dot">{patrolOnly ? '打卡點大小' : '標記大小'}</label>
      <input id="f2-dot" type="range" min={DOT_MIN} max={DOT_MAX} step={DOT_STEP} disabled={!showMarkers}
        value={dotScale} onChange={event => setDotScale(Number(event.target.value))} />
      <div className="h-r">{patrolOnly ? '打卡點' : '標記'}：<span>{dotScale.toFixed(1)}×</span>
        <button className="mini" onClick={() => setDotScale(DOT_DEFAULT)}>原大小</button></div>
      {patrolOnly ? <>
        <div className="chk kind legend" style={{ '--kind-color': CHECKED_COLOR } as React.CSSProperties}>
          <span className="legend-dot" />已打卡 {done}
        </div>
        <div className="chk kind legend" style={{ '--kind-color': UNCHECKED_COLOR } as React.CSSProperties}>
          <span className="legend-dot" />未打卡 {patrolMarkers.length - done}
        </div>
      </> : repairOnly ? <><div className="chk kind legend" style={{ '--kind-color': KIND_COLOR.repair } as React.CSSProperties}><span className="legend-dot" />報修點 {visible.filter(m => m.kind === 'repair').length}</div><div className="chk kind legend" style={{ '--kind-color': KIND_COLOR.space } as React.CSSProperties}><span className="legend-dot" />空間 {visible.filter(m => m.kind === 'space').length}</div></> : <div className="f3-floors-count">本層 {visible.length} 個標記</div>}
    </div>}

    {placePanelOpen && <div className="f3-panel">
      <div className="panel-head">
        <span className="p-t">標記定位</span>
        <button className="panel-close" onClick={() => setPlacePanelOpen(false)}>隱藏</button>
      </div>
      <div className="h-r">已選標記：<span>{selected ? fmt(selected.label) : '尚未選取'}</span></div>
      <p className="f2-note">
        點圖面上的標記即可選取，再按「重新定位」後點圖面，就會把座標更新到該處
        （存回 plan_markers 的 x／y，0–1 相對座標）。標記的新增與屬性維護請用「整合標記」模組。
      </p>
      <div className="btnrow">
        <button className="mini" disabled={!selected || saving}
          onClick={() => setPlacing(value => !value)}>{placing ? '定位中…' : '重新定位'}</button>
        <button className="mini" disabled={!selected}
          onClick={() => { setSelected(null); setPlacing(false); }}>取消選取</button>
        <button className="mini" disabled={busy || saving} onClick={() => void reload()}>⟳ 重新載入</button>
      </div>
    </div>}

    {/* 底部右側：操作說明與目前顯示的樓層，與 3D 模型圖同一套。 */}
    <div className="f3-bottomright">
      <div className="f3-hint">左鍵拖曳：旋轉平面　｜　右鍵拖曳：平移　｜　滾輪／雙指：縮放</div>
      <div className="f3-hud">
        <div className="h-t">{module.title}</div>
        <div className="h-r">顯示樓層：<span>{shownFloor}</span></div>
      </div>
    </div>
  </div>;
}
