'use client';

// SYS-04 駐警隊電子交接簿。
//
// 班別、班別時段、預定巡檢時段與排定人員一律來自「駐衛警巡檢系統／巡檢排班」，由
// app-api 的 handover_guard_context 在伺服器端解析後提供——交接簿使用者不一定有
// sys_guardpatrol，前端讀不到排班與打卡表。交接簿不能改排班，只能另記實際值勤人員
// 與代班說明。流程：交接中 → 交班簽名 → 接班簽名（鎖定）→ 主管每日簽核（全日鎖定）。
//
// 異常事件附件：上傳用 app-api 簽發的一次性上傳網址（guard_attach_prepare／commit），
// 讀取用限時網址（guard_attachment_url）；影片一律先在瀏覽器壓縮（web/lib/video-compress.ts）。
// 畫面元件在 guard-handover-view.tsx，型別與常數在 guard-handover-shared.ts。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { LocalizedDateTimeInput } from '@/components/LocalizedDateTimeInput';
import { AdminHeader, AdminModal, errorMessage } from '@/components/admin/shared';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { canCompressVideo, compressVideo, isVideoFile } from '@/lib/video-compress';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import {
  DEFAULT_ITEMS, DEFAULT_OPTION_LABELS, GUARD_ATTACHMENT_BUCKET, MAX_ATTACHMENTS_PER_INCIDENT, MAX_ATTACHMENT_BYTES, QTY_PRESETS,
  activityTime, fileSizeLabel, hhmm, liveState, moveDate, newIncidentId, previewKind, rocDate, todayTaipei,
  type Attachment, type GuardContext, type GuardLog, type GuardOptionList, type GuardShift, type Incident, type Item,
} from './guard-handover-shared';
import { AttachmentChips, GuardDailyReport, GuardIcon, GuardShiftCard, GuardSheetHeader, type GuardKpi } from './guard-handover-view';
import { GuardCombo, GuardOptionsPanel } from './guard-handover-controls';
import './handover-sheet.css';
import './guard-handover.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

function defaultIncidentTime(date: string, shift: GuardShift) {
  if (date !== todayTaipei()) return `${date}T${hhmm(shift.shift_start)}`;
  const [day, time] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(' ');
  const [hour, minute] = time.split(':').map(Number);
  return `${day}T${String(hour).padStart(2, '0')}:${String(Math.floor(minute / 5) * 5).padStart(2, '0')}`;
}

