'use client';

// SYS-02 維修派工：補完最後兩個仍為唯讀通用列表的模組。
//
// - attachments（維修附件）：報修與工單附件的索引。repair-files 是私有 bucket，
//   因此以 createSignedUrl 產生限時網址供檢視，不外流永久連結。
//   刻意唯讀：上傳本來就內含於報修建立流程（workspace.tsx），此處是索引不是上傳點；
//   且 repair_attachments 只有 select 與 insert 政策，沒有 update／delete。
// - analytics（維修分析）：對齊 V1 analytics.html 的八張報表與五個 KPI，
//   計算方式（MTTR、派工時間、SLA 準時判定）逐項沿用 V1 公式，避免兩邊數字對不起來。
//   匯出統一為 .xlsx（與 2026-08-17 全站統一匯入匯出格式的決定一致），
//   ExcelJS 以動態 import 載入，只有按下匯出時才下載該套件。

import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };
type Report = { title: string; cols: string[]; rows: Array<Array<string | number>> };

const KIND_LABEL: Record<string, string> = {
  report: '報修照片', location: '位置照片', equipment: '設備照片',
  progress: '處理過程', complete: '完工照片', sign: '簽名', other: '其他',
};

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((acc, p) => (acc[p.type] = p.value, acc), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function WorkorderExtras({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => module.key === 'attachments'
    ? <AttachmentsModule system={system} module={module} profile={profile} />
    : <AnalyticsModule system={system} module={module} profile={profile} />}</AuthGate>;
}

/* ──────────────────────────── 維修附件 ──────────────────────────── */

function AttachmentsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [kind, setKind] = useState(''), [page, setPage] = useState(1);
  const [opening, setOpening] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase().from('repair_attachments')
      .select('*,repair_requests(req_no,fault_desc,department),maintenance_orders(wo_no)')
      .order('uploaded_at', { ascending: false }).limit(1000);
    if (error) setNote(`失敗：${errorMessage(error, '附件索引載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, kind]);

  const filtered = useMemo(() => rows.filter(row => {
    const req = (row.repair_requests as Row) || {}, ord = (row.maintenance_orders as Row) || {};
    const q = query.trim().toLowerCase();
    return (!kind || row.kind === kind) &&
      (!q || [row.file_name, row.file_path, req.req_no, req.fault_desc, req.department, ord.wo_no].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, kind]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const kinds = useMemo(() => [...new Set(rows.map(r => String(r.kind || '')))].filter(Boolean), [rows]);

  // repair-files 為私有 bucket，必須以簽章網址開啟；有效期限 5 分鐘。
  const open = async (row: Row) => {
    const path = String(row.file_path || '');
    if (!path) { setNote('失敗：這筆附件沒有檔案路徑'); return; }
    setOpening(String(row.attach_id)); setNote('');
    const { data, error } = await getSupabase().storage.from('repair-files').createSignedUrl(path, 300);
    setOpening('');
    if (error || !data?.signedUrl) { setNote(`失敗：${errorMessage(error, '無法產生檔案連結')}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋檔名、案件編號、工單或故障說明" />
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">全部類型</option>
          {kinds.map(k => <option key={k} value={k}>{KIND_LABEL[k] || k}</option>)}
        </select>
        <span>共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>上傳時間</th><th>報修案件</th><th>工單</th><th>檔名</th><th>類型</th><th>操作</th></tr></thead>
        <tbody>{paged.map(row => {
          const req = (row.repair_requests as Row) || {}, ord = (row.maintenance_orders as Row) || {};
          return <tr key={String(row.attach_id)}>
            <td>{fmtTime(row.uploaded_at)}</td>
            <td><strong>{fmt(req.req_no)}</strong><small>{fmt(req.fault_desc)}</small></td>
            <td>{fmt(ord.wo_no)}</td>
            <td>{fmt(row.file_name)}</td>
            <td>{KIND_LABEL[String(row.kind)] || fmt(row.kind)}</td>
            <td><div className="admin-row-actions">
              <button disabled={opening === String(row.attach_id)} onClick={() => void open(row)}>
                {opening === String(row.attach_id) ? '產生連結…' : '開啟檔案'}
              </button>
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有維修附件</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
      <p className="inline-message">附件於報修建立與完工回報流程中上傳，此頁為索引與檢視。檔案存放於私有的 repair-files，開啟時產生 5 分鐘有效的簽章網址。</p>
    </section>
  </AppShell>;
}

/* ──────────────────────────── 維修分析 ──────────────────────────── */

function AnalyticsModule({ module, profile }: Props) {
  const [from, setFrom] = useState(monthsAgo(1));
  const [to, setTo] = useState(taipeiToday());
  const [reports, setReports] = useState<Report[]>([]);
  const [kpis, setKpis] = useState<Array<[string, string]>>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const toEnd = `${to}T23:59:59+08:00`, fromStart = `${from}T00:00:00+08:00`;
    const [r, o, c] = await Promise.all([
      client.from('repair_requests').select('request_id,req_no,department,fault_type,urgency,status,created_at,equipment(name)')
        .gte('created_at', fromStart).lte('created_at', toEnd).limit(5000),
      client.from('maintenance_orders').select('order_id,request_id,status,labor_hours,start_time,finish_time,expected_finish,created_at,assignee_id,users!maintenance_orders_assignee_id_fkey(name)')
        .gte('created_at', fromStart).lte('created_at', toEnd).limit(5000),
      client.from('cost_records').select('cost_id,cost_type,amount,vendor,cost_date,equipment(name)')
        .gte('cost_date', from).lte('cost_date', to).limit(5000),
    ]);
    if (r.error || o.error || c.error) { setNote(`失敗：${errorMessage(r.error || o.error || c.error, '分析資料載入失敗')}`); setBusy(false); return; }
    const reqs = (r.data || []) as Row[], ords = (o.data || []) as Row[], costs = (c.data || []) as Row[];

    // 以下彙總方式逐項沿用 V1 analytics.html，確保兩邊數字一致。
    const countBy = (arr: Row[], fn: (row: Row) => unknown) => {
      const m: Record<string, number> = {};
      arr.forEach(x => { const k = String(fn(x) ?? '（未填）') || '（未填）'; m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v] as [string, number]);
    };
    const sumBy = (arr: Row[], keyFn: (row: Row) => unknown, valFn: (row: Row) => unknown) => {
      const m: Record<string, number> = {};
      arr.forEach(x => { const k = String(keyFn(x) ?? '（未填）') || '（未填）'; m[k] = (m[k] || 0) + Number(valFn(x) || 0); });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const avg = (list: number[]) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
    const money = (n: number) => n.toLocaleString('zh-TW');
    const reqMap: Record<string, Row> = {};
    reqs.forEach(row => { reqMap[String(row.request_id)] = row; });

    const doneO = ords.filter(x => ['completed', 'closed'].includes(String(x.status)) && x.finish_time);
    const mttr = avg(doneO.filter(x => x.start_time).map(x => (Date.parse(String(x.finish_time)) - Date.parse(String(x.start_time))) / 3600000));
    const dispatchT = avg(ords.map(x => {
      const req = reqMap[String(x.request_id)];
      return req ? (Date.parse(String(x.created_at)) - Date.parse(String(req.created_at))) / 3600000 : null;
    }).filter((v): v is number => v != null && v >= 0));
    const onTime = doneO.filter(x => x.expected_finish ? Date.parse(String(x.finish_time)) <= Date.parse(String(x.expected_finish)) : true).length;
    const sla = doneO.length ? Math.round(onTime / doneO.length * 100) : null;

    setKpis([
      [String(reqs.length), '報修總件數'], [String(doneO.length), '完成維修'],
      [sla == null ? '—' : `${sla}%`, 'SLA 達成率'],
      [mttr == null ? '—' : `${mttr.toFixed(1)}h`, '平均修復 MTTR'],
      [dispatchT == null ? '—' : `${dispatchT.toFixed(1)}h`, '平均派工時間'],
    ]);

    const techWorkload = () => {
      const m: Record<string, [number, number]> = {};
      ords.forEach(x => {
        const k = (x.users as Row)?.name || '（未指派）';
        if (!m[k]) m[k] = [0, 0];
        m[k][0]++; m[k][1] += Number(x.labor_hours || 0);
      });
      return Object.entries(m).map(([k, v]) => [k, v[0], v[1].toFixed(1)] as Array<string | number>).sort((a, b) => Number(b[1]) - Number(a[1]));
    };
    const monthly = () => {
      const m: Record<string, number> = {};
      reqs.forEach(x => { const k = String(x.created_at || '').slice(0, 7); if (k) m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, v] as Array<string | number>);
    };

    setReports([
      { title: '設備故障排行', cols: ['設備', '次數'], rows: countBy(reqs, x => (x.equipment as Row)?.name) },
      { title: '單位報修排行', cols: ['單位', '件數'], rows: countBy(reqs, x => x.department) },
      { title: '維修人員工作量', cols: ['維修人員', '案件數', '總工時'], rows: techWorkload() },
      { title: '故障原因分析', cols: ['故障類型', '次數'], rows: countBy(reqs, x => x.fault_type) },
      { title: '急迫度分布', cols: ['急迫度', '件數'], rows: countBy(reqs, x => x.urgency) },
      { title: '各月份報修趨勢', cols: ['月份', '件數'], rows: monthly() },
      { title: '材料／零件成本', cols: ['設備', '金額'], rows: sumBy(costs.filter(x => ['parts', 'labor'].includes(String(x.cost_type))), x => (x.equipment as Row)?.name, x => x.amount).map(([k, v]) => [k, money(v)]) },
      { title: '委外成本分析', cols: ['廠商', '金額'], rows: sumBy(costs.filter(x => String(x.cost_type) === 'outsource'), x => x.vendor, x => x.amount).map(([k, v]) => [k, money(v)]) },
      {
        title: 'SLA 達成分析', cols: ['項目', '數值'], rows: [
          ['完成案件', doneO.length], ['準時完成', onTime],
          ['SLA 達成率', sla == null ? '—' : `${sla}%`],
          ['平均修復時間', mttr == null ? '—' : `${mttr.toFixed(1)} 小時`],
          ['平均派工時間', dispatchT == null ? '—' : `${dispatchT.toFixed(1)} 小時`],
        ],
      },
    ]);
    setBusy(false);
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  // ExcelJS 以動態 import 載入，只有實際匯出時才下載該套件。
  const exportXlsx = async () => {
    if (!reports.length) return;
    setNote('');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = '臺北農產公司'; wb.created = new Date();
      for (const report of reports) {
        // 工作表名稱不得含 : \ / ? * [ ]，長度上限 31。
        const safe = report.title.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
        const ws = wb.addWorksheet(safe);
        ws.addRow(report.cols);
        report.rows.forEach(row => ws.addRow(row));
        ws.getRow(1).font = { bold: true };
        ws.columns.forEach((col, i) => { col.width = Math.max(14, Math.min(30, String(report.cols[i] || '').length * 2 + 6)); });
      }
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `維修分析_${from}_${to}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNote(`失敗：${errorMessage(error, '匯出失敗')}`); }
  };

  const quick = (months: number) => { setFrom(monthsAgo(months)); setTo(taipeiToday()); };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" disabled={busy || !reports.length} onClick={() => void exportXlsx()}>⭱ 匯出 XLSX</button>} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <button className="secondary-btn" onClick={() => quick(1)}>近一個月</button>
        <button className="secondary-btn" onClick={() => quick(3)}>近一季</button>
        <button className="secondary-btn" onClick={() => quick(12)}>近一年</button>
        <label>起日<LocalizedDateInput aria-label="起始日期（年/月/日）" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>迄日<LocalizedDateInput aria-label="結束日期（年/月/日）" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      <div className="admin-toolbar" style={{ gap: 18 }}>
        {kpis.map(([value, label]) => <span key={label}><strong style={{ fontSize: '1.4rem' }}>{value}</strong>　{label}</span>)}
      </div>
    </section>

    {reports.map(report => <section className="panel admin-panel" key={report.title}>
      <div className="admin-toolbar"><span><strong>{report.title}</strong>　{report.rows.length} 列</span></div>
      <div className="responsive-table"><table>
        <thead><tr>{report.cols.map(col => <th key={col}>{col}</th>)}</tr></thead>
        <tbody>{report.rows.slice(0, 20).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>)}</tbody>
      </table></div>
      {report.rows.length === 0 && <p className="empty">此區間沒有資料</p>}
      {report.rows.length > 20 && <p className="inline-message">畫面僅顯示前 20 列，完整內容請使用「匯出 XLSX」。</p>}
    </section>)}
  </AppShell>;
}
