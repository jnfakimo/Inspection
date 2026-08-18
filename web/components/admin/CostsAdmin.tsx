'use client';

// SYS-01 費用統計：對應 V1 admin.html 的 page-costs。
// 三段結構與 V1 相同——新增費用記錄、費用明細（含合計與匯出）、各設備費用排名。
//
// 寫入直接走 cost_records，與 V1 一致：該表的 insert/update 政策
// （cost_records_managed_insert／_update）已要求 has_system_access('sys_workorder')
// 且必須是管理者或具 dispatch 權限，伺服器端把關存在，依 ARCHITECTURE_V2.md
// 「第 3 條的實際落差」的判斷準則不另包一層 Edge Function。
//
// 匯出沿用全站 2026-08-17 統一的 .xlsx，ExcelJS 以動態 import 載入。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { AdminHeader, AdminModal, type AdminProps, errorMessage, fmt, PAGE_SIZE, Pager, type Row } from './shared';

const COST_TYPES: Array<[string, string]> = [
  ['purchase', '購置費'], ['outsource', '委外維修'], ['parts', '零件費'], ['labor', '工時費'], ['other', '其他'],
];
const COST_TYPE_LABEL = Object.fromEntries(COST_TYPES);
const money = (value: unknown) => Number(value || 0).toLocaleString('zh-TW');

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((acc, part) => (acc[part.type] = part.value, acc), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const emptyForm = () => ({ equipment_id: '', cost_type: 'purchase', vendor: '', cost_date: taipeiToday(), amount: '', note: '' });

export function CostsAdmin({ profile, module }: AdminProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [equipment, setEquipment] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [equipmentFilter, setEquipmentFilter] = useState(''), [typeFilter, setTypeFilter] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false), [form, setForm] = useState(emptyForm());

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [c, e] = await Promise.all([
      client.from('cost_records').select('*,equipment(name,asset_code)').order('cost_date', { ascending: false }).limit(2000),
      client.from('equipment').select('equipment_id,asset_code,name,status').order('name').limit(2000),
    ]);
    if (c.error || e.error) setNote(`失敗：${errorMessage(c.error || e.error, '費用資料載入失敗')}`);
    setRows(c.data || []); setEquipment(e.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [equipmentFilter, typeFilter, from, to]);

  const filtered = useMemo(() => rows.filter(row => {
    const date = String(row.cost_date || '');
    return (!equipmentFilter || String(row.equipment_id) === equipmentFilter)
      && (!typeFilter || String(row.cost_type) === typeFilter)
      && (!from || date >= from) && (!to || date <= to);
  }), [rows, equipmentFilter, typeFilter, from, to]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const total = filtered.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  // 排名以目前篩選結果計算，與明細表看到的數字一致。
  const ranking = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const row of filtered) {
      const key = String(row.equipment_id);
      const eq = (row.equipment as Row) || {};
      const item = map.get(key) || { name: [eq.asset_code, eq.name].filter(Boolean).join(' ') || '—', total: 0, count: 0 };
      item.total += Number(row.amount || 0); item.count += 1;
      map.set(key, item);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [filtered]);

  const submit = async () => {
    const amount = Number(form.amount);
    if (!form.equipment_id) { setNote('失敗：請選擇設備'); return; }
    if (!form.cost_date) { setNote('失敗：請填寫日期'); return; }
    if (!Number.isFinite(amount) || amount < 0) { setNote('失敗：請填寫有效金額'); return; }
    setBusy(true); setNote('');
    try { await invokeAppApi('create_cost_record', {
      equipment_id: form.equipment_id, cost_type: form.cost_type, vendor: form.vendor,
      cost_date: form.cost_date, amount, note: form.note,
    }); } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    setCreating(false); setForm(emptyForm()); await load(); setNote('費用記錄已新增');
  };

  const exportXlsx = async () => {
    if (!filtered.length) { setNote('失敗：目前沒有可匯出的費用記錄'); return; }
    setNote('');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = '臺北農產公司'; wb.created = new Date();
      const ws = wb.addWorksheet('費用報表');
      ws.addRow(['設備', '資產編號', '費用類型', '廠商', '日期', '說明', '金額']);
      filtered.forEach(row => {
        const eq = (row.equipment as Row) || {};
        ws.addRow([eq.name || '', eq.asset_code || '', COST_TYPE_LABEL[String(row.cost_type)] || row.cost_type,
          row.vendor || '', row.cost_date || '', row.note || '', Number(row.amount || 0)]);
      });
      ws.addRow([]); ws.addRow(['合計', '', '', '', '', '', total]);
      ws.getRow(1).font = { bold: true };
      ws.columns.forEach(col => { col.width = 18; });
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `費用報表_${taipeiToday()}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNote(`失敗：匯出失敗，${errorMessage(error)}`); }
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => setCreating(true)}>＋ 新增費用記錄</button>} />

    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <select value={equipmentFilter} onChange={e => setEquipmentFilter(e.target.value)}>
          <option value="">全部設備</option>
          {equipment.map(eq => <option key={String(eq.equipment_id)} value={String(eq.equipment_id)}>{`${eq.asset_code || ''} ${eq.name || ''}`.trim()}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">全部類型</option>
          {COST_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label>起日<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>迄日<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="secondary-btn" onClick={() => { setEquipmentFilter(''); setTypeFilter(''); setFrom(''); setTo(''); }}>清除</button>
        <button className="secondary-btn" onClick={() => void exportXlsx()}>⭱ 匯出 XLSX</button>
        <span>合計 <b>{money(total)}</b> 元／{filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>設備</th><th>類型</th><th>廠商</th><th>日期</th><th>說明</th><th style={{ textAlign: 'right' }}>金額</th></tr></thead>
        <tbody>{paged.map(row => {
          const eq = (row.equipment as Row) || {};
          return <tr key={String(row.cost_id)}>
            <td><strong>{fmt(eq.name)}</strong><small>{fmt(eq.asset_code)}</small></td>
            <td>{COST_TYPE_LABEL[String(row.cost_type)] || fmt(row.cost_type)}</td>
            <td>{fmt(row.vendor)}</td>
            <td>{fmt(row.cost_date)}</td>
            <td>{fmt(row.note)}</td>
            <td style={{ textAlign: 'right' }}>{money(row.amount)}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有符合條件的費用記錄</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    <section className="panel admin-panel">
      <div className="admin-toolbar"><span>各設備費用排名（依目前篩選條件）</span></div>
      <div className="responsive-table"><table>
        <thead><tr><th>名次</th><th>設備</th><th style={{ textAlign: 'right' }}>筆數</th><th style={{ textAlign: 'right' }}>累計金額</th><th style={{ textAlign: 'right' }}>占比</th></tr></thead>
        <tbody>{ranking.map((item, index) => <tr key={item.name + index}>
          <td>{String(index + 1).padStart(2, '0')}</td>
          <td><strong>{item.name}</strong></td>
          <td style={{ textAlign: 'right' }}>{item.count}</td>
          <td style={{ textAlign: 'right' }}>{money(item.total)}</td>
          <td style={{ textAlign: 'right' }}>{total ? `${(item.total / total * 100).toFixed(1)}%` : '—'}</td>
        </tr>)}</tbody>
      </table></div>
      {!busy && ranking.length === 0 && <p className="empty">目前沒有費用記錄</p>}
      <p className="inline-message">費用以 equipment_id 綁定，可據此彙總單一設備自購置到報廢的生命週期成本。</p>
    </section>

    {creating && <AdminModal title="新增費用記錄" onClose={() => setCreating(false)}>
      <div className="admin-form-grid">
        <label className="wide">設備（必填）<select value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}>
          <option value="">-- 請選擇 --</option>
          {equipment.filter(eq => eq.status !== 'retired').map(eq => <option key={String(eq.equipment_id)} value={String(eq.equipment_id)}>{`${eq.asset_code || ''} ${eq.name || ''}`.trim()}</option>)}
        </select></label>
        <label>費用類型<select value={form.cost_type} onChange={e => setForm({ ...form, cost_type: e.target.value })}>
          {COST_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>日期（必填）<input type="date" value={form.cost_date} onChange={e => setForm({ ...form, cost_date: e.target.value })} /></label>
        <label>金額（元，必填）<input type="number" min={0} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
        <label>廠商<input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="廠商名稱（選填）" /></label>
        <label className="wide">說明<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="費用說明（選填）" /></label>
      </div>
      <footer>
        <button className="secondary-btn" onClick={() => setCreating(false)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '儲存中…' : '儲存'}</button>
      </footer>
    </AdminModal>}
  </AppShell>;
}
