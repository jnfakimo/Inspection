'use client';

import { useState } from 'react';
import { AdminModal, errorMessage } from '@/components/admin/shared';
import { LocalizedDateTimeInput } from '@/components/LocalizedDateTimeInput';
import { invokeAppApi } from '@/lib/supabase';
import type { HandoverMarket } from '@/lib/handover-market';
import { activityTime, type GuardCorrection, type GuardCorrectionValues, type GuardLog, type Incident, type Item } from './guard-handover-shared';

function flagLabel(value: boolean | null | undefined) { return value === true ? '是' : value === false ? '否' : '未設定'; }
function incidentText(row: Incident) {
  return `${row.time} ${row.location || '—'}｜${row.category}｜${row.description}｜處理：${row.action || '—'}｜通報：${row.reported_to || '—'}｜交接項目：${flagLabel(row.handover_item)}｜向上陳報：${flagLabel(row.reported_upward)}`;
}
function itemText(row: Item) { return `${row.name} × ${row.qty}｜${row.condition}｜${row.note || '—'}`; }

export function GuardCorrectionModal({ market, log, corrections, canCorrect, nameOf, onClose, onDone }: {
  market: HandoverMarket; log: GuardLog; corrections: GuardCorrection[]; canCorrect: boolean;
  nameOf: (id: unknown) => string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const latest = corrections[corrections.length - 1];
  const source = latest?.after_values || log;
  const [summary, setSummary] = useState(source.duty_summary);
  const [important, setImportant] = useState(source.important_notes);
  const [incidents, setIncidents] = useState<Incident[]>(() => source.incidents.map(row => ({ ...row })));
  const [items, setItems] = useState<Item[]>(() => source.items.map(row => ({ ...row })));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const updateIncident = (index: number, patch: Partial<Incident>) => setIncidents(current => current.map((row, cursor) => cursor === index ? { ...row, ...patch } : row));
  const updateItem = (index: number, patch: Partial<Item>) => setItems(current => current.map((row, cursor) => cursor === index ? { ...row, ...patch } : row));
  const save = async () => {
    if (!summary.trim()) return setMessage('請填寫勤務概況');
    if (incidents.some(row => !row.time || !row.category.trim() || !row.description.trim())) return setMessage('異常事件時間、類別及經過不可留白');
    if (items.some(row => !row.name.trim() || !row.condition.trim() || !Number.isInteger(row.qty) || row.qty < 0 || row.qty > 999)) return setMessage('物品名稱、狀態及數量無效');
    const after_values: GuardCorrectionValues = { duty_summary: summary.trim(), important_notes: important.trim(), incidents, items };
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', { kind: 'guard_supervisor_correction', market_code: market, log_id: log.log_id,
        expected_updated_at: log.updated_at, expected_correction: latest?.correction_id || null, after_values });
      await onDone();
    } catch (error) { setMessage(`儲存失敗：${errorMessage(error)}`); setBusy(false); }
  };
  return <AdminModal className="guard-correction-modal" backdropClassName="guard-correction-backdrop" title={`${canCorrect ? '主管修正' : '主管修正紀錄'}｜${log.shift_name}`} onClose={onClose}>
    <div className="guard-correction-content">
      <p className="guard-correction-intro">修正會更新日報表顯示，原始交接、簽名和簽核保留；每次修正記錄帳號、時間及修改前後內容。異常事件的新增與刪除仍須依原交接流程處理。</p>
      {canCorrect && <>
        <label>勤務概況<textarea rows={3} maxLength={4000} value={summary} onChange={event => setSummary(event.target.value)} /></label>
        <label>重要交辦<textarea rows={3} maxLength={4000} value={important} onChange={event => setImportant(event.target.value)} /></label>
        <fieldset><legend>異常事件（{incidents.length} 件）</legend>
          {incidents.length ? incidents.map((row, index) => <div className="guard-correction-row" key={row.id}>
            <strong>第 {index + 1} 件 · {row.id.slice(0, 8)}</strong>
            <div className="guard-correction-grid">
              <label>發生時間<LocalizedDateTimeInput value={row.time} onChange={value => updateIncident(index, { time: value })} ariaLabel={`第 ${index + 1} 件異常事件發生時間`} stepMinutes={5} /></label>
              <label>地點<input maxLength={100} value={row.location} onChange={event => updateIncident(index, { location: event.target.value })} /></label>
              <label>類別<input maxLength={40} value={row.category} onChange={event => updateIncident(index, { category: event.target.value })} /></label>
              <label>通報對象<input maxLength={100} value={row.reported_to} onChange={event => updateIncident(index, { reported_to: event.target.value })} /></label>
            </div>
            <label>事件經過<textarea rows={2} maxLength={2000} value={row.description} onChange={event => updateIncident(index, { description: event.target.value })} /></label>
            <label>處理情形<textarea rows={2} maxLength={2000} value={row.action} onChange={event => updateIncident(index, { action: event.target.value })} /></label>
            <div className="guard-correction-grid">
              <label>是否交接項目<select value={row.handover_item == null ? '' : String(row.handover_item)} onChange={event => updateIncident(index, { handover_item: event.target.value === '' ? null : event.target.value === 'true' })}><option value="">未設定</option><option value="true">是</option><option value="false">否</option></select></label>
              <label>是否向上陳報<select value={row.reported_upward == null ? '' : String(row.reported_upward)} onChange={event => updateIncident(index, { reported_upward: event.target.value === '' ? null : event.target.value === 'true' })}><option value="">未設定</option><option value="true">是</option><option value="false">否</option></select></label>
            </div>
          </div>) : <p>本班沒有異常事件。</p>}
        </fieldset>
        <fieldset><legend>物品點交（{items.length} 項）</legend>
          {items.map((row, index) => <div className="guard-correction-item" key={index}>
            <label>物品<input maxLength={50} value={row.name} onChange={event => updateItem(index, { name: event.target.value })} /></label>
            <label>數量<input type="number" min={0} max={999} value={row.qty} onChange={event => updateItem(index, { qty: Number(event.target.value) })} /></label>
            <label>狀態<input maxLength={20} value={row.condition} onChange={event => updateItem(index, { condition: event.target.value })} /></label>
            <label>備註<input maxLength={200} value={row.note} onChange={event => updateItem(index, { note: event.target.value })} /></label>
            <button type="button" className="danger-btn compact" onClick={() => setItems(current => current.filter((_, cursor) => cursor !== index))}>移除</button>
          </div>)}
          <button type="button" className="secondary-btn compact" disabled={items.length >= 40} onClick={() => setItems(current => [...current, { name: '', qty: 1, condition: '正常', note: '' }])}>新增點交物品</button>
        </fieldset>
      </>}
      <section className="guard-correction-history" aria-label="主管修正歷程"><h3>修正歷程 · {corrections.length} 次</h3>
        {corrections.length ? [...corrections].reverse().map(row => {
          const before = row.before_values, after = row.after_values;
          const changes = [
            ['勤務概況', before.duty_summary, after.duty_summary], ['重要交辦', before.important_notes, after.important_notes],
            ...before.incidents.flatMap((event, index) => {
              const current = after.incidents[index];
              return current && incidentText(event) !== incidentText(current) ? [[`第 ${index + 1} 件異常事件`, incidentText(event), incidentText(current)]] : [];
            }),
            ['物品點交', before.items.map(itemText).join('\n'), after.items.map(itemText).join('\n')],
          ];
          return <article key={row.correction_id}><strong>{activityTime(row.corrected_at)} · {nameOf(row.corrected_by)}</strong>
            {changes.filter(([, oldValue, newValue]) => oldValue !== newValue).map(([label, oldValue, newValue]) =>
              <div className="guard-correction-change" key={label}><b>{label}</b><span>{oldValue || '—'}</span><span aria-hidden="true">→</span><span>{newValue || '—'}</span></div>)}</article>;
        }) : <p>尚無主管修正紀錄。</p>}
      </section>
      {message && <p role="alert" className="inline-message danger">{message}</p>}
      <footer><button type="button" className="secondary-btn" onClick={onClose}>{canCorrect ? '取消' : '關閉'}</button>{canCorrect && <button type="button" className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存主管修正'}</button>}</footer>
    </div>
  </AdminModal>;
}
