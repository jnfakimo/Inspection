'use client';

// SYS-06 的兩個檢視器：2D 平面樓層圖（OpenSeadragon）與 3D 立體樓層（Three.js）。
//
// 貼圖來源統一為私有儲存桶 floorplans 的短效 signed URL（由 floor_models.image_path
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
import './structuremap-pin.css';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { errorMessage, fmt, type Row } from '@/components/admin/shared';
import { canonicalFloor } from '@/lib/floor';
import { floorOrder, floorTextureUrl, preparePlanObjectUrl } from './floor-stack-3d';
import { signFloorplanPaths } from '@/lib/floorplan-storage';
import { STRUCTUREMAP_ROUTES } from '@/lib/structuremap-routes';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import { StructuremapTopbarActions } from './structuremap-topbar-actions';

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
    const sorted = (m.data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }))
      .sort((a, b) => floorOrder(String(a.floor_id)) - floorOrder(String(b.floor_id)));
    let signed = new Map<string, string>();
    try {
      signed = await signFloorplanPaths(sorted.map(row => String(row.image_path || '')), client);
    } catch (error) {
      setNote(`失敗：${errorMessage(error, '樓層圖連結產生失敗')}`);
    }
    const secured = sorted
      .map(row => ({ ...row, image_url: signed.get(String(row.image_path || '')) || '' }))
      .filter(row => row.image_url);
    if (secured.length < sorted.length && sorted.length) {
      setNote('部分樓層圖連結無法產生，畫面僅呈現可授權的樓層。');
    }
    setModels(secured);
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
  // ?kind=patrol：從駐衛警巡檢的立體巡檢雲臺跳過來時只看巡檢點。不另外複製一份
  // 頁面，也不改預設——直接進本頁仍是全部類型都顯示。
  const [visibleKinds, setVisibleKinds] = useState<Record<string, boolean>>(() => {
    // 只認得的類型才套用，理由同 3D 模型圖：給了不存在的值會全部關掉變成空圖。
    const raw = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('kind');
    const only = raw && MARKER_KIND[raw] ? raw : null;
    return Object.fromEntries(Object.keys(MARKER_KIND).map(kind => [kind, only ? kind === only : true]));
  });
  // 與 3D 模型圖同名同語意的開關：關閉時標籤只在滑過圖釘時浮現。
  const [showLabels, setShowLabels] = useState(false);
  // 同上：篩選由網址參數帶入，標記面板預設收合，必須主動說明。
  const [kindNotice, setKindNotice] = useState(() => {
    const only = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('kind');
    return only && MARKER_KIND[only] ? `已套用篩選：只顯示「${MARKER_KIND[only]}」，其餘標記類型已隱藏` : '';
  });
  const [placing, setPlacing] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  // 三個面板一律預設收合，與 3D 模型圖相同：進場先看到完整圖面。
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [kindsOpen, setKindsOpen] = useState(false);
  const [placePanelOpen, setPlacePanelOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  // OpenSeadragon 的命名空間。**不可以改回 window.OpenSeadragon**：它是 UMD 包裝，
  // 在打包環境走 module.exports 分支，根本不會掛上全域，取 .Point 會丟 TypeError。
  const osdRef = useRef<any>(null);
  const overlayRef = useRef<Map<string, HTMLElement>>(new Map());
  // 淺色主題重畫後的 blob 網址，換樓層與卸載時要釋放。
  const planUrlRef = useRef<string | null>(null);
  // 主題決定線稿要不要重畫成黑線，而那是在開圖當下決定的。必須跟著 data-theme
  // 變動重開，否則切換主題後圖面停在舊主題直到重新整理（與 FloorStack3D 同一個坑）。
  const [theme, setTheme] = useState(() =>
    (typeof document === 'undefined' ? 'light' : document.documentElement.getAttribute('data-theme')) || 'light');
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.getAttribute('data-theme') || 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // viewer 是非同步建立的。覆蓋層與定位這兩個 effect 都要等它就緒才掛得上去——
  // 用 state 而非 ref 才會觸發重跑，否則它們在首次載入時 early return 之後就再也
  // 不會執行，'open' 監聽根本沒註冊，圖面永遠是空的。
  const [viewerReady, setViewerReady] = useState(false);

  useEffect(() => { if (!floor && models.length) setFloor(String(models[0].floor_id)); }, [models, floor]);
  const model = useMemo(() => models.find(m => String(m.floor_id) === floor), [models, floor]);
  const visible = useMemo(() => (showMarkers ? markers.filter(m =>
    String(m.floor_id) === floor && visibleKinds[String(m.kind)] !== false) : []),
    [markers, floor, visibleKinds, showMarkers]);

  // 建立／切換 OpenSeadragon。函式庫以動態 import 載入。
  useEffect(() => {
    let disposed = false;
    const url = textureUrl(model?.image_url);
    if (!hostRef.current || !url) return;
    (async () => {
      const OpenSeadragon = (await import('openseadragon')).default;
      if (disposed || !hostRef.current) return;
      osdRef.current = OpenSeadragon;
      if (!viewerRef.current) {
        // 縮圖的底色／框線／視窗框由 OSD 在建構時寫成行內樣式，CSS 蓋不掉，只能由選項給。
        // 直接讀主題 token，跟頁面共用同一組值，日後改 token 這裡自動跟著變。
        const token = (name: string, fallback: string) =>
          getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
        viewerRef.current = OpenSeadragon({
          element: hostRef.current, prefixUrl: '',
          showNavigationControl: false, showNavigator: true, navigatorPosition: 'BOTTOM_LEFT',
          navigatorAutoFade: false,
          navigatorBackground: token('--bg', '#020b18'),
          navigatorBorderColor: token('--line', '#173952'),
          navigatorDisplayRegionColor: token('--cyan', '#00d4ff'),
          minZoomLevel: 0.2, maxZoomPixelRatio: 4, zoomPerScroll: 1.3,
          animationTime: 0.5, springStiffness: 7,
          panHorizontal: true, panVertical: true, constrainDuringPan: false,
          visibilityRatio: 0, crossOriginPolicy: 'Anonymous',
          // flick 屬於手勢設定，不是頂層選項（V1 寫在頂層其實不會生效）。
          gestureSettingsMouse: { flickEnabled: true, flickMomentum: 0.4 },
        });
      }

      // 縮圖的顏色是建構時寫成行內樣式的，切換主題不會自己更新；這裡補寫一次。
      const navigator = viewerRef.current?.navigator?.element as HTMLElement | undefined;
      if (navigator) {
        const token = (name: string, fallback: string) =>
          getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
        navigator.style.background = token('--bg', '#020b18');
        navigator.style.borderColor = token('--line', '#173952');
      }

      // 兩種主題都要預處理，與 3D 模型圖共用同一份 preparePlanCanvas：
      // 淺色把線條重畫成黑線，科技版保留原色但濾掉光暈——光暈是 renderNeon 疊出來的，
      // 不濾掉會讓科技版的線看起來比一般版粗一截。
      let source = url;
      const prepared = await preparePlanObjectUrl(url, theme === 'light' ? 'light' : 'tech');
      if (disposed) { if (prepared) URL.revokeObjectURL(prepared); return; }
      if (prepared) source = prepared;

      overlayRef.current.clear();
      viewerRef.current.open({ type: 'image', url: source });
      setViewerReady(true);

      // 換樓層時才釋放上一張，不在 cleanup 釋放——cleanup 跑在新圖開啟之前，
      // 提早 revoke 會讓還沒解碼完的那張變成空白。
      if (planUrlRef.current && planUrlRef.current !== source) URL.revokeObjectURL(planUrlRef.current);
      planUrlRef.current = source.startsWith('blob:') ? source : null;
    })();
    return () => { disposed = true; };
  }, [model, theme]);

  // 銷毀 viewer 並釋放重畫後的 blob（僅在元件卸載時）。
  useEffect(() => () => {
    try { viewerRef.current?.destroy(); } catch { /* 忽略 */ }
    viewerRef.current = null;
    if (planUrlRef.current) { URL.revokeObjectURL(planUrlRef.current); planUrlRef.current = null; }
  }, []);

  // 依 marker 清單重建覆蓋層。plan_markers 的 x／y 為 0–1 的相對座標。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const attach = () => {
      const OSD = osdRef.current;
      overlayRef.current.forEach(el => { try { viewer.removeOverlay(el); } catch { /* 忽略 */ } });
      overlayRef.current.clear();
      if (!OSD) return; // 函式庫還沒載完；open 事件會再觸發一次
      let failed = 0;
      for (const marker of visible) {
        // 圖釘結構與整合標記系統共用（structuremap-pin.css）：圓點加可切換的文字標籤。
        // 原本只有一顆純色圓點、標籤靠 title 提示，滑過才看得到，也印不出來。
        const el = document.createElement('button');
        el.type = 'button';
        const isOn = String(selected?.marker_id || '') === String(marker.marker_id);
        el.className = `mb-pin${showLabels ? ' show-lab' : ''}${isOn ? ' on' : ''}`;
        const dot = document.createElement('span');
        dot.className = 'mb-pdot';
        dot.style.background = String(marker.color || KIND_COLOR[String(marker.kind)] || '#00d4ff');
        const lead = document.createElement('span');
        lead.className = 'mb-lead';
        const lab = document.createElement('span');
        lab.className = 'mb-plab';
        lab.textContent = String(marker.label || MARKER_KIND[String(marker.kind)] || marker.kind || '');
        el.append(dot, lead, lab);
        el.title = `${marker.label ?? ''}（${MARKER_KIND[String(marker.kind)] || marker.kind}）`;
        el.onclick = event => { event.stopPropagation(); setSelected(marker); };
        try {
          viewer.addOverlay({
            element: el,
            location: new OSD.Point(Number(marker.x) || 0, Number(marker.y) || 0),
            placement: OSD.Placement.CENTER,
          });
          overlayRef.current.set(String(marker.marker_id), el);
        } catch (error) {
          // 先前這裡是空的 catch。當時取的是 window.OpenSeadragon（UMD 在打包環境
          // 不會掛全域），每一顆標記都丟 TypeError 卻被吞掉——圖面從上線起就一顆
          // 標記都沒有，畫面只是「空的」，沒有人會回報成故障。
          failed += 1;
          if (failed === 1) console.error('平面圖標記覆蓋層建立失敗：', error);
        }
      }
      // 一顆都掛不上去代表是系統性問題，要說出來，不能只是留一張空圖。
      if (failed && !overlayRef.current.size) setNote(`失敗：${failed} 個標記無法顯示在圖面上`);
      scheduleLayout();
    };

    // 標籤排版：錯開位置、以引線指回圓點，真的排不下的才讓位。
    //
    // 策略與 3D 模型圖一致（抬高＋引線＋螢幕空間剔除），但這裡做的是**精確矩形碰撞**
    // 而不是 3D 的格子近似：DOM 標籤的螢幕尺寸不隨縮放改變，量得到真實寬高。
    // 候選位置同時包含左右偏移——只往上疊的話，密集區的寬標籤幾乎全部排不下
    // （實測 20 個只放得下 3 個），引線改為可傾斜就能往兩側讓開。
    const LABEL_DY = [-22, -40, -58, -76, -94, -112, -130];
    const LABEL_DX = [0, -78, 78, -156, 156, -234, 234];
    // 先近後遠：垂直位移比水平便宜，標籤盡量留在圓點正上方。
    const CANDIDATES = LABEL_DY.flatMap(dy => LABEL_DX.map(dx => ({ dx, dy })))
      .sort((a, b) => (Math.abs(a.dy) + Math.abs(a.dx) * 0.9) - (Math.abs(b.dy) + Math.abs(b.dx) * 0.9));

    const layoutLabels = () => {
      const pins = [...overlayRef.current.values()] as HTMLElement[];
      if (!pins.length) return;
      for (const pin of pins) {
        pin.style.removeProperty('--lx');
        pin.style.removeProperty('--ly');
        pin.style.removeProperty('--llen');
        pin.style.removeProperty('--lang');
        pin.classList.toggle('show-lab', showLabels);
      }
      if (!showLabels) return;   // 標籤沒開就沒有重疊問題

      // 由上而下、由左而右決定順序：上方的先占位，結果穩定，重畫不會跳來跳去。
      const entries = pins.map(pin => {
        const label = pin.querySelector('.mb-plab') as HTMLElement | null;
        const pinRect = pin.getBoundingClientRect();
        const labelRect = label?.getBoundingClientRect();
        return {
          pin,
          width: labelRect?.width || 0,
          height: labelRect?.height || 0,
          centreX: pinRect.left + pinRect.width / 2,
          top: pinRect.top,
          half: pinRect.height / 2,
        };
      }).filter(entry => entry.width > 0)
        .sort((a, b) => a.top - b.top || a.centreX - b.centreX);

      const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      for (const entry of entries) {
        const fitted = CANDIDATES.find(candidate => {
          const bottom = entry.top + candidate.dy;
          const box = {
            left: entry.centreX + candidate.dx - entry.width / 2,
            right: entry.centreX + candidate.dx + entry.width / 2,
            top: bottom - entry.height,
            bottom,
          };
          const hit = placed.some(other =>
            box.left < other.right && box.right > other.left &&
            box.top < other.bottom && box.bottom > other.top);
          if (!hit) placed.push(box);
          return !hit;
        });
        if (!fitted) {
          // 一個位置都排不下：拿掉 show-lab 讓它回到預設隱藏，滑過去仍看得到。
          entry.pin.classList.remove('show-lab');
          continue;
        }
        // 引線從圓點中心拉到標籤底緣中點。
        const vectorX = fitted.dx;
        const vectorY = fitted.dy - entry.half;
        entry.pin.style.setProperty('--lx', `${fitted.dx}px`);
        entry.pin.style.setProperty('--ly', `${fitted.dy}px`);
        entry.pin.style.setProperty('--llen', `${Math.hypot(vectorX, vectorY)}px`);
        entry.pin.style.setProperty('--lang', `${Math.atan2(vectorY, vectorX) * 180 / Math.PI}deg`);
      }
    };

    let raf = 0;
    const scheduleLayout = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; layoutLabels(); });
    };
    viewer.addHandler('open', attach);
    // 平移與縮放都會改變標籤在畫面上的相對位置，必須重排。animation 每幀都發，
    // 用 rAF 收斂成一幀一次。
    viewer.addHandler('animation', scheduleLayout);
    viewer.addHandler('animation-finish', scheduleLayout);
    viewer.addHandler('resize', scheduleLayout);
    // update-viewport 是保險：attach 之後那一幀 OSD 未必已把覆蓋層放到最終位置，
    // 只靠 attach 觸發的那次 rAF 有機會量到還沒定位的座標。
    viewer.addHandler('update-viewport', scheduleLayout);
    attach();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      try {
        viewer.removeHandler('open', attach);
        viewer.removeHandler('animation', scheduleLayout);
        viewer.removeHandler('animation-finish', scheduleLayout);
        viewer.removeHandler('resize', scheduleLayout);
        viewer.removeHandler('update-viewport', scheduleLayout);
      } catch { /* 忽略 */ }
    };
  }, [visible, showLabels, selected, setNote, viewerReady]);

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
  }, [placing, selected, setNote, reload, viewerReady]);

  const shownFloor = model ? String(model.name || model.floor_id) : '—';
  const noteIsError = note.startsWith('失敗');

  return <div className="f3-root">
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
      <StructuremapTopbarActions planeHref={STRUCTUREMAP_ROUTES.floor3d} />
    </div>

    {/* OSD 自己會在 host 裡增刪節點，所以空狀態訊息放在 host 外面、由 .f3-stage 承載。 */}
    <div className="f3-stage">
      <div ref={hostRef} className="f2-osd" />
      {!model && !busy && <p className="f3-empty">
        這個樓層尚未建立平面圖，請先至「圖資專案設定」更新該樓層圖資。
      </p>}
    </div>

    {note && <div className={`f3-error${noteIsError ? '' : ' ok'}`}>{note}</div>}

    {kindNotice && !placing && <div className="f3-focus">
      {kindNotice}
      <button onClick={() => setKindNotice('')} aria-label="關閉">✕</button>
    </div>}

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
      <label className="chk labels">
        <input type="checkbox" disabled={!showMarkers} checked={showLabels}
          onChange={event => setShowLabels(event.target.checked)} />文字標籤
      </label>
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
