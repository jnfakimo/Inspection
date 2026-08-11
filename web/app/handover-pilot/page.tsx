'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/types/app';

type ShiftCode = 'early' | 'day' | 'late';
type RecordStatus = 'draft' | 'submitted' | 'reviewed' | 'closed';
type HandoverItem = { id: string; text: string; level: 'normal' | 'warning' | 'urgent'; done: boolean };
type Attachment = { name: string; size: number; type: string };
type HandoverRecord = {
  record_id: string;
  record_date: string;
  shift_code: ShiftCode;
  shift_start: string;
  shift_end: string;
  handover_by: string;
  instruction: string;
  items: HandoverItem[];
  notes: string;
  attachments: Attachment[];
  status: RecordStatus;
  updated_at: string;
};

const STORAGE_KEY = 'beINong-handover-field-pilot-v1';
const shifts: Array<{ code: ShiftCode; label: string; time: string; start: string; end: string; tone: string }> = [
  { code: 'early', label: '早段', time: '08:00–10:00', start: '08:00', end: '10:00', tone: 'amber' },
  { code: 'day', label: '日班', time: '10:00–18:00', start: '10:00', end: '18:00', tone: 'cyan' },
  { code: 'late', label: '晚段', time: '18:00–02:00', start: '18:00', end: '02:00', tone: 'violet' },
];

