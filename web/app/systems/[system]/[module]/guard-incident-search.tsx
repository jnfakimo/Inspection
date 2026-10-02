'use client';

import { useEffect, useState } from 'react';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { errorMessage } from '@/components/admin/shared';
import { invokeAppApi } from '@/lib/supabase';
import type { HandoverMarket } from '@/lib/handover-market';
import { incidentTime, moveDate, todayTaipei, type Incident } from './guard-handover-shared';

type SearchField = 'event' | 'name' | 'id_number' | 'phone';
type Result = { duty_date: string; shift_name: string; status: string; incident: Incident };

export function GuardIncidentSearch({ market, canSearchPersonal }: { market: HandoverMarket; canSearchPersonal: boolean }) {
  const [from, setFrom] = useState(() => moveDate(todayTaipei(), -30));
  const [to, setTo] = useState(todayTaipei());
  const [field, setField] = useState<SearchField>('event');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setResults(null); setMessage(''); setField('event'); setQuery(''); }, [market]);

  const search = async () => {
    setBusy(true); setMessage(''); setResults(null);
    try {
      const data = await invokeAppApi<{ results: Result[]; truncated: boolean }>('handover_guard_incident_search', {
        market_code: market, date_from: from, date_to: to, field, query: query.trim(),
      });
      setResults(data.results); setTruncated(data.truncated);
    } catch (error) { setMessage(`搜尋失敗：${errorMessage(error)}`); }
    setBusy(false);
  };

  return <section className="panel guard-incident-search" aria-label="異常事件搜尋">
    <h2>異常事件搜尋</h2>
    <p>依日期與關鍵字搜尋本市場交接紀錄；每次最多查詢 90 天。{canSearchPersonal
      ? '主管可使用姓名、完整身分證字號或完整電話查詢。'
      : '一般人員只能搜尋已遮蔽的事件內容，個資欄位不提供查詢。'}</p>
    <div className="guard-incident-search-controls">
      <label>起日<LocalizedDateInput value={from} onChange={event => setFrom(event.target.value)} aria-label="異常事件搜尋起日" /></label>
      <label>迄日<LocalizedDateInput value={to} onChange={event => setTo(event.target.value)} aria-label="異常事件搜尋迄日" /></label>
      <label>搜尋欄位<select value={field} onChange={event => setField(event.target.value as SearchField)}>
        <option value="event">事件內容</option>
        {canSearchPersonal && <><option value="name">姓名</option><option value="id_number">身分證字號</option><option value="phone">電話</option></>}
      </select></label>
      <label>關鍵字<input value={query} maxLength={80} autoComplete="off" placeholder={field === 'event' ? '輸入類別、地點或事件內容' : field === 'name' ? '輸入姓名' : field === 'id_number' ? '輸入完整身分證字號' : '輸入完整電話'}
        onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search(); }} /></label>
      <button type="button" className="primary-btn compact" disabled={busy || query.trim().length < 2} onClick={() => void search()}>{busy ? '搜尋中…' : '搜尋'}</button>
    </div>
    {message && <p role="alert" className="inline-message danger">{message}</p>}
    {results && <div className="guard-incident-search-results" aria-live="polite">
      <strong>搜尋結果：{results.length} 件{truncated ? '（僅顯示前 100 件，請縮小日期範圍）' : ''}</strong>
      {results.length ? <ol>{results.map((result, index) => <li key={`${result.duty_date}:${result.shift_name}:${result.incident.id}:${index}`}>
        <div><b>{result.duty_date} · {result.shift_name}</b><span>{incidentTime(result.incident.time)} · {result.incident.category} · {result.incident.location || '地點未填'}</span></div>
        <p>{result.incident.description}</p>
        {result.incident.action && <p><b>處理：</b>{result.incident.action}</p>}
        {(result.incident.persons || []).length > 0 && <p><b>相關人員：</b>{(result.incident.persons || []).map(person =>
          `${person.name}${person.id_number ? `／身分證 ${person.id_number}` : ''}${person.phone ? `／電話 ${person.phone}` : ''}`).join('；')}</p>}
      </li>)}</ol> : <p>此期間沒有符合條件的異常事件。</p>}
    </div>}
  </section>;
}
