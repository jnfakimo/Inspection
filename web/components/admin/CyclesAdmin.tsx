'use client';

// SYS-01 巡檢週期：對應 V1 admin.html 的 page-cycles。
//
// 開新週期沿用 V1 的兩步驟做法（先把所有未結束的週期補上 ended_at，再插入新的一筆），
// 因為 inspection_cycles 沒有對應的 security definer 函式可呼叫。兩個 statement 之間
// 不是同一筆交易：若關閉成功而插入失敗，會短暫出現「沒有進行中週期」的狀態，
// 因此插入失敗時明確提示需重新開啟，不讓使用者以為沒事。
// 兩段寫入的權限都由 inspection_cycles_admin_insert／_admin_update（is_admin()）把關。

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
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
    const client = getSupabase();
    const [c, u] = await Promise.all([
      client.from('inspection_cycles').select('*').order('started_at', { ascending: false }).limit(500),
      client.from('users').select('user_id,name').limit(2000),
    ]);
    if (c.error) setNote(`失敗：${errorMessage(c.error, '巡檢週期載入失敗')}`);
    setRows(c.data || []); setUsers(u.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const nameOf = (id: unknown) => users.find(user => user.user_id === id)?.name || (id ? String(id) : '—');
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const running = rows.find(row => !row.ended_at);

  const createCycle = async () => {
    if (!window.confirm('確定要開啟新巡檢週期？所有設備將重置為未巡檢（紅燈）。')) return;
    setBusy(true); setNote('');
    const client = getSupabase();
    const closed = await client.from('inspection_cycles').update({ ended_at: new Date().toISOString() }).is('ended_at', null);
    if (closed.error) { setNote(`失敗：結束現有週期失敗，未建立新週期。${errorMessage(closed.error)}`); setBusy(false); return; }
    const { error } = await client.from('inspection_cycles').insert({
      cycle_type: cycleType, started_at: new Date().toISOString(), created_by: profile.user_id,
    });
    if (error) {
      setNote(`失敗：現有週期已結束但新週期建立失敗，目前沒有進行中的週期，請再按一次開啟。${errorMessage(error)}`);
      await load(); return;
    }
    await load(); setNote('新巡檢週期已開啟，所有設備已重置為未巡檢');
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
