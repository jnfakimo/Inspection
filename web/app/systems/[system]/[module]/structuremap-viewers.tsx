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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { AdminHeader, errorMessage, fmt, type Row } from '@/components/admin/shared';
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
  const [kindFilter, setKindFilter] = useState('');
  const [placing, setPlacing] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const osRef = useRef<any>(null);
  const overlayRef = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => { if (!floor && models.length) setFloor(String(models[0].floor_id)); }, [models, floor]);
  const model = useMemo(() => models.find(m => String(m.floor_id) === floor), [models, floor]);
  const visible = useMemo(() => markers.filter(m =>
    String(m.floor_id) === floor && (!kindFilter || String(m.kind) === kindFilter)), [markers, floor, kindFilter]);

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

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy || saving} note={note} onReload={reload} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <select value={floor} onChange={e => { setFloor(e.target.value); setSelected(null); setPlacing(false); }}>
          {models.map(m => <option key={String(m.floor_id)} value={String(m.floor_id)}>{m.name || m.floor_id}</option>)}
        </select>
        <select value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
          <option value="">全部類型</option>
          {Object.entries(MARKER_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span>{visible.length} 個標記</span>
        {selected && <>
          <span>已選：<b>{fmt(selected.label)}</b></span>
          <button className={placing ? 'primary-btn compact' : 'secondary-btn'} onClick={() => setPlacing(v => !v)}>
            {placing ? '點圖面完成定位（再按取消）' : '重新定位'}
          </button>
          <button className="secondary-btn" onClick={() => { setSelected(null); setPlacing(false); }}>取消選取</button>
        </>}
      </div>
      {!model && !busy && <p className="empty">這個樓層沒有對應的平面材質，請先於「模型管理」設定 image_path。</p>}
      {/* 圖面右下角標示現在看的是哪一層，並補上操作說明——與 3D 模型圖同一套做法。
          操作說明依 OpenSeadragon 的實際預設寫：滑鼠是拖曳平移、滾輪縮放、
          單擊放大（dblClickToZoom 對滑鼠預設為 false），觸控才是雙指縮放。
          本頁只覆寫 flick，其餘手勢維持預設。 */}
      <div className="plan-stage-wrap">
        <div ref={hostRef} className="plan-stage" />
        <div className="plan-bottomright">
          <div className="plan-hint">拖曳：平移　｜　滾輪：縮放　｜　點擊空白處：放大　｜　雙指：縮放</div>
          <div className="plan-hud">
            <div className="h-t">平面模型圖</div>
            <div className="h-r">顯示樓層：<span>{model ? String(model.name || model.floor_id) : '—'}</span></div>
          </div>
        </div>
      </div>
      <p className="inline-message">
        點選圖面上的標記可選取，再按「重新定位」後點圖面即可更新座標（存回 plan_markers 的 x／y，0–1 相對座標）。
        標記的新增與屬性維護請用「整合標記」模組。
      </p>
    </section>
  </AppShell>;
}
