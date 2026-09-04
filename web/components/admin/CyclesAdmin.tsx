'use client';

// SYS-01 巡檢週期：對應 V1 admin.html 的 page-cycles。
//
// 開新週期由 app-api 呼叫 security definer 函式，在同一筆交易內關閉舊週期並建立新週期，
// 避免兩個 statement 之間失敗而留下「沒有進行中週期」的狀態。

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { AdminHeader, type AdminProps, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from './shared';

const CYCLE_TYPES: Array<[string, string]> = [['daily', '每日'], ['shift', '每班'], ['weekly', '每週']];
const CYCLE_LABEL = Object.fromEntries(CYCLE_TYPES);

export function CyclesAdmin({ profile, module }: AdminProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [cycleType, setCycleType] = useState('daily'), [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      const client = getSupabase();
      const [c, u] = await Promise.all([
        client.from('inspection_cycles').select('*').order('started_at', { ascending: false }).limit(500),
        client.from('users').select('user_id,name').limit(1000),
      ]);
      if (c.error) setNote(`失敗：${errorMessage(c.error, '巡檢週期載入失敗')}`);
      setRows(c.data || []); setUsers(u.data || []);
    } catch (error) { setNote(`失敗：${errorMessage(error, '巡檢週期載入失敗')}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const nameOf = (id: unknown) => users.find(user => user.user_id === id)?.name || (id ? String(id) : '—');
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const running = rows.find(row => !row.ended_at);
  const cyclePages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => { if (page > cyclePages) setPage(cyclePages); }, [page, cyclePages]);

  const createCycle = async () => {
    if (!window.confirm('確定要開啟新巡檢週期？所有設備將重置為未巡檢（紅燈）。')) return;
    setBusy(true); setNote('');
    try {
      await invokeAppApi('open_inspection_cycle', { cycle_type: cycleType });
      await load(); setNote('新巡檢週期已開啟，所有設備已重置為未巡檢');
    } catch (error) { setNote(`失敗：${errorMessage(error, '開啟巡檢週期失敗')}`); }
    finally { setBusy(false); }
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />

    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <label>週期類型<select value={cycleType} onChange={e => setCycleType(e.target.value)}>
          {CYCLE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <button className="primary-btn compact" disabled={busy} onClick={() => void createCycle()}>⟳ 開啟新週期（結束現有週期）</button>
        <span>{running ? `進行中：${CYCLE_LABEL[String(running.cycle_type)] || fmt(running.cycle_type)}，自 ${fmtTime(running.started_at)}` : '目前沒有進行中的週期'}</span>
      </div>
      <p className="inline-message">開啟新週期會把所有未結束的週期補上結束時間，巡檢燈號隨之全部重置為紅燈（未巡檢）。</p>
    </section>

    <section className="panel admin-panel">
      <div className="admin-toolbar"><span>週期歷史</span></div>
      <div className="responsive-table"><table>
        <thead><tr><th>類型</th><th>開始時間</th><th>結束時間</th><th>建立者</th><th>狀態</th></tr></thead>
        <tbody>{paged.map(row => <tr key={String(row.cycle_id)}>
          <td><strong>{CYCLE_LABEL[String(row.cycle_type)] || fmt(row.cycle_type)}</strong></td>
          <td>{fmtTime(row.started_at)}</td>
          <td>{row.ended_at ? fmtTime(row.ended_at) : '—'}</td>
          <td>{nameOf(row.created_by)}</td>
          <td><span className={`status-pill ${row.ended_at ? 'pending' : 'closed'}`}>{row.ended_at ? '已結束' : '進行中'}</span></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有週期紀錄</p>}
      <Pager page={page} total={rows.length} onPage={setPage} />
    </section>
  </AppShell>;
}