export function GuardHandover({ system, module, profile }: Props) {
  const [date, setDate] = useState(todayTaipei());
  const [context, setContext] = useState<GuardContext | null>(null);
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<GuardShift | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [filePreview, setFilePreview] = useState<Attachment | null>(null);
  const [optionsList, setOptionsList] = useState<GuardOptionList | null>(null);
  // 每 30 秒重算一次「當班」，班別交替時畫面自動換色，不必重新載入。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try { setContext(await invokeAppApi<GuardContext>('handover_guard_context', { duty_date: date })); }
    catch (error) { setContext(null); setNote(`失敗：${errorMessage(error, '駐警隊交接資料載入失敗')}`); }
    setBusy(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setApprovalNote(''); }, [date]);
  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  const shifts = useMemo(() => context?.shifts || [], [context]);
  const logs = useMemo(() => context?.logs || [], [context]);
  const attachments = useMemo(() => context?.attachments || [], [context]);
  const approval = context?.approval || null;
  const logFor = useCallback((name: string) => logs.find(log => log.shift_name === name) || null, [logs]);
  const attachmentsFor = useCallback((shiftName: string, incidentId: string) =>
    attachments.filter(file => file.shift_name === shiftName && file.incident_id === incidentId), [attachments]);
  const nameOf = useCallback((id: unknown) => {
    const key = String(id || '');
    return context?.people[key] || (key === profile.user_id ? profile.name : '—');
  }, [context, profile.name, profile.user_id]);
  const namesOf = (ids: string[] | null | undefined) => (ids || []).length ? (ids || []).map(nameOf).join('、') : '—';
  const optionsFor = useCallback((list: GuardOptionList) => {
    if (context && context.options_available === false) return DEFAULT_OPTION_LABELS[list];
    return (context?.options || []).filter(option => option.list_key === list).map(option => option.label);
  }, [context]);
  const canManageOptions = Boolean(context?.can_manage_options);
  const currentShift = shifts.find(shift => (liveState(now, shift.work_from, shift.work_to, shift.state) ?? shift.state) === 'active') || null;
  const optionAction = async (payload: Record<string, unknown>) => { await invokeAppApi('handover_save', payload); await load(); };

  const receivedCount = shifts.filter(shift => logFor(shift.name)?.status === 'received').length;
  const pendingCount = logs.filter(log => log.status !== 'received').length;
  const missingCount = shifts.filter(shift => !logFor(shift.name)).length;
  const canEdit = Boolean(context?.can_edit) && !approval;
  const canApproveNow = Boolean(context?.approval_open) && pendingCount === 0 && (missingCount === 0 || approvalNote.trim().length > 0);
  const approvalHint = !context?.approval_open ? '本日交接須於隔日起由主管簽核。'
    : pendingCount > 0 ? `尚有 ${pendingCount} 班未完成接班，全部接班後才可簽核。`
      : missingCount > 0 ? `有 ${missingCount} 班未建立交接，簽核時須填寫說明。`
        : '本日交接均已完成接班，可進行主管簽核。';

  const kpis = useMemo<GuardKpi[]>(() => {
    const incidentTotal = logs.reduce((sum, log) => sum + (log.incidents?.length || 0), 0);
    const rates = shifts.filter(shift => shift.state !== 'upcoming').map(shift => {
      const log = logs.find(row => row.shift_name === shift.name);
      return (log && log.status !== 'draft' && log.patrol_snapshot ? log.patrol_snapshot : shift.patrol).rate;
    });
    const average = rates.length ? Math.round((rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 10) / 10 : null;
    const received = shifts.filter(shift => logs.some(row => row.shift_name === shift.name && row.status === 'received')).length;
    return [
      { label: '今日班別', value: String(shifts.length), icon: 'clock', tone: 'cyan' },
      { label: '完成接班', value: `${received} / ${shifts.length}`, icon: 'check', tone: shifts.length && received === shifts.length ? 'green' : 'violet' },
      { label: '異常事件', value: `${incidentTotal} 件`, icon: 'alert', tone: incidentTotal ? 'red' : 'green' },
      { label: '巡邏平均完成率', value: average === null ? '—' : `${average}%`, icon: 'route', tone: average === null ? 'cyan' : average >= 100 ? 'green' : average >= 60 ? 'amber' : 'red' },
    ];
  }, [logs, shifts]);

  const run = async (kind: string, payload: Record<string, unknown>, done: string, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setActing(true); setNote('');
    try { await invokeAppApi('handover_save', { kind, ...payload }); await load(); setNote(done); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); }
    setActing(false);
  };
  const defaultItemsFor = (shift: GuardShift) => {
    const index = shifts.findIndex(row => row.name === shift.name);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = logFor(shifts[cursor].name);
      if (previous?.items?.length) return previous.items;
    }
    return context?.previous_items?.length ? context.previous_items : DEFAULT_ITEMS;
  };
  const actionsFor = (shift: GuardShift, log: GuardLog | null) => <>
    {!log && canEdit && <button type="button" className="primary-btn compact" onClick={() => setEditing(shift)}>建立交接</button>}
    {log?.status === 'draft' && canEdit && <>
      <button type="button" className="secondary-btn compact" onClick={() => setEditing(shift)}>編輯交接</button>
      <button type="button" className="primary-btn compact" disabled={acting}
        onClick={() => void run('guard_submit', { duty_date: date, shift_name: shift.name }, `${shift.name}已交班簽名，等待接班人確認`,
          `確認以「${profile.name}」身分交班簽名？送出後內容與附件鎖定，只能在接班前撤回。`)}>交班簽名送出</button>
    </>}
    {log?.status === 'submitted' && canEdit && (log.handover_by === profile.user_id
      ? <button type="button" className="secondary-btn compact" disabled={acting}
        onClick={() => void run('guard_withdraw', { duty_date: date, shift_name: shift.name }, `${shift.name}已撤回交班，可再修改`, '確認撤回交班簽名？撤回後可再修改內容。')}>撤回交班</button>
      : <button type="button" className="primary-btn compact" disabled={acting}
        onClick={() => void run('guard_receive', { duty_date: date, shift_name: shift.name }, `${shift.name}已完成接班簽名`,
          `確認以「${profile.name}」身分接班簽名？簽名後本班交接內容鎖定。`)}>接班簽名確認</button>)}
  </>;

  const report = { date, shifts, approval, logFor, nameOf, namesOf, attachmentCount: (shiftName: string, incidentId: string) => attachmentsFor(shiftName, incidentId).length };

  return <AppShell profile={profile} title={module.title} heading={{ system, module }}>
    <div className="hs-page">
      <AdminHeader module={module} busy={busy || acting} note={note} onReload={load}
        action={<>{canManageOptions && <button type="button" className="secondary-btn compact" onClick={() => setOptionsList('incident_category')}>管理下拉選單</button>}<button type="button" className="secondary-btn compact" disabled={!context} onClick={() => setPreviewOpen(true)}>預覽日報表</button><button type="button" className="primary-btn compact" disabled={!context} onClick={() => window.print()}>列印本日報表</button></>} />
      <section className="panel hs-toolbar">
        <div className="hs-date-nav">
          <button type="button" className="secondary-btn compact" aria-label="前一天" onClick={() => setDate(current => moveDate(current, -1))}>‹</button>
          <label>值班日期<LocalizedDateInput aria-label="值班日期（年/月/日）" value={date} onChange={event => setDate(event.target.value)} /></label>
          <button type="button" className="secondary-btn compact" aria-label="後一天" onClick={() => setDate(current => moveDate(current, 1))}>›</button>
          <button type="button" className="secondary-btn compact" onClick={() => setDate(todayTaipei())}>回到今天</button>
        </div>
        <div className="hs-toolbar-right">
          {currentShift && <span className="hs-current-now"><i className="hs-pulse-dot" aria-hidden="true" />目前當班：{currentShift.name}（{hhmm(currentShift.shift_start)}–{hhmm(currentShift.shift_end)}）</span>}
          <span className="hs-toolbar-summary"><GuardIcon name="calendar" size={15} />{rocDate(date)} · {shifts.length} 個班別 · 已接班 {receivedCount} 班</span>
        </div>
      </section>

      {context && <section className={`hs-approval${approval ? ' is-approved' : canApproveNow ? ' is-ready' : ''}`} aria-label="主管簽核">
        <div className="hs-approval-main">
          <span className="hs-approval-icon"><GuardIcon name={approval ? 'check' : 'pen'} size={22} /></span>
          <div>
            <strong>{approval ? `主管已簽核：${nameOf(approval.approver_id)}` : '主管每日簽核'}</strong>
            <span>{approval ? `${activityTime(approval.approved_at)}${approval.note ? `・說明：${approval.note}` : ''}（簽核後本日交接全部鎖定）` : approvalHint}</span>
          </div>
        </div>
        {!approval && context.can_approve && <div className="hs-approval-actions">
          {missingCount > 0 && <input value={approvalNote} maxLength={500} onChange={event => setApprovalNote(event.target.value)} placeholder={`有 ${missingCount} 班未建立交接，請填寫說明`} aria-label="簽核說明" />}
          <button type="button" className="primary-btn compact" disabled={acting || !canApproveNow}
            onClick={() => void run('guard_approve', { duty_date: date, note: approvalNote.trim() }, '主管簽核完成，本日交接已全部鎖定',
              `確認以「${profile.name}」身分完成 ${rocDate(date)} 的主管簽核？簽核後本日交接全部鎖定，不可再修改。`)}>主管簽核</button>
        </div>}
      </section>}

      <section className="hs-sheet" aria-label="駐警隊電子交接簿">
        <GuardSheetHeader date={date} kpis={context ? kpis : []} />
        <div className="hs-shifts">
          {busy && !context ? <p className="hs-empty">載入中…</p>
            : !shifts.length ? <p className="hs-empty">巡檢排班沒有任何啟用中的班別範本，請先至「駐衛警巡檢系統 → 巡檢排班」設定班別。</p>
              : shifts.map((shift, index) => {
                const log = logFor(shift.name);
                return <GuardShiftCard key={shift.name} index={index} shift={shift} log={log} nameOf={nameOf} namesOf={namesOf}
                  actions={actionsFor(shift, log)} canEdit={canEdit} attachmentsFor={attachmentsFor} onPreview={setFilePreview} now={now} />;
              })}
        </div>
      </section>

      {/* 預覽與列印共用同一個報表元件：畫面上看到的就是印出來的內容。 */}
      {context && <div className="hs-print-sheet"><GuardDailyReport {...report} /></div>}
      {previewOpen && context && <div className="hs-preview" role="dialog" aria-modal="true" aria-label="駐警隊交接日報表預覽">
        <div className="hs-preview-bar">
          <div><strong>日報表預覽</strong><span>{rocDate(date)} · A4 直式，與列印內容相同</span></div>
          <div><button type="button" className="primary-btn compact" onClick={() => window.print()}>列印</button><button type="button" className="secondary-btn compact" onClick={() => setPreviewOpen(false)}>關閉預覽</button></div>
        </div>
        <div className="hs-preview-scroll"><div className="hs-preview-paper"><GuardDailyReport {...report} /></div></div>
      </div>}
    </div>
    {editing && context && <GuardLogModal date={date} shift={editing} log={logFor(editing.name)} staff={context.staff} people={context.people}
      defaultItems={defaultItemsFor(editing)} shiftAttachments={attachments.filter(file => file.shift_name === editing.name)}
      optionsFor={optionsFor} onManage={canManageOptions ? setOptionsList : undefined}
      onPreview={setFilePreview}
      onClose={() => { setEditing(null); void load(); }}
      onSaved={async () => { const name = editing.name; setEditing(null); await load(); setNote(`${name}交接內容已儲存`); }} />}
    {filePreview && <GuardFilePreview file={filePreview} onClose={() => setFilePreview(null)} />}
    {optionsList && context && <AdminModal className="guard-options-modal" title="管理下拉選單" onClose={() => setOptionsList(null)}>
      <GuardOptionsPanel options={context.options || []} list={optionsList} onListChange={setOptionsList} busy={busy}
        onAdd={(list, label) => optionAction({ kind: 'guard_option_save', list_key: list, label })}
        onRename={(option, label) => optionAction({ kind: 'guard_option_save', list_key: option.list_key, option_id: option.option_id, label })}
        onDelete={option => optionAction({ kind: 'guard_option_delete', option_id: option.option_id })}
        onMove={(option, direction) => optionAction({ kind: 'guard_option_move', option_id: option.option_id, direction })} />
    </AdminModal>}
  </AppShell>;
}

