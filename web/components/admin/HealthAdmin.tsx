'use client';

// SYS-01 系統健康：對應 V1 admin.html 的 page-syshealth。
// 讀 client_error_logs（select 政策為 is_admin()），呈現前端自動回報的錯誤。
//
// 錯誤訊息的中文化規則逐條沿用 V1 的 translateHealthMessage，讓兩邊看到的敘述一致；
// 技術原文以 <details> 收合，維運需要時才展開。
// 發生頁面同時對應 V1 的 *.html 與 V2 的 /Inspection/v2 路由。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, AdminModal, type AdminProps, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from './shared';

const KIND_LABELS: Record<string, string> = {
  js_error: '前端程式錯誤', unhandled_rejection: '未處理的非同步錯誤',
  manual: '頁面主動回報', api_error: '系統介接失敗',
};
const PAGE_LABELS: Record<string, string> = {
  'index.html': '系統入口', 'login.html': '登入系統', 'admin.html': '後台管理系統',
  'dashboard.html': '戰情儀表板', 'dashboard-builder.html': '戰情版面設定',
  'workorder.html': '報修與維修系統', 'dispatch.html': '派工系統', 'repair.html': '維修完工回報',
  'analytics.html': '維修分析', 'equipment.html': '設備建置系統', 'materials.html': '材料主檔',
  'handover.html': '電子交接簿', 'handover-login.html': '電子交接簿登入',
  'guardpatrol.html': '駐衛警巡檢', 'guardpatrol3d.html': '立體巡檢雲臺',
  'guardpatrol-index.html': '駐衛警巡檢入口', 'patrolcheckin.html': '巡邏點簽到',
  'patrollist.html': '巡邏點清單', 'patrolshifts.html': '巡檢排班', 'patrol-notifications.html': '逾時推播紀錄',
  'vehicle-dispatch.html': '公務車派車', 'meetingroom.html': '會議室預約',
  'b1plan.html': '平面樓層圖', 'floor3d.html': '立體樓層模型', 'modeler.html': '3D 建模系統',
  'b1_integrated_marker_system.html': '整合標記系統', 'arealist.html': '區域位置表',
  'locations.html': '場域位置', 'rbac.html': '角色權限', 'notices.html': '通知中心',
  'structure_map.html': '專案關係圖', 'app.html': '行動巡檢',
};

function pageLabel(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '未識別的系統頁面';
  const path = raw.split('#')[0].split('?')[0];
  const file = path.split('/').filter(Boolean).pop() || '';
  if (PAGE_LABELS[file]) return PAGE_LABELS[file];
  if (/\/v2\//.test(raw)) {
    const segments = path.split('/').filter(Boolean);
    const index = segments.indexOf('systems');
    if (index >= 0 && segments[index + 1]) return `V2 ${segments.slice(index + 1).join('／')}`;
    return 'V2 前臺頁面';
  }
  if (/[㐀-鿿]/.test(raw)) return raw.slice(0, 60);
  return file || '未識別的系統頁面';
}

// 逐條對應 V1 的 translateHealthMessage，順序一致以免同一則訊息在兩邊翻成不同敘述。
const MESSAGE_RULES: Array<[RegExp, string]> = [
  [/resizeobserver loop (completed with undelivered notifications|limit exceeded)/i, '版面尺寸監測完成，但仍有尚未送出的更新通知。'],
  [/maximum call stack size exceeded/i, '程式呼叫層級過深，已超過系統允許的上限。'],
  [/failed to fetch|networkerror|network request failed/i, '網路連線失敗，無法取得系統資料。'],
  [/load failed|loading chunk|failed to load resource/i, '頁面所需的程式或資源載入失敗。'],
  [/cannot read propert(ies|y) of/i, '程式嘗試讀取尚未建立或不存在的資料欄位。'],
  [/cannot set propert(ies|y) of/i, '程式嘗試寫入尚未建立或不存在的資料欄位。'],
  [/is not a function/i, '程式呼叫了不存在或尚未載入的功能。'],
  [/is not defined/i, '頁面所需的程式變數尚未載入或不存在。'],
  [/unexpected token|json\.parse|invalid json/i, '系統回傳的資料格式錯誤，無法完成解析。'],
  [/quota ?exceeded/i, '瀏覽器可用的儲存空間已達上限。'],
  [/permission denied|not ?allowed/i, '目前帳號或瀏覽器沒有執行此操作的權限。'],
  [/timeout|timed out/i, '系統等待回應逾時，操作未能完成。'],
  [/abort ?error|aborted/i, '操作已中止，資料尚未完成載入。'],
];
function translateMessage(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '未提供錯誤說明。';
  for (const [pattern, label] of MESSAGE_RULES) if (pattern.test(raw)) return label;
  if (/[㐀-鿿]/.test(raw)) return raw;
  return '系統發生未分類的程式錯誤，請展開技術原文供維運人員查核。';
}

