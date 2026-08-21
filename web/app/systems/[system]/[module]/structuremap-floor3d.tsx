'use client';

// SYS-06 3D模型圖 = V1 `floor3d.html` 的移植。
//
// 與整合標記系統同樣是全螢幕工具頁，不套 AppShell（V1 自帶 topbar，面板與 HUD 都是
// 絕對定位貼齊視窗邊緣，整層 shell 會把版面擠掉）。但頂列本身要掛上全站共用的六個
// 動作——AGENTS.md 把 floor3d 列為不掛品牌列的工具頁，同一條也寫明「除非使用者明確
// 要求」，2026-08-21 使用者已明確要求比照 3D建模系統。動作定義取自 lib/shared-actions，
// 與 AppShell 共用同一份，兩邊才不會逐漸走鐘。
//
// 3D 算繪沿用既有的 FloorStack3D，不另寫一套 Three.js——SYS-03 的立體巡檢雲臺用的
// 是同一個元件，V1 的 floor3d.html 與 guardpatrol3d.html 正是因為各寫一份而分岔。
// 本檔負責的是 V1 的外圍：載入進度、樓層顯示、立體控制與讀數、標記顯示、深連結。
//
// 兩處刻度換算（V1 以公尺與「倍率」表示，本元件的平面固定為 10×7 場景單位）：
// - 樓層間距滑桿維持 V1 的 1〜20 倍、預設 6 倍、「真實比例」＝1 倍；換算成場景的
//   gap 時乘 GAP_PER_STEP，讓 6 倍對上元件原本的預設值 1.6。
// - 平移滑桿維持 V1 的 ±220 m／±160 m；換算時除以 METERS_PER_UNIT。
// 讀數顯示的仍是 V1 的數字，使用者看到的刻度沒有改變。

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './structuremap-floor3d.css';
import { FloorStack3D, type FloorStackApi, type StackMarker } from './floor-stack-3d';
import { floorOrder } from '@/lib/floor';
import { allowedActions } from '@/lib/shared-actions';
import { computePatrolStatus, PATROL_COLORS, type PatrolState } from '@/lib/patrol-status';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/types/app';

type Props = { profile: Profile };
type FloorModel = { floor_id: string; name: string | null; image_path: string | null; level: number | null };
type MarkerRow = {
  marker_id: string; floor_id: string; x: number; y: number;
  kind: string; label: string | null; color: string | null; status: string | null;
};

const KIND: Record<string, { c: string; n: string }> = {
  equipment: { c: '#00d4ff', n: '設備' },
  space: { c: '#00ff9d', n: '空間' },
  patrol: { c: '#c77dff', n: '巡邏點' },
  repair: { c: '#ff5470', n: '報修點' },
  note: { c: '#ffb300', n: '一般' },
};
const KIND_ORDER = ['equipment', 'space', 'patrol', 'repair', 'note'];

const EXPLODE_MIN = 1, EXPLODE_MAX = 20, EXPLODE_STEP = 0.5, EXPLODE_DEFAULT = 6;
const GAP_PER_STEP = 1.6 / EXPLODE_DEFAULT;   // 6× ↔ FloorStack3D 原本的預設間距 1.6
const METERS_PER_UNIT = 22;                   // V1 的 ±220 m ↔ 場景的 ±10 單位

