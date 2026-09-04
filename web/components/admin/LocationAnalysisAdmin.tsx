'use client';

// SYS-01 位置分析：對應 V1 admin.html 的 page-locanalysis。
// 以 location_id 綁定的巡檢與報修為來源，做「市場 → 樓層 → 區域 → 細部位置」的
// 樞紐下鑽，統計數與 V1 一致（巡檢次數、異常次數、異常率、報修數、最近巡檢時間）。
// 市場列與樓層列可點擊收合，與 V1 的 laToggle 行為相同。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { MetricCard } from '@/components/MetricCard';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, type AdminProps, errorMessage, fmt, fmtTime, type Row } from './shared';
import { canonicalFloor } from '@/lib/floor';

type Cell = { insp: number; abn: number; repair: number; lastTime: string | null };
type DetailNode = Cell & { name: string; order: number };
type AreaNode = { name: string; order: number; details: Map<string, DetailNode> };
type FloorNode = { name: string; order: number; areas: Map<string, AreaNode> };
type MarketNode = { name: string; floors: Map<string, FloorNode> };

const sum = (cells: Cell[]) => cells.reduce((acc, cell) => ({
  insp: acc.insp + cell.insp, abn: acc.abn + cell.abn, repair: acc.repair + cell.repair,
  lastTime: !cell.lastTime ? acc.lastTime : !acc.lastTime || cell.lastTime > acc.lastTime ? cell.lastTime : acc.lastTime,
}), { insp: 0, abn: 0, repair: 0, lastTime: null as string | null });
const rate = (abn: number, insp: number) => insp ? `${(abn / insp * 100).toFixed(1)}%` : '—';
const num = (value: number) => value || '—';