const statusLabels: Record<RecordStatus, string> = { draft: '草稿', submitted: '待批示', reviewed: '已批示', closed: '已封存' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const uid = () => `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function seededRecords(date: string): HandoverRecord[] {
  return shifts.map((shift, index) => ({
    record_id: `seed-${shift.code}`,
    record_date: date,
    shift_code: shift.code,
    shift_start: shift.start,
    shift_end: shift.end,
    handover_by: index === 1 ? '王○○' : '',
    instruction: index === 0 ? '請持續留意卸貨區動線與冷藏設備狀態。' : '',
    items: index === 1 ? [{ id: uid(), text: 'B1 冷凍機房溫度持續觀察', level: 'warning', done: false }] : [],
    notes: '',
    attachments: [],
    status: index === 1 ? 'submitted' : 'draft',
    updated_at: new Date().toISOString(),
  }));
}

function readLocal(date: string): HandoverRecord[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as HandoverRecord[] | null;
    return saved?.filter(row => row.record_date === date).length ? saved.filter(row => row.record_date === date) : seededRecords(date);
  } catch { return seededRecords(date); }
}

function Pilot({ profile }: { profile: Profile }) {
  const [date, setDate] = useState(today);
  const [records, setRecords] = useState<HandoverRecord[]>([]);
  const [selected, setSelected] = useState<ShiftCode>('day');
  const [tab, setTab] = useState<'board' | 'edit' | 'audit'>('board');
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState('');
  const [itemText, setItemText] = useState('');
  const [itemLevel, setItemLevel] = useState<HandoverItem['level']>('warning');

  useEffect(() => {
    setRecords(readLocal(date));
    setOnline(navigator.onLine);
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [date]);

  const current = useMemo(() => records.find(row => row.shift_code === selected) || records[0], [records, selected]);
  const pending = records.filter(row => row.status === 'submitted').length;
  const openItems = records.reduce((count, row) => count + row.items.filter(item => !item.done).length, 0);

  function persist(next: HandoverRecord[], notice = '已暫存於本機，待連線後同步') {
    setRecords(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setMessage(notice);
    window.setTimeout(() => setMessage(''), 2600);
  }

  function updateCurrent(patch: Partial<HandoverRecord>) {
    if (!current) return;
    persist(records.map(row => row.record_id === current.record_id ? { ...row, ...patch, updated_at: new Date().toISOString() } : row));
  }

  async function syncToSupabase(record: HandoverRecord) {
    if (!online) return false;
    const payload: Record<string, unknown> = {
      record_date: record.record_date, shift_code: record.shift_code,
      shift_start: record.shift_start, shift_end: record.shift_end, handover_by: null,
      instruction: record.instruction, items: record.items, notes: record.notes,
      attachments: record.attachments, status: record.status, updated_at: record.updated_at,
    };
    if (!record.record_id.startsWith('seed-') && !record.record_id.startsWith('local-')) payload.record_id = record.record_id;
    const { error } = await getSupabase().from('handover_field_pilot_records').upsert(payload, { onConflict: 'record_date,shift_code' });
    return !error;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const next = records.map(row => row.record_id === current.record_id ? { ...row, status: 'submitted' as RecordStatus, updated_at: new Date().toISOString() } : row);
    persist(next, online ? '交接已送出，等待主管批示' : '目前離線，交接已放入待同步佇列');
    const saved = next.find(row => row.record_id === current.record_id);
    if (saved && await syncToSupabase(saved)) setMessage('交接已送出並同步 Supabase');
    setTab('board');
  }

  function addItem() {
    if (!current || !itemText.trim()) return;
    updateCurrent({ items: [...current.items, { id: uid(), text: itemText.trim(), level: itemLevel, done: false }] });
    setItemText('');
  }

  function toggleItem(id: string) {
    if (!current) return;
    updateCurrent({ items: current.items.map(item => item.id === id ? { ...item, done: !item.done } : item) });
  }

  function attach(event: ChangeEvent<HTMLInputElement>) {
    if (!current || !event.target.files) return;
    const files = Array.from(event.target.files).map(file => ({ name: file.name, size: file.size, type: file.type }));
    updateCurrent({ attachments: [...current.attachments, ...files] });
    event.target.value = '';
  }

  return <AppShell profile={profile} title="電子交接簿｜現場調整版">
    <div className="handover-pilot-head">
      <div><p className="eyebrow">FIELD PILOT / SHIFT LOG</p><h1>值勤交接看板</h1><p className="muted">先把紙本流程變成現場人員真的願意使用的單班卡片。</p></div>
      <div className="pilot-controls"><label>紀錄日期<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span className={`connection-pill ${online ? 'online' : 'offline'}`}><i />{online ? '線上同步' : '離線暫存'}</span></div>
    </div>
    {message && <div className="notice pilot-notice">{message}</div>}
    <section className="pilot-metrics"><article><span>今日班次</span><strong>{records.filter(row => row.status !== 'draft').length}<small>/ 3</small></strong><em>已送出或完成</em></article><article className="amber"><span>待主管批示</span><strong>{pending}</strong><em>需要後續確認</em></article><article className="red"><span>未結事項</span><strong>{openItems}</strong><em>跨班持續追蹤</em></article><article className="green"><span>同步狀態</span><strong>{online ? 'OK' : 'OFF'}</strong><em>{online ? '資料可同步' : '恢復連線自動補送'}</em></article></section>
    <div className="pilot-tabs" role="tablist"><button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}>整日看板</button><button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>填寫交接</button><button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>批示與稽核</button></div>

    {tab === 'board' && <section className="shift-board">{shifts.map(shift => { const row = records.find(item => item.shift_code === shift.code); return <button key={shift.code} className={`shift-card ${shift.tone} ${selected === shift.code ? 'selected' : ''}`} onClick={() => { setSelected(shift.code); setTab('edit'); }}><span className="shift-time">{shift.time}</span><strong>{shift.label}交接</strong><span className="shift-person">{row?.handover_by || '尚未填寫交接人'}</span><span className={`pilot-status ${row?.status || 'draft'}`}>{statusLabels[row?.status || 'draft']}</span><b>{row?.items.filter(item => !item.done).length || 0} 項未結事項　→</b></button>; })}</section>}

    {tab === 'edit' && current && <form className="pilot-editor" onSubmit={submit}><div className="editor-top"><div><span className="eyebrow">CURRENT SHIFT</span><h2>{shifts.find(shift => shift.code === current.shift_code)?.label}交接 <small>{current.shift_start}–{current.shift_end}</small></h2></div><span className={`pilot-status ${current.status}`}>{statusLabels[current.status]}</span></div><div className="editor-grid"><label>交接人員<input value={current.handover_by} onChange={event => updateCurrent({ handover_by: event.target.value })} placeholder="輸入姓名或選擇人員" /></label><label>現場主管<input value={profile.name} readOnly /></label><label className="wide">主任指示／現場批示<textarea value={current.instruction} onChange={event => updateCurrent({ instruction: event.target.value })} rows={3} placeholder="將紙本上的指示與重點轉成可追蹤文字" /></label><div className="wide issue-builder"><div className="section-title"><span>交接事項</span><em>可跨班追蹤</em></div><div className="item-add"><input value={itemText} onChange={event => setItemText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addItem(); } }} placeholder="例如：B1 冷凍機房持續觀察" /><select value={itemLevel} onChange={event => setItemLevel(event.target.value as HandoverItem['level'])}><option value="normal">一般</option><option value="warning">注意</option><option value="urgent">緊急</option></select><button type="button" onClick={addItem}>＋加入</button></div><div className="pilot-item-list">{current.items.length ? current.items.map(item => <div key={item.id} className={`pilot-item ${item.level} ${item.done ? 'done' : ''}`}><button type="button" onClick={() => toggleItem(item.id)} aria-label="標記完成">{item.done ? '✓' : '○'}</button><span>{item.text}</span><em>{item.level === 'urgent' ? '緊急' : item.level === 'warning' ? '注意' : '一般'}</em></div>) : <p className="empty">尚無交接事項</p>}</div></div><label className="wide">備註<textarea value={current.notes} onChange={event => updateCurrent({ notes: event.target.value })} rows={3} placeholder="其他需要說明的事項" /></label><div className="wide attachment-box"><div><strong>現場照片／附件</strong><span>斷線時先記錄檔名，連線後補送</span></div><label className="upload-btn">選取檔案<input type="file" accept="image/*,.pdf" multiple onChange={attach} /></label>{current.attachments.length > 0 && <ul>{current.attachments.map(file => <li key={`${file.name}-${file.size}`}>{file.name}<small>{Math.ceil(file.size / 1024)} KB</small></li>)}</ul>}</div></div><div className="editor-actions"><button type="button" className="secondary-btn" onClick={() => setTab('board')}>返回看板</button><button type="button" className="secondary-btn" onClick={() => persist(records, '草稿已儲存於本機')}>儲存草稿</button><button className="primary-btn">送出交接，等待批示</button></div></form>}

    {tab === 'audit' && <section className="audit-layout"><article className="panel"><div className="panel-head"><h2>狀態流程</h2><span>第一版流程雛形</span></div><div className="status-flow"><div className="done"><i>1</i><span>填寫草稿</span></div><div className="active"><i>2</i><span>送出交接</span></div><div><i>3</i><span>主管批示</span></div><div><i>4</i><span>封存留痕</span></div></div><p className="muted">此頁面先用清楚的狀態與時間軸驗證現場流程；正式簽核角色與通知規則將依試用回饋調整。</p></article><article className="panel"><div className="panel-head"><h2>最近操作</h2><span>本機試用紀錄</span></div><div className="audit-list">{records.map(row => <div key={row.record_id}><i className={`audit-dot ${row.status}`} /><p><strong>{shifts.find(shift => shift.code === row.shift_code)?.label}交接｜{statusLabels[row.status]}</strong><small>{row.updated_at ? new Date(row.updated_at).toLocaleString('zh-TW', { hour12: false }) : '尚無時間'}　·　{row.handover_by || '未填交接人'}</small></p></div>)}</div></article></section>}
  </AppShell>;
}

export default function Page() { return <AuthGate>{profile => <Pilot profile={profile} />}</AuthGate>; }