export function Floor3DBoardModule({ profile }: Props) {
  const [models, setModels] = useState<FloorModel[]>([]);
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  const [patrolStatus, setPatrolStatus] = useState<Map<string, PatrolState>>(new Map());
  const [progress, setProgress] = useState<{ pct: number; msg: string } | null>({ pct: 10, msg: '初始化…' });
  const [loadError, setLoadError] = useState('');

  const [explode, setExplode] = useState(EXPLODE_DEFAULT);
  const [xPan, setXPan] = useState(0);
  const [yPan, setYPan] = useState(0);
  const [visibleFloors, setVisibleFloors] = useState<Record<string, boolean>>({});

  const [showMarkers, setShowMarkers] = useState(true);
  const [visibleKinds, setVisibleKinds] = useState<Record<string, boolean>>(
    () => Object.fromEntries(KIND_ORDER.map(kind => [kind, true])));
  const [showLabels, setShowLabels] = useState(false);

  // 三個面板一律預設收合：進場先看到完整的模型，需要調整時再自行展開。
  const [panelOpen, setPanelOpen] = useState(false);
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [markerPanelOpen, setMarkerPanelOpen] = useState(false);
  const [markerPanelPinned, setMarkerPanelPinned] = useState(false);
  const [focusNotice, setFocusNotice] = useState('');

  const apiRef = useRef<FloorStackApi | null>(null);
  const deepLinkRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setProgress({ pct: 25, msg: '讀取樓層模型…' });
    const client = getSupabase();
    const [modelResult, markerResult] = await Promise.all([
      client.from('floor_models').select('floor_id,name,image_path,level').order('floor_id').limit(200),
      client.from('plan_markers').select('marker_id,floor_id,x,y,kind,label,color,status')
        .eq('status', 'active').limit(5000),
    ]);
    if (modelResult.error) {
      setLoadError('無法讀取樓層模型，請確認資料庫設定與權限。');
      setProgress(null);
      return;
    }
    // 標記查詢失敗不擋畫面：樓層模型仍可檢視，但要說出來，不能只是沒有標記。
    if (markerResult.error) setLoadError('標記載入失敗，畫面只呈現樓層模型。');

    const rows = ((modelResult.data || []) as FloorModel[])
      .filter(row => row.image_path)
      .sort((a, b) => floorOrder(a.floor_id) - floorOrder(b.floor_id));
    setModels(rows);
    setVisibleFloors(Object.fromEntries(rows.map(row => [String(row.floor_id), true])));
    setMarkers((markerResult.data || []) as MarkerRow[]);

    setProgress({ pct: 80, msg: '計算巡邏狀態…' });
    try {
      const result = await computePatrolStatus(client);
      setPatrolStatus(result.map);
    } catch { /* patrol_shifts 尚未建表時圖釘維持原色 */ }

    setProgress({ pct: 100, msg: '完成' });
    window.setTimeout(() => setProgress(null), 400);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const stackMarkers: StackMarker[] = useMemo(() => markers.map(marker => ({
    id: String(marker.marker_id),
    floor_id: String(marker.floor_id),
    x: Number(marker.x) || 0,
    y: Number(marker.y) || 0,
    // 巡邏點依當班打卡狀態著色，其餘沿用標記自訂色或類型色。
    color: marker.kind === 'patrol' && patrolStatus.has(String(marker.marker_id))
      ? PATROL_COLORS[patrolStatus.get(String(marker.marker_id))!]
      : String(marker.color || KIND[String(marker.kind)]?.c || KIND.note.c),
    kind: String(marker.kind),
    label: String(marker.label || ''),
  })), [markers, patrolStatus]);

  // 深連結 ?marker=：模型與標記都就緒後才跳，並確保該樓層是顯示狀態。
  useEffect(() => {
    if (deepLinkRef.current === 'done' || !models.length || !markers.length) return;
    const id = new URLSearchParams(location.search).get('marker');
    if (!id) { deepLinkRef.current = 'done'; return; }
    const target = markers.find(marker => String(marker.marker_id) === id);
    if (!target) { deepLinkRef.current = 'done'; return; }
    deepLinkRef.current = 'done';
    setVisibleFloors(prev => ({ ...prev, [String(target.floor_id)]: true }));
    setFocusNotice(`3D 點位：${target.label || target.marker_id}（${target.floor_id}）`);
    // 等場景依新的可見樓層重建之後再移動鏡頭。
    window.setTimeout(() => { apiRef.current?.focusMarker(id); }, 600);
  }, [models, markers]);

  const shownFloors = models.filter(row => visibleFloors[String(row.floor_id)] !== false);
  const floorsShown = shownFloors.length;

  // HUD 標示的是「現在看到的是哪一層」，不是數量——數量右側面板已經有了。
  // 單層時給全名（B1 地下一層），多層時只給代號免得撐爆，全開就直接說全部。
  // 由上而下列出，與樓層面板的排列一致。
  const shownFloorText = !models.length ? '—'
    : floorsShown === 0 ? '未選取任何樓層'
    : floorsShown === 1 ? (shownFloors[0].name || String(shownFloors[0].floor_id))
    : floorsShown === models.length ? `全部 ${models.length} 層`
    : shownFloors.slice().reverse().map(row => String(row.floor_id)).join('、');

  const resetControls = () => { setExplode(EXPLODE_DEFAULT); setXPan(0); setYPan(0); apiRef.current?.resetView(); };

  return <div className="f3-root">
    {progress && <div className="f3-loading">
      <div className="ld-t">載入 3D 樓層模型…</div>
      <div className="ld-bar"><div className="ld-fill" style={{ width: `${progress.pct}%` }} /></div>
      <div className="ld-m">{progress.msg}</div>
    </div>}

    <div className="f3-topbar">
      <span className="tb-logo">臺北農產公司 第一果菜市場</span>
      <span className="tb-sep" />
      <span className="tb-title">3D 模型圖</span>
      {/* 依帳號可用的系統過濾，與 AppShell 同一份定義、同一個順序。 */}
      <nav className="tb-nav" aria-label="共用系統導覽">
        {allowedActions(profile.allowed_systems).map(item =>
          <a key={item.href} href={`/Inspection/v2${item.href}`}>
            <img src={item.icon} alt="" /><span>{item.label}</span>
          </a>)}
      </nav>
      <span className="tb-space" />
      <a className="tb-back" href="/Inspection/v2/systems/structuremap/floor3d/">3D模型圖</a>
      <a className="tb-back" href="/Inspection/v2/systems/structuremap/floor2d/">平面模型圖</a>
      <a className="tb-back" href="/Inspection/v2/systems/guardpatrol/map3d/">立體巡檢雲臺</a>
    </div>

    <div className="f3-stage">
      {models.length > 0 && <FloorStack3D
        models={models as never}
        markers={stackMarkers}
        showMarkers={showMarkers}
        gap={explode * GAP_PER_STEP}
        xPan={xPan / METERS_PER_UNIT}
        yPan={yPan / METERS_PER_UNIT}
        visibleKinds={visibleKinds}
        showLabels={showLabels}
        visibleFloors={visibleFloors}
        apiRef={apiRef}
      />}
      {!progress && !models.length && <p className="f3-empty">
        {loadError || '尚未建立任何樓層模型。請先於「3D建模系統」上傳 DXF 產生平面與立體模型。'}
      </p>}
    </div>

    {loadError && models.length > 0 && <div className="f3-error">{loadError}</div>}
    {focusNotice && <div className="f3-focus">
      {focusNotice}
      <button onClick={() => setFocusNotice('')} aria-label="關閉">✕</button>
    </div>}

    {/* 底部右側：操作說明與目前顯示的樓層，對應 V1 的 #bottomRightRow。
        操作說明**沒有**照抄 V1 的文案。V1 是自寫的控制（左鍵平移、右鍵旋轉），
        本元件用的是 three.js 內建 OrbitControls 且未覆寫 mouseButtons，預設剛好
        相反：左鍵旋轉、右鍵平移。照抄會變成把人指向錯誤的操作方式。 */}
    <div className="f3-bottomright">
      <div className="f3-hint">左鍵拖曳：旋轉環繞　｜　右鍵拖曳：平移　｜　滾輪／雙指：縮放</div>
      <div className="f3-hud">
        <div className="h-t">3D 模型圖</div>
        <div className="h-r">顯示樓層：<span>{shownFloorText}</span></div>
      </div>
    </div>

    {!panelOpen && <button className="f3-toggle ctrl" onClick={() => setPanelOpen(true)}>立體控制</button>}
    {!floorsOpen && <button className="f3-toggle floors" onClick={() => setFloorsOpen(true)}>樓層顯示</button>}
    {!markerPanelOpen && <button className="f3-toggle marks" onClick={() => setMarkerPanelOpen(true)}>標記顯示</button>}

    {floorsOpen && <div className="f3-floors">
      <div className="panel-head">
        <span className="p-t">樓層顯示</span>
        <button className="panel-close" onClick={() => setFloorsOpen(false)}>隱藏</button>
      </div>
      {/* 由上而下排列，與實際樓層高低一致 */}
      {models.slice().reverse().map(row => {
        const id = String(row.floor_id);
        const on = visibleFloors[id] !== false;
        return <button key={id} className={`fbtn${on ? ' on' : ''}`}
          onClick={() => setVisibleFloors(prev => ({ ...prev, [id]: !on }))} aria-pressed={on}>
          <span className="dot" />{row.name || id}
        </button>;
      })}
      <div className="f3-floors-count">顯示 {floorsShown}／{models.length} 層</div>
    </div>}

    {panelOpen && <div className="f3-panel">
      <div className="panel-head">
        <span className="p-t">立體控制</span>
        <button className="panel-close" onClick={() => setPanelOpen(false)}>隱藏</button>
      </div>
      <label htmlFor="f3-explode">樓層間距（視覺）</label>
      <input id="f3-explode" type="range" min={EXPLODE_MIN} max={EXPLODE_MAX} step={EXPLODE_STEP}
        value={explode} onChange={event => setExplode(Number(event.target.value))} />
      <label htmlFor="f3-xpan">水平平移（左右）</label>
      <input id="f3-xpan" type="range" min={-220} max={220} step={2}
        value={xPan} onChange={event => setXPan(Number(event.target.value))} />
      <label htmlFor="f3-ypan">Y 軸平移（上下）</label>
      <input id="f3-ypan" type="range" min={-160} max={160} step={2}
        value={yPan} onChange={event => setYPan(Number(event.target.value))} />
      <div className="h-r">實際樓高：<span>4000 mm（固定）</span></div>
      <div className="h-r">放大倍率：<span>{explode % 1 ? explode.toFixed(1) : explode}×</span></div>
      <div className="h-r">水平位置：<span>{xPan} m</span></div>
      <div className="h-r">Y 軸位置：<span>{yPan} m</span></div>
      <div className="btnrow">
        <button className="mini" onClick={resetControls}>⊡ 重置</button>
        <button className="mini" onClick={() => apiRef.current?.topView()}>⊤ 俯視</button>
        <button className="mini" onClick={() => setExplode(1)}>真實比例</button>
      </div>
    </div>}

    {markerPanelOpen && <div className="f3-mkpanel">
      <div className="panel-head">
        <span className="p-t">標記顯示</span>
        <span className="head-acts">
          <button className={`panel-close${markerPanelPinned ? ' on' : ''}`}
            title="釘住後點空白處不會收起"
            onClick={() => setMarkerPanelPinned(pinned => !pinned)}>
            {markerPanelPinned ? '📌 已釘住' : '📌 釘住'}
          </button>
          <button className="panel-close" onClick={() => { setMarkerPanelOpen(false); setMarkerPanelPinned(false); }}>隱藏</button>
        </span>
      </div>
      <label className="chk all">
        <input type="checkbox" checked={showMarkers}
          onChange={event => setShowMarkers(event.target.checked)} />所有標記
      </label>
      {/* 類型色以自訂屬性傳給 CSS，淺色主題才有機會把霓虹色壓深到可讀。 */}
      {KIND_ORDER.map(kind => <label key={kind} className="chk kind"
        style={{ '--kind-color': KIND[kind].c } as React.CSSProperties}>
        <input type="checkbox" disabled={!showMarkers} checked={visibleKinds[kind] !== false}
          onChange={event => setVisibleKinds(prev => ({ ...prev, [kind]: event.target.checked }))} />
        {KIND[kind].n}
      </label>)}
      <label className="chk labels">
        <input type="checkbox" disabled={!showMarkers} checked={showLabels}
          onChange={event => setShowLabels(event.target.checked)} />文字標籤
      </label>
    </div>}
  </div>;
}
