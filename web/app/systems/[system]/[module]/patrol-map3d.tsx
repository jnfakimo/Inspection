'use client';

// SYS-03 立體巡檢雲臺。
//
// 2026-08-21 依 AGENTS.md「圖資頁面的共同規範」改為全螢幕工具頁：外殼沿用
// structuremap-floor3d.css 的 .f3-* 類別（頂列含共用的六個動作、圖面滿版、控制項
// 收進三個可收合的浮動面板、底部右側說明與 HUD）。原本套 AppShell ＋ 後台面板版型，
// 立體場景被壓在卡片裡，與同樣用 FloorStack3D 的 3D 模型圖看起來像兩個系統。
//
// 3D 算繪沿用 FloorStack3D，不另寫一套——與 3D 模型圖是同一個元件，這正是 V1 的
// floor3d.html 與 guardpatrol3d.html 各寫一份之後分岔的教訓。
//
// 與 3D 模型圖的差別只在資料：這裡只顯示巡邏點，並依「當日是否打卡」著色，
// 綠色已打卡、紅色未打卡。

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './structuremap-floor3d.css';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { getSupabase } from '@/lib/supabase';
import { signFloorplanPaths } from '@/lib/floorplan-storage';
import { STRUCTUREMAP_ROUTES } from '@/lib/structuremap-routes';
import { errorMessage, type Row } from '@/components/admin/shared';
import { allowedActions } from '@/lib/shared-actions';
import { canonicalFloor } from '@/lib/floor';
import { FloorStack3D, floorOrder, type FloorStackApi, type StackMarker } from './floor-stack-3d';
import type { ModuleDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { module: ModuleDefinition; profile: Profile };

const CHECKED_COLOR = '#00ff9d';
const UNCHECKED_COLOR = '#ff3b3b';

// 樓層間距沿用 3D 模型圖的刻度：1〜20 倍、預設 6 倍，換算成 FloorStack3D 的 gap。
const GAP_MIN = 1, GAP_MAX = 20, GAP_STEP = 0.5, GAP_DEFAULT = 6;
const GAP_PER_STEP = 1.6 / GAP_DEFAULT;

function taipeiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function PatrolMap3DModule({ module, profile }: Props) {
  const [models, setModels] = useState<Row[]>([]);
  const [points, setPoints] = useState<Row[]>([]);
  const [checkins, setCheckins] = useState<Row[]>([]);
  const [date, setDate] = useState(taipeiToday());
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');

  const [explode, setExplode] = useState(GAP_DEFAULT);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [visibleFloors, setVisibleFloors] = useState<Record<string, boolean>>({});

  // 三個面板一律預設收合，與 3D 模型圖相同：進場先看到完整場景。
  const [ctrlOpen, setCtrlOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [floorsOpen, setFloorsOpen] = useState(false);

  const apiRef = useRef<FloorStackApi | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [m, p, c] = await Promise.all([
      client.from('floor_models').select('floor_id,name,image_path,level').order('floor_id').limit(200),
      client.from('plan_markers').select('marker_id,floor_id,label,x,y,status').eq('kind', 'patrol').limit(5000),
      client.from('checkin_logs').select('checkin_id,target_id,label,floor_id,user_name,checkin_at')
        .gte('checkin_at', `${date}T00:00:00+08:00`).lte('checkin_at', `${date}T23:59:59+08:00`).limit(5000),
    ]);
    if (m.error || p.error || c.error) setNote(`失敗：${errorMessage(m.error || p.error || c.error, '立體巡檢資料載入失敗')}`);
    const sourceRows = (m.data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }))
      .sort((a, b) => floorOrder(String(a.floor_id)) - floorOrder(String(b.floor_id)));
    let signed = new Map<string, string>();
    try {
      signed = await signFloorplanPaths(sourceRows.map(row => String(row.image_path || '')), client);
    } catch (error) {
      setNote(`失敗：${errorMessage(error, '樓層圖連結產生失敗')}`);
    }
    const sorted = sourceRows
      .map(row => ({ ...row, image_url: signed.get(String(row.image_path || '')) || '' }))
      .filter(row => row.image_url);
    setModels(sorted);
    setVisibleFloors(Object.fromEntries(sorted.map(row => [String(row.floor_id), true])));
    setPoints((p.data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) })));
    setCheckins((c.data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }))); setBusy(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const checkedIds = useMemo(() => {
    const set = new Set<string>();
    for (const row of checkins) {
      if (row.target_id) set.add(String(row.target_id));
      set.add(`${row.floor_id}|${row.label}`);
    }
    return set;
  }, [checkins]);
  const isChecked = useCallback((point: Row) =>
    checkedIds.has(String(point.marker_id)) || checkedIds.has(`${point.floor_id}|${point.label}`), [checkedIds]);

  const active = useMemo(() => points.filter(p => p.status !== 'inactive'), [points]);
  const stackMarkers: StackMarker[] = useMemo(() => active.map(point => ({
    id: String(point.marker_id), floor_id: String(point.floor_id),
    x: Number(point.x) || 0, y: Number(point.y) || 0,
    color: isChecked(point) ? CHECKED_COLOR : UNCHECKED_COLOR,
    kind: 'patrol',
    label: String(point.label || ''),
  })), [active, isChecked]);

  const done = active.filter(isChecked).length;
  const shownFloors = models.filter(row => visibleFloors[String(row.floor_id)] !== false);
  const floorsShown = shownFloors.length;
  // HUD 標的是「現在看到哪幾層」，數量右側面板已經有了。
  const shownFloorText = !models.length ? '—'
    : floorsShown === 0 ? '未選取任何樓層'
    : floorsShown === 1 ? String(shownFloors[0].name || shownFloors[0].floor_id)
    : floorsShown === models.length ? `全部 ${models.length} 層`
    : shownFloors.slice().reverse().map(row => String(row.floor_id)).join('、');

  const resetView = () => { setExplode(GAP_DEFAULT); apiRef.current?.resetView(); };

  return <div className="f3-root">
    {busy && <div className="f3-loading">
      <div className="ld-t">載入立體巡檢雲臺…</div>
      <div className="ld-bar"><div className="ld-fill" style={{ width: '70%' }} /></div>
      <div className="ld-m">讀取樓層模型、巡邏點與當日打卡…</div>
    </div>}

    <div className="f3-topbar">
      <span className="tb-logo">臺北農產公司 第一果菜市場</span>
      <span className="tb-sep" />
      <span className="tb-title">{module.title}</span>
      {/* 與 AppShell、模型圖同一份定義（lib/shared-actions），依帳號可用的系統過濾。 */}
      <nav className="tb-nav" aria-label="共用系統導覽">
        {allowedActions(profile.allowed_systems).map(item =>
          <a key={item.href} href={`/Inspection/v2${item.href}`}>
            <img src={item.icon} alt="" /><span>{item.label}</span>
          </a>)}
      </nav>
      <span className="tb-space" />
      {/* 帶 ?kind=patrol：從駐衛警巡檢跳過去只看巡邏點，不摻雜設備、報修、空間等標記。 */}
      <a className="tb-back" href={`${STRUCTUREMAP_ROUTES.floor3d}?kind=patrol`}>3D模型圖</a>
      <a className="tb-back" href={`${STRUCTUREMAP_ROUTES.floor2d}?kind=patrol`}>平面樓層圖</a>
      <a className="tb-back" href={STRUCTUREMAP_ROUTES.project}>圖資專案設定</a>
    </div>

    <div className="f3-stage">
      {models.length > 0 && <FloorStack3D
        models={models as never}
        markers={stackMarkers}
        showMarkers={showMarkers}
        showLabels={showLabels}
        visibleFloors={visibleFloors}
        gap={explode * GAP_PER_STEP}
        apiRef={apiRef}
      />}
      {!busy && !models.length && <p className="f3-empty">
        尚未設定樓層圖資，請至「圖資專案設定」由 3D 建模系統建立。
      </p>}
    </div>

    {note && <div className="f3-error">{note}</div>}

    {!ctrlOpen && <button className="f3-toggle ctrl" onClick={() => setCtrlOpen(true)}>立體控制</button>}
    {!pointsOpen && <button className="f3-toggle marks" onClick={() => setPointsOpen(true)}>巡檢點顯示</button>}
    {!floorsOpen && <button className="f3-toggle floors" onClick={() => setFloorsOpen(true)}>樓層顯示</button>}

    {floorsOpen && <div className="f3-floors">
      <div className="panel-head">
        <span className="p-t">樓層顯示</span>
        <button className="panel-close" onClick={() => setFloorsOpen(false)}>隱藏</button>
      </div>
      {/* 由上而下排列，與實際樓層高低一致。 */}
      {models.slice().reverse().map(row => {
        const id = String(row.floor_id);
        const on = visibleFloors[id] !== false;
        return <button key={id} className={`fbtn${on ? ' on' : ''}`} aria-pressed={on}
          onClick={() => setVisibleFloors(current => ({ ...current, [id]: !on }))}>
          <span className="dot" />{String(row.name || id)}
        </button>;
      })}
      <div className="f3-floors-count">顯示 {floorsShown}／{models.length} 層</div>
    </div>}

    {pointsOpen && <div className="f3-mkpanel">
      <div className="panel-head">
        <span className="p-t">巡檢點顯示</span>
        <button className="panel-close" onClick={() => setPointsOpen(false)}>隱藏</button>
      </div>
      <label htmlFor="p3-date">巡檢日期</label>
      <LocalizedDateInput id="p3-date" aria-label="巡檢日期（年/月/日）"
        value={date} onChange={event => setDate(event.target.value)} />
      <label className="chk all">
        <input type="checkbox" checked={showMarkers}
          onChange={event => setShowMarkers(event.target.checked)} />顯示巡檢點
      </label>
      <label className="chk labels">
        <input type="checkbox" disabled={!showMarkers} checked={showLabels}
          onChange={event => setShowLabels(event.target.checked)} />文字標籤
      </label>
      {/* 圖例用與圖面相同的兩個顏色，不另外挑色，避免說明與畫面對不上。 */}
      <div className="chk kind legend" style={{ '--kind-color': CHECKED_COLOR } as React.CSSProperties}>
        <span className="legend-dot" />已打卡 {done}
      </div>
      <div className="chk kind legend" style={{ '--kind-color': UNCHECKED_COLOR } as React.CSSProperties}>
        <span className="legend-dot" />未打卡 {active.length - done}
      </div>
    </div>}

    {ctrlOpen && <div className="f3-panel">
      <div className="panel-head">
        <span className="p-t">立體控制</span>
        <button className="panel-close" onClick={() => setCtrlOpen(false)}>隱藏</button>
      </div>
      <label htmlFor="p3-gap">樓層間距（視覺）</label>
      <input id="p3-gap" type="range" min={GAP_MIN} max={GAP_MAX} step={GAP_STEP}
        value={explode} onChange={event => setExplode(Number(event.target.value))} />
      <div className="h-r">放大倍率：<span>{explode % 1 ? explode.toFixed(1) : explode}×</span></div>
      <div className="btnrow">
        <button className="mini" onClick={resetView}>⊡ 重置</button>
        <button className="mini" onClick={() => apiRef.current?.topView()}>⊤ 俯視</button>
        <button className="mini" onClick={() => setExplode(1)}>真實比例</button>
      </div>
      <p className="f2-note">
        巡檢點座標取自 plan_markers（kind=patrol），維護請至圖臺系統的「整合標記」。
      </p>
    </div>}

    {/* 操作說明依 FloorStack3D 實際的 OrbitControls 預設鍵位寫，與 3D 模型圖同一句。 */}
    <div className="f3-bottomright">
      <div className="f3-hint">左鍵拖曳：旋轉環繞　｜　右鍵拖曳：平移　｜　滾輪／雙指：縮放</div>
      <div className="f3-hud">
        <div className="h-t">{module.title}</div>
        <div className="h-r">顯示樓層：<span>{shownFloorText}</span></div>
        <div className="h-r">當日打卡：<span>{done}／{active.length}</span></div>
      </div>
    </div>
  </div>;
}
