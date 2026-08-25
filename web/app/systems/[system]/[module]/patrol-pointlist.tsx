'use client';

// SYS-03 巡邏點清單 = V1 `patrollist.html` 的移植。版型與功能對齊 V1：
// 統計卡（涵蓋樓層數／巡邏點總數）→ 工具列 → 樓層分組摺疊清單 → QR 視窗。
// 這一頁是唯讀彙總，巡邏點的新增與座標調整屬設備圖臺的整合標記模組。
//
// 與 V1 的差異兩處，都不是版面調整：
// 1. 「列印全部 QR」改成頁內的列印區塊加 @media print，不再 window.open + document.write。
//    資安稽核對文件字串輸出的建議就是改用 React 列印區塊；順帶免除彈出視窗被瀏覽器
//    擋下的情況（V1 遇到就只能跳 alert 要使用者放行）。
// 2. QR 改用 qrcode-generator 的動態 import，與站內其餘 QR 產生一致。
//
// 註：V2 先前的版本是一張帶「當日打卡」欄位與日期篩選的表格。那個視角在同系統的
// 「巡邏打卡」模組已經有了，改回 V1 的唯讀彙總不會少掉能力。

import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/app/admin-workspace.css';
import './v1-listpage.css';
import './patrol-pointlist.css';
import { AppShell } from '@/components/AppShell';
import { LEGACY_BASE } from '@/lib/config';
import { canonicalFloor, floorOrder } from '@/lib/floor';
import { getSupabase } from '@/lib/supabase';
import type { ModuleDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { module: ModuleDefinition; profile: Profile };
type Point = { marker_id: string; floor_id: string; label: string; note: string | null };
type PrintTag = { markerId: string; label: string; floor: string; image: string };

/** 與 V1 的 translateError 逐條對齊。 */
function translateError(error: unknown) {
  const message = error instanceof Error ? error.message
    : (typeof error === 'object' && error !== null && 'message' in error)
      ? String((error as Record<string, unknown>).message) : String(error || '');
  if (!message) return '未知錯誤';
  if (message.includes('relation') && message.includes('does not exist')) return '資料表不存在，請確認資料庫設定';
  if (/permission denied|violates row-level security/.test(message)) return '無操作權限';
  if (message.includes('JWT expired')) return '登入已過期，請重新整理頁面';
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return '網路連線失敗，請稍後再試';
  return '操作失敗，請稍後再試或聯絡系統管理員';
}
function isNetworkError(error: unknown) {
  const message = (typeof error === 'object' && error !== null && 'message' in error)
    ? String((error as Record<string, unknown>).message) : String(error || '');
  return /Failed to fetch|NetworkError|Load failed/i.test(message);
}

/** V1 的 fmtTime：只顯示到分，不含年份。 */
function fmtTime(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const wait = (ms: number) => new Promise(resolve => { window.setTimeout(resolve, ms); });

// 與現場已張貼的標籤同一組網址：簽到頁仍在 V1，改成 V2 網址會讓舊標籤指向別處。
const checkinUrl = (markerId: string) =>
  `${location.origin}${LEGACY_BASE}/patrolcheckin.html?marker=${encodeURIComponent(markerId)}`;

async function qrDataUrl(text: string, cellSize: number) {
  const qrcode = (await import('qrcode-generator')).default;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, 8);
}

export function PointListModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Point[]>([]);
  const [lastCheckin, setLastCheckin] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState('巡邏點資料載入中…');
  const [failed, setFailed] = useState(false);

  const [floorFilter, setFloorFilter] = useState('');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [qr, setQr] = useState<{ label: string; floor: string; image: string } | null>(null);
  const [printTags, setPrintTags] = useState<PrintTag[] | null>(null);

  const load = useCallback(async (attempt = 0) => {
    setFailed(false);
    setStatus(attempt ? '網路連線不穩定，正在重新載入…' : '巡邏點資料載入中…');
    const client = getSupabase();
    const [markerResult, checkinResult] = await Promise.all([
      client.from('plan_markers').select('marker_id,floor_id,label,note')
        .eq('kind', 'patrol').eq('status', 'active').order('floor_id').order('label'),
      client.from('checkin_logs').select('target_id,checkin_at')
        .eq('target_type', 'marker').order('checkin_at', { ascending: false }).limit(1000),
    ]);
    const failure = markerResult.error || checkinResult.error;
    if (failure) {
      // 連線類錯誤自動重試兩次，與 V1 相同；其餘錯誤直接呈現並提供重新載入。
      if (isNetworkError(failure) && attempt < 2) { await wait(1500); return load(attempt + 1); }
      setFailed(true);
      setStatus(`讀取失敗：${translateError(failure)}`);
      return;
    }
    const points = (markerResult.data || []).map(row => ({
      ...(row as Point), floor_id: canonicalFloor(row.floor_id),
    })) as Point[];
    const checkins = new Map<string, string>();
    // 已依 checkin_at 遞減排序，同一巡邏點的第一筆即最近一次。
    (checkinResult.data || []).forEach(row => {
      const id = String(row.target_id || '');
      if (id && !checkins.has(id)) checkins.set(id, String(row.checkin_at));
    });
    setRows(points);
    setLastCheckin(checkins);
    setStatus('');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const floorsSorted = useMemo(
    () => [...new Set(rows.map(row => row.floor_id))].sort((a, b) => floorOrder(a) - floorOrder(b)),
    [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(row =>
      (!floorFilter || row.floor_id === floorFilter)
      && (!q || (row.label || '').toLowerCase().includes(q) || (row.note || '').toLowerCase().includes(q)));
  }, [rows, floorFilter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Point[]>();
    filtered.forEach(row => {
      if (!map.has(row.floor_id)) map.set(row.floor_id, []);
      map.get(row.floor_id)!.push(row);
    });
    return [...map.entries()]
      .sort((a, b) => floorOrder(a[0]) - floorOrder(b[0]))
      .map(([floor, items]) => [floor, items.slice()
        .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'zh-Hant'))] as const);
  }, [filtered]);

  const toggleFloor = (floor: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(floor)) next.delete(floor); else next.add(floor);
    return next;
  });

  const openQr = async (point: Point) => {
    try {
      setQr({ label: point.label, floor: point.floor_id, image: await qrDataUrl(checkinUrl(point.marker_id), 5) });
    } catch (error) { window.alert(`QR 產生失敗：${translateError(error)}`); }
  };

  const locate = (point: Point) => {
    location.href = `${LEGACY_BASE}/b1_integrated_marker_system.html?marker=${encodeURIComponent(point.marker_id)}`;
  };

  /**
   * 對應 V1 的 printAllQr。V1 另開視窗並以 document.write 組出標籤頁；這裡改成把標籤
   * 渲染進本頁的列印區塊，再呼叫 window.print()，列印結果相同但不需要彈出視窗權限，
   * 也不必手動跳脫任何字串。
   */
  const printAll = async () => {
    if (!rows.length) { window.alert('目前沒有巡邏點可列印'); return; }
    try {
      const sorted = rows.slice().sort((a, b) =>
        (floorOrder(a.floor_id) - floorOrder(b.floor_id))
        || String(a.label || '').localeCompare(String(b.label || ''), 'zh-Hant'));
      const tags = await Promise.all(sorted.map(async point => ({
        markerId: point.marker_id,
        label: String(point.label || point.marker_id),
        floor: String(point.floor_id || '未分類'),
        image: await qrDataUrl(checkinUrl(point.marker_id), 6),
      })));
      setPrintTags(tags);
    } catch (error) { window.alert(`QR 標籤產生失敗：${translateError(error)}`); }
  };

  // 標籤圖片掛上畫面後才呼叫列印，否則列印預覽會是空白。
  useEffect(() => {
    if (!printTags) return;
    const timer = window.setTimeout(() => {
      window.print();
      setPrintTags(null);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [printTags]);

  return <AppShell profile={profile} title={module.title}>
    <div className="v1list-page pointlist-page">
      <nav className="v1list-local-nav" aria-label="巡邏點相關功能">
        <div className="v1list-nav-heading">
          <h1>巡邏點清單</h1>
          <p>全樓層巡邏點標示彙總</p>
        </div>
        <div className="v1list-nav-links">
          <a href={`${LEGACY_BASE}/modeler.html?v=2`}>3D建模系統</a>
          <a href={`${LEGACY_BASE}/arealist.html`}>區域位置表</a>
          <a href={`${LEGACY_BASE}/b1_integrated_marker_system.html`}>整合標記系統</a>
          <a href={`${LEGACY_BASE}/patrollist.html`}>巡邏點清單</a>
          <a href={`${LEGACY_BASE}/guardpatrol.html`}>駐衛警巡檢系統</a>
          <a href={`${LEGACY_BASE}/admin.html`}>後台</a>
        </div>
      </nav>

      <p className="v1list-hint">
        彙總所有樓層目前已放置的「巡邏點」標示（唯讀）。新增、移動或停用巡邏點請至
        「整合標記系統」的平面圖操作，本頁只呈現結果並提供 QR 標籤。
      </p>

      <div className="v1list-stats">
        <div className="v1list-stat">
          <div className="n">{rows.length ? new Set(rows.map(row => row.floor_id)).size : '—'}</div>
          <div className="l">涵蓋樓層數</div>
        </div>
        <div className="v1list-stat">
          <div className="n">{rows.length || '—'}</div>
          <div className="l">巡邏點總數</div>
        </div>
      </div>

      <div className="v1list-toolbar">
        <select value={floorFilter} onChange={event => setFloorFilter(event.target.value)} aria-label="樓層篩選">
          <option value="">全部樓層</option>
          {floorsSorted.map(floor => <option key={floor} value={floor}>{floor}</option>)}
        </select>
        <input value={query} onChange={event => setQuery(event.target.value)}
          placeholder="搜尋巡邏點名稱或說明…" aria-label="搜尋巡邏點" />
        <span className="v1list-space" />
        <button className="mini" onClick={() => void printAll()}>🖶 列印全部 QR</button>
      </div>

      {status && <div className="v1list-empty">
        {status}
        {failed && <><br /><button className="mini" style={{ marginTop: 12 }} onClick={() => void load()}>重新載入</button></>}
      </div>}

      {!status && !filtered.length && <div className="v1list-empty">
        尚無巡邏點資料。<br />請至「整合標記系統」平面圖新增巡邏點標示。
      </div>}

      {!status && grouped.map(([floor, items]) => {
        const isCollapsed = collapsed.has(floor);
        return <section className="v1list-floor" key={floor}>
          <button type="button" className={`v1list-floor-head${isCollapsed ? ' collapsed' : ''}`}
            onClick={() => toggleFloor(floor)} aria-expanded={!isCollapsed}>
            <span className="caret">▼</span>
            <span className="fname">{floor}</span>
            <span className="fcount">{items.length} 個巡邏點</span>
          </button>
          {!isCollapsed && <div className="v1list-floor-body">
            {items.map(point => {
              const checkin = lastCheckin.get(point.marker_id);
              return <div className="v1list-row" key={point.marker_id}>
                <span className="dot" />
                <span className="mname">{point.label}</span>
                <span className="mnote">{point.note || ''}</span>
                <span className={`mlast${checkin ? ' has' : ''}`}>
                  {checkin ? `上次簽到 ${fmtTime(checkin)}` : '尚無簽到記錄'}
                </span>
                <span className="acts">
                  <button className="mini" onClick={() => void openQr(point)}>QR</button>
                  <button className="mini" onClick={() => locate(point)}>定位</button>
                </span>
              </div>;
            })}
          </div>}
        </section>;
      })}

      {qr && <div className="v1list-modal-bg" role="dialog" aria-modal="true" aria-label="巡邏點 QR code">
        <div className="v1list-modal qr">
          <div className="v1list-modal-head">
            <span className="mt">巡邏點 QR code</span>
            <button className="x" onClick={() => setQr(null)} aria-label="關閉">✕</button>
          </div>
          <div className="v1list-qr-body">
            <div className="qname">{qr.label}</div>
            <div className="qfloor">{qr.floor}</div>
            <div className="qbox"><img src={qr.image} alt={`${qr.floor} ${qr.label} 的簽到 QR code`} /></div>
            <button className="mini" onClick={() => window.print()}>🖶 列印</button>
          </div>
        </div>
      </div>}

      {printTags && <div className="pointlist-print-sheet" aria-hidden="true">
        <div className="grid">
          {printTags.map(tag => <div className="tag" key={tag.markerId}>
            <img src={tag.image} alt="" />
            <div className="n">{tag.label}</div>
            <div className="f">{tag.floor}</div>
          </div>)}
        </div>
      </div>}
    </div>
  </AppShell>;
}