function GuardFilePreview({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const [urls, setUrls] = useState<{ url: string; download_url: string } | null>(null);
  const [error, setError] = useState('');
  const [broken, setBroken] = useState(false);
  const kind = previewKind(file.content_type, file.file_name);
  useEffect(() => {
    let alive = true;
    invokeAppApi<{ url: string; download_url: string }>('guard_attachment_url', { attachment_id: file.attachment_id })
      .then(data => { if (alive) setUrls(data); })
      .catch(reason => { if (alive) setError(errorMessage(reason, '附件網址產生失敗')); });
    return () => { alive = false; };
  }, [file.attachment_id]);
  // 限時網址指向 Storage 網域；以新分頁開啟不受本站 CSP 限制，也不會把本站權杖帶過去。
  const openTab = (href: string) => { window.open(href, '_blank', 'noopener,noreferrer'); };

  return <AdminModal className="guard-file-modal" title={`附件預覽｜${file.file_name}`} onClose={onClose}>
    <div className="guard-file-view">
      <div className="guard-file-stage">
        {error ? <p>{error}</p>
          : !urls ? <p>載入中…</p>
            : broken || kind === 'none' ? <div className="guard-file-fallback"><GuardIcon name="file" size={44} />
              <p>{broken ? '瀏覽器無法顯示此檔案。' : '此格式無法在瀏覽器內預覽。'}請下載後以對應程式開啟。</p></div>
              : kind === 'image' ? <img src={urls.url} alt={file.file_name} onError={() => setBroken(true)} />
                : kind === 'video' ? <video src={urls.url} controls playsInline preload="metadata" onError={() => setBroken(true)} />
                  : kind === 'audio' ? <audio src={urls.url} controls preload="metadata" onError={() => setBroken(true)} />
                    : <div className="guard-file-fallback"><GuardIcon name="doc" size={44} /><p>PDF 會在新分頁開啟預覽。</p>
                      <button type="button" className="primary-btn compact" onClick={() => openTab(urls.url)}>在新分頁開啟 PDF</button></div>}
      </div>
      <div className="guard-file-meta">
        <span>{fileSizeLabel(file.file_size)}{file.compressed && file.original_size ? `（原始 ${fileSizeLabel(file.original_size)}，已壓縮）` : ''} · 上傳於 {activityTime(file.uploaded_at)}</span>
        <div>
          <button type="button" className="secondary-btn compact" disabled={!urls} onClick={() => { if (urls) openTab(urls.download_url); }}>下載</button>
          <button type="button" className="secondary-btn compact" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  </AdminModal>;
}

type UploadTask = { key: string; incidentId: string; name: string; stage: string; progress: number | null; error?: string };

function GuardLogModal({ date, shift, log, staff, people, defaultItems, shiftAttachments, optionsFor, onManage, onPreview, onClose, onSaved }: {
  date: string; shift: GuardShift; log: GuardLog | null; staff: { user_id: string; name: string }[]; people: Record<string, string>;
  defaultItems: Item[]; shiftAttachments: Attachment[]; optionsFor: (list: GuardOptionList) => string[]; onManage?: (list: GuardOptionList) => void;
  onPreview: (file: Attachment) => void; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [actual, setActual] = useState<string[]>(log?.actual_user_ids?.length ? log.actual_user_ids : shift.scheduled_user_ids);
  const [substitute, setSubstitute] = useState(log?.substitute_note || '');
  const [summary, setSummary] = useState(log?.duty_summary || '');
  const [important, setImportant] = useState(log?.important_notes || '');
  const [incidents, setIncidents] = useState<Incident[]>(() => (log?.incidents || []).map(incident => incident.id ? incident : { ...incident, id: newIncidentId() }));
  const [items, setItems] = useState<Item[]>(log?.items?.length ? log.items : defaultItems.map(item => ({ ...item })));
  const [files, setFiles] = useState<Attachment[]>(shiftAttachments);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const scheduled = useMemo(() => new Set(shift.scheduled_user_ids), [shift.scheduled_user_ids]);
  const differs = actual.length !== scheduled.size || actual.some(id => !scheduled.has(id));
  // 可勾選 = 駐警單位人員 ∪ 排定人員 ∪ 已勾選人員。已指派的人一定要看得到，才取消得掉。
  const choices = useMemo(() => {
    const map = new Map(staff.map(person => [person.user_id, person.name] as const));
    for (const id of [...shift.scheduled_user_ids, ...actual]) if (!map.has(id)) map.set(id, people[id] || '（未知人員）');
    return [...map].map(([userId, name]) => ({ user_id: userId, name }));
  }, [staff, people, shift.scheduled_user_ids, actual]);
  const uploading = tasks.some(task => !task.error);
  const filesFor = (incidentId: string) => files.filter(file => file.incident_id === incidentId);

  const toggle = (id: string) => setActual(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const updateItem = (index: number, patch: Partial<Item>) => setItems(current => current.map((item, cursor) => cursor === index ? { ...item, ...patch } : item));
  const updateIncident = (index: number, patch: Partial<Incident>) => setIncidents(current => current.map((incident, cursor) => cursor === index ? { ...incident, ...patch } : incident));
  const patchTask = (key: string, patch: Partial<UploadTask>) => setTasks(current => current.map(task => task.key === key ? { ...task, ...patch } : task));
  const removeIncident = (index: number) => {
    const count = filesFor(incidents[index].id).length;
    if (count && !window.confirm(`這件異常事件有 ${count} 個附件，移除事件後附件也會一併移除（儲存交接內容後生效）。確定移除？`)) return;
    setIncidents(current => current.filter((_, cursor) => cursor !== index));
  };

  const upload = async (incidentId: string, list: File[]) => {
    for (const original of list) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setTasks(current => [...current, { key, incidentId, name: original.name, stage: '準備中', progress: null }]);
      try {
        let file = original;
        let compressed = false;
        if (isVideoFile(original)) {
          if (!canCompressVideo()) throw new Error('此瀏覽器不支援影片壓縮，請改用電腦版 Chrome 或 Edge 上傳影片');
          patchTask(key, { stage: '壓縮影片中（請停留在此頁）', progress: 0 });
          file = await compressVideo(original, ratio => patchTask(key, { progress: Math.round(ratio * 100) }));
          compressed = true;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${compressed ? '壓縮後仍' : ''}超過單檔 ${MAX_ATTACHMENT_BYTES / 1048576} MB 上限`);
        patchTask(key, { stage: '上傳中', progress: null });
        const meta = { duty_date: date, shift_name: shift.name, incident_id: incidentId, file_name: file.name, file_size: file.size, content_type: file.type || 'application/octet-stream' };
        const prepared = await invokeAppApi<{ path: string; token: string; content_type: string }>('handover_save', { kind: 'guard_attach_prepare', ...meta });
        const uploaded = await getSupabase().storage.from(GUARD_ATTACHMENT_BUCKET).uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: prepared.content_type });
        if (uploaded.error) throw uploaded.error;
        const row = await invokeAppApi<Attachment>('handover_save', { kind: 'guard_attach_commit', ...meta, path: prepared.path, original_size: original.size, compressed });
        setFiles(current => [...current, row]);
        patchTask(key, { stage: compressed ? `完成（${fileSizeLabel(original.size)} → ${fileSizeLabel(file.size)}）` : '完成', progress: 100 });
        window.setTimeout(() => setTasks(current => current.filter(task => task.key !== key)), 2500);
      } catch (error) {
        patchTask(key, { error: errorMessage(error, '上傳失敗') });
      }
    }
  };
  const detach = async (file: Attachment) => {
    if (!window.confirm(`確定移除附件「${file.file_name}」？移除後保留稽核紀錄，但不再顯示。`)) return;
    try {
      await invokeAppApi('handover_save', { kind: 'guard_detach', attachment_id: file.attachment_id });
      setFiles(current => current.filter(row => row.attachment_id !== file.attachment_id));
    } catch (error) { setMessage(errorMessage(error)); }
  };

  const save = async () => {
    if (uploading) return setMessage('附件仍在壓縮或上傳中，請稍候再儲存');
    if (!actual.length) return setMessage('請至少勾選一位實際值勤人員');
    if (differs && !substitute.trim()) return setMessage('實際值勤人員與巡檢排班不同，請填寫代班說明');
    if (items.some(item => !item.name.trim() || !item.condition.trim())) return setMessage('物品點交有尚未填寫名稱或狀態的項目');
    if (incidents.some(incident => !incident.time || !incident.category || !incident.description.trim())) return setMessage('異常事件請填寫發生時間、類別與事件經過');
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', {
        kind: 'guard_save', duty_date: date, shift_name: shift.name, actual_user_ids: actual,
        substitute_note: substitute.trim(), duty_summary: summary.trim(), important_notes: important.trim(), incidents, items,
      });
      await onSaved();
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };

  return <AdminModal className="guard-modal" title={`${log ? '編輯' : '建立'}交接｜${shift.name}（${hhmm(shift.shift_start)}–${hhmm(shift.shift_end)}）`} onClose={onClose}>
    <div className="guard-form">
      <fieldset><legend><GuardIcon name="users" size={16} />值勤人員</legend>
        <small>排定人員（巡檢排班）：{shift.scheduled_user_ids.length ? shift.scheduled_user_ids.map(id => people[id] || '（未知人員）').join('、') : '尚未排定'}</small>
        <div className="guard-staff-picker">{choices.map(person => <label key={person.user_id}>
          <input type="checkbox" checked={actual.includes(person.user_id)} onChange={() => toggle(person.user_id)} />{person.name}{scheduled.has(person.user_id) ? '（排定）' : ''}
        </label>)}</div>
        <label>代班說明{differs ? '（必填）' : ''}<input value={substitute} maxLength={500} onChange={event => setSubstitute(event.target.value)} placeholder="例：原排定人員請假，由某某代班" /></label>
      </fieldset>
      <fieldset><legend><GuardIcon name="note" size={16} />勤務概況</legend>
        <label>安全狀況概述<textarea rows={4} value={summary} maxLength={4000} onChange={event => setSummary(event.target.value)} placeholder="本班門禁、巡邏與場區整體狀況；無特殊狀況請填「本班勤務正常」" /><small>交班簽名送出時為必填。</small></label>
        <label>重要交辦事項<textarea rows={3} value={important} maxLength={4000} onChange={event => setImportant(event.target.value)} placeholder="需要下一班接續處理或特別留意的事項" /></label>
      </fieldset>
      <fieldset><legend><GuardIcon name="alert" size={16} />異常事件（{incidents.length} 件）</legend>
        <div className="guard-row-editor">{incidents.map((incident, index) => {
          const incidentFiles = filesFor(incident.id);
          const incidentTasks = tasks.filter(task => task.incidentId === incident.id);
          return <div className="guard-incident-row" key={incident.id}>
            <label>發生時間<LocalizedDateTimeInput value={incident.time} onChange={value => updateIncident(index, { time: value })} ariaLabel={`第 ${index + 1} 件異常事件發生時間`} stepMinutes={5} /></label>
            <div className="guard-field"><span>地點</span><GuardCombo value={incident.location} onChange={value => updateIncident(index, { location: value })} options={optionsFor('location')}
              ariaLabel={`第 ${index + 1} 件異常事件地點`} placeholder="例：B1 卸貨區" maxLength={100} onManage={onManage && (() => onManage('location'))} manageLabel="管理地點清單" /></div>
            <div className="guard-field"><span>類別</span><GuardCombo value={incident.category} onChange={value => updateIncident(index, { category: value })} options={optionsFor('incident_category')}
              ariaLabel={`第 ${index + 1} 件異常事件類別`} placeholder="請選擇或輸入類別" maxLength={40} onManage={onManage && (() => onManage('incident_category'))} manageLabel="管理事件類別清單" /></div>
            <button type="button" className="danger-btn compact" onClick={() => removeIncident(index)}>移除</button>
            <label className="wide">事件經過<textarea rows={2} value={incident.description} maxLength={2000} onChange={event => updateIncident(index, { description: event.target.value })} /></label>
            <label className="wide">處理情形<textarea rows={2} value={incident.action} maxLength={2000} onChange={event => updateIncident(index, { action: event.target.value })} /></label>
            <div className="guard-field wide"><span>通報對象</span><GuardCombo value={incident.reported_to} onChange={value => updateIncident(index, { reported_to: value })} options={optionsFor('reported_to')}
              ariaLabel={`第 ${index + 1} 件異常事件通報對象`} placeholder="例：指揮台" maxLength={100} onManage={onManage && (() => onManage('reported_to'))} manageLabel="管理通報對象清單" /></div>
            <div className="guard-incident-files">
              <div className="guard-incident-files-head">
                <span><GuardIcon name="clip" size={15} />附件（{incidentFiles.length}／{MAX_ATTACHMENTS_PER_INCIDENT}）</span>
                <label className={`secondary-btn compact guard-upload${incidentFiles.length >= MAX_ATTACHMENTS_PER_INCIDENT ? ' is-disabled' : ''}`}>＋ 上傳檔案
                  <input type="file" multiple disabled={incidentFiles.length >= MAX_ATTACHMENTS_PER_INCIDENT}
                    onChange={event => { const picked = event.target.files ? [...event.target.files] : []; event.target.value = ''; void upload(incident.id, picked); }} /></label>
              </div>
              <small>格式不限，單檔上限 {MAX_ATTACHMENT_BYTES / 1048576} MB。影片會先在瀏覽器壓縮再上傳，壓縮時間約等於影片長度，期間請停留在此頁。</small>
              <AttachmentChips files={incidentFiles} onPreview={onPreview} onRemove={file => void detach(file)} />
              {incidentTasks.length > 0 && <ul className="guard-upload-tasks">{incidentTasks.map(task => <li key={task.key} className={task.error ? 'is-error' : ''}>
                <span className="guard-upload-name">{task.name}</span>
                <span>{task.error ? `失敗：${task.error}` : `${task.stage}${task.progress !== null && task.progress < 100 ? ` ${task.progress}%` : ''}`}</span>
                {!task.error && <div className={`guard-progress${task.progress === null ? ' is-indeterminate' : ''}`}><span className="is-ok" style={{ width: `${task.progress ?? 40}%` }} /></div>}
              </li>)}</ul>}
            </div>
          </div>;
        })}</div>
        <button type="button" className="secondary-btn compact" disabled={incidents.length >= 50}
          onClick={() => setIncidents(current => [...current, { id: newIncidentId(), time: defaultIncidentTime(date, shift), location: '', category: '', description: '', action: '', reported_to: '' }])}>＋ 新增異常事件</button>
        {!incidents.length && <small>本班無異常事件時免填。</small>}
      </fieldset>
      <fieldset><legend><GuardIcon name="box" size={16} />物品點交（{items.length} 項）</legend>
        <div className="guard-row-editor">{items.map((item, index) => <div className="guard-item-row" key={index}>
          <div className="guard-field"><span>物品</span><GuardCombo value={item.name} onChange={value => updateItem(index, { name: value })} options={optionsFor('item_name')}
            ariaLabel={`第 ${index + 1} 項點交物品`} placeholder="請選擇或輸入物品" maxLength={50} onManage={onManage && (() => onManage('item_name'))} manageLabel="管理物品清單" /></div>
          <div className="guard-field"><span>數量</span><GuardCombo value={String(item.qty)} options={QTY_PRESETS.map(String)} ariaLabel={`第 ${index + 1} 項點交物品數量`} inputMode="numeric" maxLength={3}
            onChange={value => { const qty = Number(value); if (value !== '' && Number.isInteger(qty) && qty >= 0 && qty <= 999) updateItem(index, { qty }); else setMessage('數量請輸入 0 至 999 的整數'); }} /></div>
          <div className="guard-field"><span>狀態</span><GuardCombo value={item.condition} onChange={value => updateItem(index, { condition: value })} options={optionsFor('item_condition')}
            ariaLabel={`第 ${index + 1} 項點交物品狀態`} maxLength={20} onManage={onManage && (() => onManage('item_condition'))} manageLabel="管理物品狀態清單" /></div>
          <label>備註<input value={item.note} maxLength={200} onChange={event => updateItem(index, { note: event.target.value })} /></label>
          <button type="button" className="danger-btn compact" onClick={() => setItems(current => current.filter((_, cursor) => cursor !== index))}>移除</button>
        </div>)}</div>
        <button type="button" className="secondary-btn compact" disabled={items.length >= 40}
          onClick={() => setItems(current => [...current, { name: '', qty: 1, condition: '正常', note: '' }])}>＋ 新增點交物品</button>
        <small>預設帶入上一班的點交結果，請依實際清點修改數量與狀態。</small>
      </fieldset>
    </div>
    {message && <p role="alert" className="inline-message danger">{message}</p>}
    <footer><button type="button" className="secondary-btn" onClick={onClose}>取消</button><button type="button" className="primary-btn compact" disabled={busy || uploading} onClick={() => void save()}>{busy ? '儲存中…' : uploading ? '附件處理中…' : '儲存交接內容'}</button></footer>
  </AdminModal>;
}
