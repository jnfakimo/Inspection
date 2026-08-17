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
import { getSupabase } from '@/lib/supabase';
import { SUPABASE_URL } from '@/lib/config';
import { AdminHeader, errorMessage, fmt, type Row } from '@/components/admin/shared';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

const MARKER_KIND: Record<string, string> = {
  equipment: '設備', patrol: '巡檢點', repair: '報修', note: '註記', other: '其他',
};
const KIND_COLOR: Record<string, string> = {
  equipment: '#00d4ff', patrol: '#00ff9d', repair: '#ff3b3b', note: '#ffb300', other: '#b48aff',
};
const textureUrl = (imagePath: unknown) =>
  imagePath ? `${SUPABASE_URL}/storage/v1/object/public/floorplans/${String(imagePath)}` : '';
function floorOrder(floor: string) {
  const basement = floor.match(/^B(\d+)$/); if (basement) return -Number(basement[1]);
  if (floor === 'RF') return 999;
  const above = floor.match(/^(\d+)F$/); if (above) return Number(above[1]);
  return 500;
}

export function StructureMapViewers({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => module.key === 'floor3d'
    ? <Floor3DViewer system={system} module={module} profile={profile} />
    : <Floor2DViewer system={system} module={module} profile={profile} />}</AuthGate>;
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
          viewer.addOverlay({ element: el, location: new (window as any).OpenSeadragon.Point(Number(marker.x) || 0, Number(marker.y) || 0), placement: 'CENTER' });
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
      const { error } = await getSupabase().from('plan_markers').update({ x, y }).eq('marker_id', selected.marker_id);
      setSaving(false);
      if (error) { setNote(`失敗：${errorMessage(error)}`); return; }
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
      <div ref={hostRef} className="plan-stage" />
      <p className="inline-message">
        點選圖面上的標記可選取，再按「重新定位」後點圖面即可更新座標（存回 plan_markers 的 x／y，0–1 相對座標）。
        標記的新增與屬性維護請用「整合標記」模組。
      </p>
    </section>
  </AppShell>;
}

/* ──────────────────────────── 3D 立體樓層 ──────────────────────────── */

function Floor3DViewer({ module, profile }: Props) {
  const { models, markers, busy, note, reload } = useFloorData();
  const [showMarkers, setShowMarkers] = useState(true);
  const [gap, setGap] = useState(1.6);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    if (!hostRef.current || !models.length) return;
    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed || !hostRef.current) return;
      const host = hostRef.current;
      host.innerHTML = '';

      const width = host.clientWidth || 900, height = host.clientHeight || 560;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x04101f);
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
      camera.position.set(9, 9, 12);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(0, models.length * gap / 2, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const dir = new THREE.DirectionalLight(0xffffff, 0.7);
      dir.position.set(8, 14, 6);
      scene.add(dir);

      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      const planeW = 10, planeH = 7;
      // level 目前資料皆為 0，因此以清單順序乘以間距堆疊；若日後 level 有值則優先採用。
      const useLevel = models.some(m => Number(m.level) !== 0);
      const heightOf = (index: number, row: Row) => useLevel ? Number(row.level) || 0 : index * gap;

      models.forEach((row, index) => {
        const y = heightOf(index, row);
        const material = new THREE.MeshBasicMaterial({ color: 0x0a2036, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = y;
        scene.add(mesh);

        const url = textureUrl(row.image_path);
        if (url) {
          loader.load(url, texture => {
            texture.colorSpace = THREE.SRGBColorSpace;
            material.map = texture; material.color.set(0xffffff); material.needsUpdate = true;
          }, undefined, () => { /* 貼圖載入失敗時保留底色，不中斷場景 */ });
        }

        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(planeW, planeH)),
          new THREE.LineBasicMaterial({ color: 0x1a4a70 }));
        edges.rotation.x = -Math.PI / 2; edges.position.y = y + 0.002;
        scene.add(edges);

        if (showMarkers) {
          const floorMarkers = markers.filter(m => String(m.floor_id) === String(row.floor_id) && m.status !== 'inactive');
          for (const marker of floorMarkers) {
            const color = new THREE.Color(String(marker.color || KIND_COLOR[String(marker.kind)] || '#00d4ff'));
            const dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), new THREE.MeshBasicMaterial({ color }));
            // plan_markers 的 x／y 是 0–1 相對座標，換算到平面尺寸並置中。
            dot.position.set((Number(marker.x) || 0) * planeW - planeW / 2, y + 0.12, (Number(marker.y) || 0) * planeH - planeH / 2);
            scene.add(dot);
          }
        }
      });

      let raf = 0;
      const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
      tick();
      const onResize = () => {
        const w = host.clientWidth || width, h = host.clientHeight || height;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      cleanupRef.current = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        controls.dispose();
        scene.traverse(obj => {
          const mesh = obj as any;
          mesh.geometry?.dispose?.();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m: any) => { m.map?.dispose?.(); m.dispose?.(); });
          else if (mat) { mat.map?.dispose?.(); mat.dispose?.(); }
        });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      };
    })();
    return () => { disposed = true; cleanupRef.current(); cleanupRef.current = () => {}; };
  }, [models, markers, showMarkers, gap]);

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={reload} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <span>{models.length} 個樓層</span>
        <label className="checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showMarkers} onChange={e => setShowMarkers(e.target.checked)} />顯示標記
        </label>
        <label>樓層間距<input type="range" min={0.8} max={3} step={0.2} value={gap} onChange={e => setGap(Number(e.target.value))} /></label>
        <span>{markers.filter(m => m.status !== 'inactive').length} 個標記</span>
      </div>
      {!busy && !models.length && <p className="empty">尚未設定樓層模型，請先於「模型管理」建立。</p>}
      <div ref={hostRef} className="plan-stage" />
      <p className="inline-message">
        拖曳旋轉、滾輪縮放、右鍵平移。樓層貼圖取自公開儲存桶 floorplans 的 image_path；
        標記依 plan_markers 的相對座標換算至各層平面。
      </p>
    </section>
  </AppShell>;
}
