'use client';

// SYS-06 的兩個檢視器：2D 平面樓層圖（OpenSeadragon）與 3D 立體樓層（Three.js）。
//
// 貼圖來源統一為公開儲存桶 floorplans 的 {image_path}（即 floor_models 那一欄，
// 目前為 B1.png～RF.png）。V1 用的是相對路徑 plans/tex/...，那是掛在 /Inspection/system
// 底下的資產；V2 位於 /Inspection/v2，改走 Storage 的絕對網址才不受站台路徑影響。
//
// 兩個函式庫都以動態 import 載入，不會進入其他頁面的初始 bundle。
// 平面圖採 OpenSeadragon 的 { type:'image' } 單張影像模式，與 V1 b1plan.html 現行
// 作法一致（該頁的 .dzi 圖磚是另一條未啟用的路徑）。
//
// 2026-08-21 起本頁改為全螢幕工具頁，與 3D 模型圖同一套版面：自帶頂列（含共用的六個
// 動作）、圖面滿版、控制項收進三個可收合的浮動面板。原本套的是 AppShell ＋ 後台面板
// 版型，圖面被擠在卡片裡，與相鄰的 3D 模型圖看起來像兩個系統。
// 外殼樣式沿用 structuremap-floor3d.css 的 .f3-* 類別，不另寫一份——那份現在是兩個
// 檢視器共用的骨架，只有本檔專屬的 .f2-* 是額外加的。

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './structuremap-floor3d.css';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { errorMessage, fmt, type Row } from '@/components/admin/shared';
import { allowedActions } from '@/lib/shared-actions';
import { floorOrder, floorTextureUrl } from './floor-stack-3d';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

const MARKER_KIND: Record<string, string> = {
  equipment: '設備', patrol: '巡檢點', repair: '報修', note: '註記', other: '其他',
};
const KIND_COLOR: Record<string, string> = {
  equipment: '#00d4ff', patrol: '#00ff9d', repair: '#ff3b3b', note: '#ffb300', other: '#b48aff',
};
const textureUrl = floorTextureUrl;

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
    const [m, k] = await Promise.all([
      client.from('floor_models').select('*').order('floor_id').limit(200),
      client.from('plan_markers').select('marker_id,floor_id,label,kind,x,y,color,status,note,equipment_id').limit(5000),
    ]);
    if (m.error || k.error) setNote(`失敗：${errorMessage(m.error || k.error, '圖臺資料載入失敗')}`);
    const sorted = (m.data || []).slice().sort((a, b) => floorOrder(String(a.floor_id)) - floorOrder(String(b.floor_id)));
    setModels(sorted); setMarkers(k.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { models, markers, busy, note, setNote, reload: load };
}

/* ──────────────────────────── 2D 平面樓層圖 ──────────────────────────── */