export function HealthAdmin({ profile, module }: AdminProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [kind, setKind] = useState(''), [query, setQuery] = useState(''), [days, setDays] = useState('30');
  const [page, setPage] = useState(1), [detail, setDetail] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase().from('client_error_logs')
      .select('*,users(name,username)').order('occurred_at', { ascending: false }).limit(1000);
    if (error) setNote(`失敗：${errorMessage(error, '系統健康紀錄載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [kind, query, days]);

  const filtered = useMemo(() => {
    const cutoff = days === 'all' ? null : Date.now() - Number(days) * 86400000;
    return rows.filter(row => {
      const q = query.trim().toLowerCase();
      const at = new Date(String(row.occurred_at)).getTime();
      return (!kind || String(row.kind) === kind)
        && (!cutoff || (Number.isFinite(at) && at >= cutoff))
        && (!q || [row.message, row.page, row.url, (row.users as Row)?.name].some(v => String(v || '').toLowerCase().includes(q)));
    });
  }, [rows, kind, query, days]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋錯誤訊息、頁面或操作人員" />
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">全部類型</option>
          {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={days} onChange={e => setDays(e.target.value)}>
          <option value="7">最近 7 天</option><option value="30">最近 30 天</option>
          <option value="90">最近 90 天</option><option value="all">全部紀錄</option>
        </select>
        <span>共 {filtered.length} 筆
          {filtered.filter(row => row.kind === 'api_error').length > 0 && `｜系統介接失敗 ${filtered.filter(row => row.kind === 'api_error').length}`}</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>發生時間</th><th>錯誤類型</th><th>發生頁面</th><th>錯誤訊息</th><th>操作人員</th><th>詳細內容</th></tr></thead>
        <tbody>{paged.map(row => {
          const original = String(row.message || '').trim();
          const translated = translateMessage(original);
          return <tr key={String(row.error_id)}>
            <td>{fmtTime(row.occurred_at)}</td>
            <td>{KIND_LABELS[String(row.kind)] || '其他系統錯誤'}</td>
            <td>{pageLabel(row.page || row.url)}</td>
            <td>{translated}
              {original && original !== translated && <details><summary>查看技術原文</summary><code>{original}</code></details>}</td>
            <td>{fmt((row.users as Row)?.name) === '—' ? '未識別' : String((row.users as Row).name)}</td>
            <td><button className="link-btn" onClick={() => setDetail(row)}>檢視</button></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有符合條件的錯誤紀錄</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
      <p className="inline-message">紀錄由前端自動回報，只有系統管理者讀得到（client_error_logs 的 select 政策為 is_admin()）。</p>
    </section>

    {detail && <AdminModal title="系統健康紀錄詳細內容" onClose={() => setDetail(null)}>
      <dl className="detail-grid">
        <div><dt>發生時間</dt><dd>{fmtTime(detail.occurred_at)}</dd></div>
        <div><dt>錯誤類型</dt><dd>{KIND_LABELS[String(detail.kind)] || '其他系統錯誤'}</dd></div>
        <div><dt>發生頁面</dt><dd>{pageLabel(detail.page || detail.url)}</dd></div>
        <div><dt>網址</dt><dd>{fmt(detail.url)}</dd></div>
        <div><dt>操作人員</dt><dd>{fmt((detail.users as Row)?.name)}</dd></div>
        <div><dt>瀏覽器</dt><dd>{fmt(detail.user_agent)}</dd></div>
      </dl>
      <pre>{JSON.stringify(detail.detail ?? {}, null, 2)}</pre>
      <footer><button className="primary-btn compact" onClick={() => setDetail(null)}>關閉</button></footer>
    </AdminModal>}
  </AppShell>;
}