export function LocationAnalysisAdmin({ profile, module }: AdminProps) {
  const [inspections, setInspections] = useState<Row[]>([]);
  const [repairs, setRepairs] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [updatedAt, setUpdatedAt] = useState('');
  const [market, setMarket] = useState(''), [floor, setFloor] = useState(''), [hideZero, setHideZero] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      const client = getSupabase();
      const [i, r] = await Promise.all([
        client.from('inspection_records')
          .select('location_id,run_status,inspect_time,locations(market_id,floor,floor_order,area,area_order,detail,detail_order,markets(name))')
          .not('location_id', 'is', null).limit(1000),
        client.from('repair_requests')
          .select('location_id,locations(market_id,floor,floor_order,area,area_order,detail,detail_order,markets(name))')
          .not('location_id', 'is', null).limit(1000),
      ]);
      if (i.error || r.error) setNote(`失敗：${errorMessage(i.error || r.error, '位置分析資料載入失敗')}`);
      const normalize = (row: Row) => {
        const location = Array.isArray(row.locations) ? row.locations[0] : row.locations;
        return location && typeof location === 'object'
          ? { ...row, locations: { ...(location as Row), floor: canonicalFloor((location as Row).floor) } }
          : row;
      };
      setInspections((i.data || []).map(normalize)); setRepairs((r.data || []).map(normalize));
      setUpdatedAt(fmtTime(new Date().toISOString()));
    } catch (error) { setNote(`失敗：${errorMessage(error, '位置分析資料載入失敗')}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const locationOf = (row: Row) => (Array.isArray(row.locations) ? row.locations[0] : row.locations) as Row | null;
  const markets = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of [...inspections, ...repairs]) {
      const loc = locationOf(row);
      const mk = loc && (Array.isArray(loc.markets) ? loc.markets[0] : loc.markets) as Row | null;
      if (loc?.market_id) map.set(String(loc.market_id), String(mk?.name || loc.market_id));
    }
    return [...map.entries()];
  }, [inspections, repairs]);
  const floors = useMemo(() => {
    if (!market) return [] as string[];
    const map = new Map<string, number>();
    for (const row of [...inspections, ...repairs]) {
      const loc = locationOf(row);
      if (loc && String(loc.market_id) === market) map.set(String(loc.floor), Number(loc.floor_order || 0));
    }
    return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  }, [inspections, repairs, market]);
  useEffect(() => { if (floor && !floors.includes(floor)) setFloor(''); }, [floors, floor]);

  const matches = useCallback((row: Row) => {
    const loc = locationOf(row);
    if (!loc) return false;
    return (!market || String(loc.market_id) === market) && (!floor || String(loc.floor) === floor);
  }, [market, floor]);

  const tree = useMemo(() => {
    const root = new Map<string, MarketNode>();
    const cellOf = (row: Row) => {
      const loc = locationOf(row)!;
      const mk = (Array.isArray(loc.markets) ? loc.markets[0] : loc.markets) as Row | null;
      const marketKey = String(loc.market_id);
      if (!root.has(marketKey)) root.set(marketKey, { name: String(mk?.name || marketKey), floors: new Map() });
      const marketNode = root.get(marketKey)!;
      const floorKey = String(loc.floor ?? '');
      if (!marketNode.floors.has(floorKey)) marketNode.floors.set(floorKey, { name: floorKey || '未分類', order: Number(loc.floor_order || 0), areas: new Map() });
      const floorNode = marketNode.floors.get(floorKey)!;
      const areaKey = String(loc.area ?? '');
      if (!floorNode.areas.has(areaKey)) floorNode.areas.set(areaKey, { name: areaKey || '未分類', order: Number(loc.area_order || 0), details: new Map() });
      const areaNode = floorNode.areas.get(areaKey)!;
      const detailKey = String(loc.detail ?? '');
      if (!areaNode.details.has(detailKey)) areaNode.details.set(detailKey, { name: detailKey || '—', order: Number(loc.detail_order || 0), insp: 0, abn: 0, repair: 0, lastTime: null });
      return areaNode.details.get(detailKey)!;
    };
    for (const row of inspections.filter(matches)) {
      const cell = cellOf(row);
      cell.insp += 1;
      if (row.run_status === 'abnormal') cell.abn += 1;
      const time = row.inspect_time ? String(row.inspect_time) : null;
      if (time && (!cell.lastTime || time > cell.lastTime)) cell.lastTime = time;
    }
    for (const row of repairs.filter(matches)) cellOf(row).repair += 1;
    return root;
  }, [inspections, repairs, matches]);

  const visible = useMemo(() => inspections.filter(matches), [inspections, matches]);
  const totalInsp = visible.length;
  const totalAbn = visible.filter(row => row.run_status === 'abnormal').length;
  const totalRepair = useMemo(() => repairs.filter(matches).length, [repairs, matches]);

  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const rows: React.ReactNode[] = [];
  for (const [marketKey, marketNode] of [...tree.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'zh-TW'))) {
    const marketCells = [...marketNode.floors.values()].flatMap(f => [...f.areas.values()].flatMap(a => [...a.details.values()]));
    const marketTotal = sum(marketCells);
    if (hideZero && marketTotal.insp + marketTotal.repair === 0) continue;
    const marketCollapsed = collapsed.has(marketKey);
    rows.push(<tr key={marketKey} className="la-market" onClick={() => toggle(marketKey)} style={{ cursor: 'pointer', fontWeight: 700 }}>
      <td colSpan={4}>{marketCollapsed ? '▶' : '▼'} {marketNode.name}</td>
      <td style={{ textAlign: 'right' }}>{num(marketTotal.insp)}</td>
      <td style={{ textAlign: 'right' }}>{num(marketTotal.abn)}</td>
      <td style={{ textAlign: 'right' }}>{rate(marketTotal.abn, marketTotal.insp)}</td>
      <td style={{ textAlign: 'right' }}>{num(marketTotal.repair)}</td>
      <td>{marketTotal.lastTime ? fmtTime(marketTotal.lastTime) : '—'}</td>
    </tr>);
    if (marketCollapsed) continue;

    for (const [floorKey, floorNode] of [...marketNode.floors.entries()].sort((a, b) => a[1].order - b[1].order)) {
      const floorCells = [...floorNode.areas.values()].flatMap(a => [...a.details.values()]);
      const floorTotal = sum(floorCells);
      if (hideZero && floorTotal.insp + floorTotal.repair === 0) continue;
      const floorId = `${marketKey}|${floorKey}`;
      const floorCollapsed = collapsed.has(floorId);
      rows.push(<tr key={floorId} className="la-floor" onClick={() => toggle(floorId)} style={{ cursor: 'pointer' }}>
        <td />
        <td colSpan={3}>{floorCollapsed ? '▶' : '▼'} {floorNode.name}</td>
        <td style={{ textAlign: 'right' }}>{num(floorTotal.insp)}</td>
        <td style={{ textAlign: 'right' }}>{num(floorTotal.abn)}</td>
        <td style={{ textAlign: 'right' }}>{rate(floorTotal.abn, floorTotal.insp)}</td>
        <td style={{ textAlign: 'right' }}>{num(floorTotal.repair)}</td>
        <td>{floorTotal.lastTime ? fmtTime(floorTotal.lastTime) : '—'}</td>
      </tr>);
      if (floorCollapsed) continue;

      for (const areaNode of [...floorNode.areas.values()].sort((a, b) => a.order - b.order)) {
        for (const detailNode of [...areaNode.details.values()].sort((a, b) => a.order - b.order)) {
          if (hideZero && detailNode.insp + detailNode.repair === 0) continue;
          rows.push(<tr key={`${floorId}|${areaNode.name}|${detailNode.name}`}>
            <td /><td />
            <td>{areaNode.name}</td>
            <td>{detailNode.name}</td>
            <td style={{ textAlign: 'right' }}>{num(detailNode.insp)}</td>
            <td style={{ textAlign: 'right' }}>{num(detailNode.abn)}</td>
            <td style={{ textAlign: 'right' }}>{rate(detailNode.abn, detailNode.insp)}</td>
            <td style={{ textAlign: 'right' }}>{num(detailNode.repair)}</td>
            <td>{detailNode.lastTime ? fmtTime(detailNode.lastTime) : '—'}</td>
          </tr>);
        }
      }
    }
  }

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="metrics-grid">
      <MetricCard label="綁定位置巡檢" value={totalInsp} unit="次" />
      <MetricCard label="異常次數" value={totalAbn} unit="次" tone="red" />
      <MetricCard label="綁定位置報修" value={totalRepair} unit="件" tone="amber" />
      <MetricCard label="整體異常率" value={rate(totalAbn, totalInsp)} tone="green" />
    </section>
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <select value={market} onChange={e => { setMarket(e.target.value); setFloor(''); }}>
          <option value="">全部市場</option>
          {markets.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={floor} onChange={e => setFloor(e.target.value)} disabled={!market}>
          <option value="">全部樓層</option>
          {floors.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <label className="checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} />隱藏零筆紀錄
        </label>
        <span>{updatedAt ? `更新：${updatedAt}` : ''}</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr>
          <th>市場</th><th>樓層</th><th>區域</th><th>細部位置</th>
          <th style={{ textAlign: 'right' }}>巡檢</th><th style={{ textAlign: 'right' }}>異常</th>
          <th style={{ textAlign: 'right' }}>異常率</th><th style={{ textAlign: 'right' }}>報修</th><th>最近巡檢</th>
        </tr></thead>
        <tbody>{rows}</tbody>
      </table></div>
      {!busy && rows.length === 0 && <p className="empty">沒有綁定場域位置的巡檢或報修紀錄</p>}
      <p className="inline-message">
        只統計已綁定場域位置的紀錄，未綁定位置者不計入；點擊市場或樓層列可收合下層。
        本頁彙總 {fmt(inspections.length)} 筆巡檢與 {fmt(repairs.length)} 筆報修（各取最近 1000 筆）。
      </p>
    </section>
  </AppShell>;
}