function Floor2DViewer({ module, profile }: Props) {
  const { models, markers, busy, note, setNote, reload } = useFloorData();
  const [floor, setFloor] = useState('');
  // 類型篩選由單選下拉改為逐項核取，與 3D 模型圖的標記面板一致：現場常要「只看報修
  // 加巡檢點」，單選做不到。
  const [showMarkers, setShowMarkers] = useState(true);
  const [visibleKinds, setVisibleKinds] = useState<Record<string, boolean>>(
    () => Object.fromEntries(Object.keys(MARKER_KIND).map(kind => [kind, true])));
  const [placing, setPlacing] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  // 三個面板一律預設收合，與 3D 模型圖相同：進場先看到完整圖面。
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [kindsOpen, setKindsOpen] = useState(false);
  const [placePanelOpen, setPlacePanelOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const osRef = useRef<any>(null);
  const overlayRef = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => { if (!floor && models.length) setFloor(String(models[0].floor_id)); }, [models, floor]);
  const model = useMemo(() => models.find(m => String(m.floor_id) === floor), [models, floor]);
  const visible = useMemo(() => (showMarkers ? markers.filter(m =>
    String(m.floor_id) === floor && visibleKinds[String(m.kind)] !== false) : []),
    [markers, floor, visibleKinds, showMarkers]);

  // 建立／切換 OpenSeadragon。函式庫以動態 import 載入。
  useEffect(() => {
    let disposed = false;
    const url = textureUrl(model?.image_path);
    if (!hostRef.current || !url) return;
    (async () => {
      const OpenSeadragon = (await import('openseadragon')).default;
      if (disposed || !hostRef.current) return;
      osRef.current = OpenSeadragon;
      if (!viewerRef.current) {
        viewerRef.current = OpenSeadragon({
          element: hostRef.current, prefixUrl: '',
          showNavigationControl: false, showNavigator: true, navigatorPosition: 'BOTTOM_LEFT',
          navigatorAutoFade: false,
          minZoomLevel: 0.2, maxZoomPixelRatio: 4, zoomPerScroll: 1.3,
          animationTime: 0.5, springStiffness: 7,
          panHorizontal: true, panVertical: true, constrainDuringPan: false,
          visibilityRatio: 0, crossOriginPolicy: 'Anonymous',
          // flick 屬於手勢設定，不是頂層選項（V1 寫在頂層其實不會生效）。
          gestureSettingsMouse: { flickEnabled: true, flickMomentum: 0.4 },
        });
      }
      overlayRef.current.clear();
      viewerRef.current.open({ type: 'image', url });
    })();
    return () => { disposed = true; };
  }, [model]);

  // 銷毀 viewer（僅在元件卸載時）。
  useEffect(() => () => { try { viewerRef.current?.destroy(); } catch { /* 忽略 */ } viewerRef.current = null; }, []);

  // 依 marker 清單重建覆蓋層。plan_markers 的 x／y 為 0–1 的相對座標。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const attach = () => {
      overlayRef.current.forEach(el => { try { viewer.removeOverlay(el); } catch { /* 忽略 */ } });
      overlayRef.current.clear();
      for (const marker of visible) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'plan-marker';
        el.style.background = String(marker.color || KIND_COLOR[String(marker.kind)] || '#00d4ff');
        el.title = `${marker.label ?? ''}（${MARKER_KIND[String(marker.kind)] || marker.kind}）`;
        el.onclick = event => { event.stopPropagation(); setSelected(marker); };
        try {
          // OpenSeadragon 是動態 import 的模組，不會掛在 window 上；Point 建構函式
          // 從 import 結果取用，避免在未載入時以 (window as any).OpenSeadragon 建立覆蓋層。
          const Point = osRef.current?.Point;
          if (!Point) throw new Error('viewer 尚未就緒');
          viewer.addOverlay({ element: el, location: new Point(Number(marker.x) || 0, Number(marker.y) || 0), placement: 'CENTER' });
          overlayRef.current.set(String(marker.marker_id), el);
        } catch { /* viewer 尚未就緒時略過，open 事件會再觸發一次 */ }
      }
    };
    viewer.addHandler('open', attach);
    attach();
    return () => { try { viewer.removeHandler('open', attach); } catch { /* 忽略 */ } };
  }, [visible]);

  // 定位模式：點擊圖面把選取的標記移到該處。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const onCanvasClick = async (event: any) => {
      if (!placing || !selected) return;
      event.preventDefaultAction = true;
      const point = viewer.viewport.pointFromPixel(event.position);
      const x = Number(point.x.toFixed(4)), y = Number(point.y.toFixed(4));
      setSaving(true); setNote('');
      const marker_id = selected.marker_id;
      if (!marker_id) { setNote('失敗：未選取標記'); setSaving(false); return; }
      try {
        await invokeAppApi<{ marker_id: string }>('move_structuremap_marker', { marker_id, x, y });
      } catch (error) {
        setSaving(false);
        setNote(`失敗：${errorMessage(error)}`);
        return;
      }
      setSaving(false);
      setPlacing(false); setSelected(null); await reload();
      setNote(`已將「${selected.label}」移到 ${x}, ${y}`);
    };
    viewer.addHandler('canvas-click', onCanvasClick);
    return () => { try { viewer.removeHandler('canvas-click', onCanvasClick); } catch { /* 忽略 */ } };
  }, [placing, selected, setNote, reload]);

  const shownFloor = model ? String(model.name || model.floor_id) : '—';
  const noteIsError = note.startsWith('失敗');

  return <div className="f3-root">
    {busy && <div className="f3-loading">
      <div className="ld-t">載入樓層平面圖…</div>
      <div className="ld-bar"><div className="ld-fill" style={{ width: '70%' }} /></div>
      <div className="ld-m">讀取樓層模型與標記…</div>
    </div>}

    <div className="f3-topbar">
      <span className="tb-logo">臺北農產公司 第一果菜市場</span>
      <span className="tb-sep" />
      <span className="tb-title">{module.title}</span>
      {/* 與 AppShell、3D 模型圖同一份定義（lib/shared-actions），依帳號可用的系統過濾。 */}
      <nav className="tb-nav" aria-label="共用系統導覽">
        {allowedActions(profile.allowed_systems).map(item =>
          <a key={item.href} href={`/Inspection/v2${item.href}`}>
            <img src={item.icon} alt="" /><span>{item.label}</span>
          </a>)}
      </nav>
      <span className="tb-space" />
      <a className="tb-back" href="/Inspection/v2/systems/structuremap/floor3d/">3D模型圖</a>
      <a className="tb-back" href="/Inspection/v2/systems/structuremap/floor2d/">平面模型圖</a>
    </div>

    {/* OSD 自己會在 host 裡增刪節點，所以空狀態訊息放在 host 外面、由 .f3-stage 承載。 */}
    <div className="f3-stage">
      <div ref={hostRef} className="f2-osd" />
      {!model && !busy && <p className="f3-empty">
        這個樓層沒有對應的平面材質，請先於「模型管理」設定 image_path。
      </p>}
    </div>

    {note && <div className={`f3-error${noteIsError ? '' : ' ok'}`}>{note}</div>}

    {placing && <div className="f3-focus">
      定位模式：點圖面上的位置，即可更新「{fmt(selected?.label)}」的座標
      <button onClick={() => setPlacing(false)} aria-label="取消定位">✕</button>
    </div>}

    {!placePanelOpen && <button className="f3-toggle ctrl" onClick={() => setPlacePanelOpen(true)}>標記定位</button>}
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
        <span className="p-t">標記顯示</span>
        <button className="panel-close" onClick={() => setKindsOpen(false)}>隱藏</button>
      </div>
      <label className="chk all">
        <input type="checkbox" checked={showMarkers}
          onChange={event => setShowMarkers(event.target.checked)} />所有標記
      </label>
      {/* 類型色以自訂屬性傳給 CSS，淺色主題才有機會把霓虹色壓深到可讀。 */}
      {Object.entries(MARKER_KIND).map(([kind, label]) => <label key={kind} className="chk kind"
        style={{ '--kind-color': KIND_COLOR[kind] } as React.CSSProperties}>
        <input type="checkbox" disabled={!showMarkers} checked={visibleKinds[kind] !== false}
          onChange={event => setVisibleKinds(current => ({ ...current, [kind]: event.target.checked }))} />
        {label}
      </label>)}
      <div className="f3-floors-count">本層 {visible.length} 個標記</div>
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

    {/* 底部右側：操作說明與目前顯示的樓層，與 3D 模型圖同一套。
        說明依 OpenSeadragon 的實際預設寫——滑鼠是拖曳平移、滾輪縮放、單擊放大
        （dblClickToZoom 對滑鼠預設為 false，只有觸控預設開啟），本頁只覆寫 flick。 */}
    <div className="f3-bottomright">
      <div className="f3-hint">拖曳：平移　｜　滾輪：縮放　｜　點擊空白處：放大　｜　雙指：縮放</div>
      <div className="f3-hud">
        <div className="h-t">{module.title}</div>
        <div className="h-r">顯示樓層：<span>{shownFloor}</span></div>
      </div>
    </div>
  </div>;
}
