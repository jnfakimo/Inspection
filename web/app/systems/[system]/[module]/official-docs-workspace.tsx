'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Department = { dept_id: string; parent_id?: string | null; name: string; code?: string | null; level?: number | null };
type Person = { user_id: string; name: string; dept_id?: string | null; role?: string | null; rbac_role?: string | null; department?: string | null; department_root?: string | null; department_root_id?: string | null; department_level?: number | null };
type Step = { step_id: string; step_no: number; step_type: 'co_sign' | 'approval'; unit_id: string; unit_name: string; status: string; sent_by?: string | null; sent_at?: string | null; received_by?: string | null; received_at?: string | null; completed_by?: string | null; completed_at?: string | null; note?: string | null };
type Event = { event_id: string; step_id?: string | null; action: string; from_status?: string | null; to_status?: string | null; actor_id?: string | null; actor_name?: string | null; actor_role?: string | null; actor_dept_name?: string | null; target_unit_id?: string | null; note?: string | null; occurred_at: string };
type Document = { document_id: string; document_no: string; subject: string; originator_id: string; originator_dept_id?: string | null; originator_name?: string | null; originator_department?: string | null; originator_root_department?: string | null; status: string; current_step_id?: string | null; barcode_value?: string | null; created_at: string; updated_at: string; closed_at?: string | null; steps: Step[]; events: Event[] };
type OfficialData = { documents: Document[]; departments: Department[]; scope_root_departments?: Department[]; people: Person[] };

const DOCUMENT_PAGE_SIZE = 5;
const PEOPLE_PAGE_SIZE = 10;

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿／待送出', awaiting_co_sign: '待會辦收文', ready_for_next: '會辦完成／待選下一站', awaiting_approval: '待陳核簽收／核決', awaiting_originator: '待原申請人收訖', returned: '已退回待補正', closed: '已結案',
};
const STEP_STATUS_LABELS: Record<string, string> = { sent: '待收文', received: '已收文／待完成', completed: '已完成', returned: '已退回' };
const ACTION_LABELS: Record<string, string> = {
  create: '建立公文', barcode_generated: '產生查詢條碼', send_co_sign: '送出會辦', receive: '收文', co_sign_complete: '會辦完成', send_approval: '送出陳核', approval_receive: '陳核簽收', approve: '核決完成', return: '退回補正', resubmit: '補正重送', originator_receive: '原申請人收訖',
};
const ROLE_LABELS: Record<string, string> = { sysadmin: '系統管理員', admin: '系統管理員', dispatcher: '公文管理人員', duty: '收發人員', unit_supervisor: '單位主管', mgmt_supervisor: '管理部主管', reporter: '一般使用者', technician: '一般使用者' };
const statusLabel = (value: unknown) => STATUS_LABELS[String(value)] || '流程狀態';
const stepStatusLabel = (value: unknown) => STEP_STATUS_LABELS[String(value)] || '流程中';
const actionLabel = (value: unknown) => ACTION_LABELS[String(value)] || '流程事件';
const roleLabel = (value: unknown) => ROLE_LABELS[String(value)] || '系統角色';
const departmentLevelLabel = (value: unknown) => Number(value) >= 2 ? '第二階' : '第一階';
const departmentParts = (person: Person) => {
  const parts = text(person.department).split(/\s*\/\s*/).filter(Boolean);
  const root = text(person.department_root) || parts[0] || '—';
  const child = parts.length > 1 ? parts.slice(1).join(' / ') : '—';
  return { root, child };
};
const fmtTime = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
};
const text = (value: unknown) => String(value ?? '').trim();
const managerRole = (profile: Profile) => {
  const role = String(profile.rbac_role || profile.role || '');
  const permissions = profile.permissions || {};
  return ['admin', 'sysadmin', 'dispatcher', 'duty'].includes(role)
    || permissions.official_document_manager === true
    || permissions['officialdocs.manage'] === true;
};
const peopleViewerRole = (profile: Profile) => {
  const role = String(profile.rbac_role || profile.role || '');
  const permissions = profile.permissions || {};
  return ['admin', 'sysadmin', 'dispatcher', 'duty', 'unit_supervisor', 'mgmt_supervisor'].includes(role)
    || permissions.official_document_people_view === true
    || permissions['officialdocs.people'] === true;
};

async function makeQr(textValue: string) {
  const qrcode = (await import('qrcode-generator')).default;
  const qr = qrcode(0, 'M');
  qr.addData(textValue);
  qr.make();
  return qr.createDataURL(5, 8);
}

function Scanner({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [message, setMessage] = useState('正在啟動相機掃描…');
  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let frame = 0;
    const start = async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
        if (!Detector) { setMessage('此瀏覽器未提供條碼掃描 API，請改用下方輸入框查詢。'); return; }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setMessage('請將公文條碼置於框內');
        const detector = new Detector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
        const scan = async () => {
          if (!active || !videoRef.current) return;
          try {
            const results = await detector.detect(videoRef.current);
            const value = results.find(item => item.rawValue)?.rawValue;
            if (value) { onDetected(value); return; }
          } catch { /* 相機尚未準備好，下一幀再試 */ }
          frame = window.requestAnimationFrame(() => { void scan(); });
        };
        void scan();
      } catch (error) {
        setMessage(error instanceof Error && /permission|denied/i.test(error.message) ? '相機權限被拒絕，請改用手動查詢。' : '無法啟動相機，請改用手動查詢。');
      }
    };
    void start();
    return () => { active = false; if (frame) window.cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); };
  }, [onDetected]);
  return <div className="od-modal-backdrop" role="dialog" aria-modal="true" aria-label="掃描公文條碼"><section className="od-scanner-modal"><header><div><small>查詢工具</small><h2>掃描公文條碼</h2></div><button type="button" className="od-icon-button" onClick={onClose} aria-label="關閉">×</button></header><video ref={videoRef} className="od-scanner-video" muted playsInline /><p className="od-help">{message}</p><button type="button" className="secondary-btn" onClick={onClose}>關閉掃描</button></section></div>;
}

function QrModal({ document, onClose }: { document: Document; onClose: () => void }) {
  const [image, setImage] = useState('');
  useEffect(() => { let active = true; if (document.barcode_value) void makeQr(document.barcode_value).then(value => { if (active) setImage(value); }); return () => { active = false; }; }, [document.barcode_value]);
  const print = () => window.print();
  const download = () => { if (!image) return; const link = window.document.createElement('a'); link.href = image; link.download = `${document.document_no}-公文條碼.png`; link.click(); };
  return <div className="od-modal-backdrop" role="dialog" aria-modal="true" aria-label="公文條碼"><section className="od-qr-modal"><header><div><small>查詢用條碼</small><h2>{document.document_no}</h2></div><button type="button" className="od-icon-button" onClick={onClose} aria-label="關閉">×</button></header><p className="od-qr-subject">{document.subject}</p>{image ? <img className="od-qr-image" src={image} alt={`公文 ${document.document_no} 查詢條碼`} /> : <p className="od-help">條碼產生中…</p>}<code className="od-barcode-value">{document.barcode_value || '—'}</code><div className="od-modal-actions"><button type="button" className="secondary-btn" onClick={download} disabled={!image}>下載圖片</button><button type="button" className="primary-btn" onClick={print}>列印條碼</button><button type="button" className="secondary-btn" onClick={onClose}>關閉</button></div></section></div>;
}

export function OfficialDocsWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => <OfficialDocsPage profile={profile} system={system} module={module} />}</AuthGate>;
}

function OfficialDocsPage({ profile, system, module }: { profile: Profile; system: SystemDefinition; module: ModuleDefinition }) {
  const [data, setData] = useState<OfficialData | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [lookup, setLookup] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [scanner, setScanner] = useState(false);
  const [qrDocument, setQrDocument] = useState<Document | null>(null);
  const [form, setForm] = useState({ subject: '' });
  const [targetUnit, setTargetUnit] = useState('');
  const [documentPage, setDocumentPage] = useState(1);
  const [peopleNameFilter, setPeopleNameFilter] = useState('');
  const [peopleUnitFilter, setPeopleUnitFilter] = useState('');
  const [peopleRoleFilter, setPeopleRoleFilter] = useState('');
  const [peopleLevelFilter, setPeopleLevelFilter] = useState('');
  const [peoplePage, setPeoplePage] = useState(1);
  const selected = data?.documents.find(document => document.document_id === selectedId) || data?.documents[0] || null;
  const canManage = managerRole(profile);
  const canViewPeople = peopleViewerRole(profile);

  const load = useCallback(async (search = '') => {
    setLoading(true);
    try {
      const result = await invokeAppApi<OfficialData>('official_documents', { lookup: search });
      setData(result);
      setDocumentPage(1);
      setSelectedId(current => result.documents.some(document => document.document_id === current) ? current : result.documents[0]?.document_id || '');
      setNote('');
    } catch (error) { setNote(error instanceof Error ? error.message : '公文資料載入失敗'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(''); }, [load]);

  const departmentOptions = useMemo(() => (data?.departments || []).map(department => ({ value: department.dept_id, label: department.code ? `${department.name}（${department.code}）` : department.name })), [data?.departments]);
  const documentPageCount = Math.max(1, Math.ceil((data?.documents.length || 0) / DOCUMENT_PAGE_SIZE));
  const pagedDocuments = useMemo(() => (data?.documents || []).slice((documentPage - 1) * DOCUMENT_PAGE_SIZE, documentPage * DOCUMENT_PAGE_SIZE), [data?.documents, documentPage]);
  const peopleRows = useMemo(() => {
    const nameNeedle = text(peopleNameFilter).toLocaleLowerCase();
    const unitNeedle = text(peopleUnitFilter).toLocaleLowerCase();
    const roleNeedle = text(peopleRoleFilter).toLocaleLowerCase();
    return (data?.people || []).filter(person => {
      const labels = departmentParts(person);
      const name = text(person.name).toLocaleLowerCase();
      const unit = `${labels.root} ${labels.child} ${text(person.department)}`.toLocaleLowerCase();
      const role = roleLabel(person.rbac_role || person.role).toLocaleLowerCase();
      const level = departmentLevelLabel(person.department_level);
      return (!nameNeedle || name.includes(nameNeedle))
        && (!unitNeedle || unit.includes(unitNeedle))
        && (!roleNeedle || role.includes(roleNeedle))
        && (!peopleLevelFilter || level === peopleLevelFilter);
    });
  }, [data?.people, peopleNameFilter, peopleUnitFilter, peopleRoleFilter, peopleLevelFilter]);
  const peoplePageCount = Math.max(1, Math.ceil(peopleRows.length / PEOPLE_PAGE_SIZE));
  const pagedPeople = useMemo(() => peopleRows.slice((peoplePage - 1) * PEOPLE_PAGE_SIZE, peoplePage * PEOPLE_PAGE_SIZE), [peopleRows, peoplePage]);
  const peopleNameOptions = useMemo(() => Array.from(new Set((data?.people || []).map(person => text(person.name)).filter(Boolean))).sort(), [data?.people]);
  const peopleUnitOptions = useMemo(() => Array.from(new Set((data?.people || []).flatMap(person => { const parts = departmentParts(person); return [parts.root, parts.child === '—' ? '' : parts.child, text(person.department)]; }).filter(Boolean))).sort(), [data?.people]);
  const peopleRoleOptions = useMemo(() => Array.from(new Set((data?.people || []).map(person => roleLabel(person.rbac_role || person.role)))).sort(), [data?.people]);
  useEffect(() => { setPeoplePage(1); }, [peopleNameFilter, peopleUnitFilter, peopleRoleFilter, peopleLevelFilter]);
  useEffect(() => { if (documentPage > documentPageCount) setDocumentPage(documentPageCount); }, [documentPage, documentPageCount]);
  useEffect(() => { if (peoplePage > peoplePageCount) setPeoplePage(peoplePageCount); }, [peoplePage, peoplePageCount]);
  const perform = async (documentAction: string, payload: Record<string, unknown> = {}) => {
    if (!selected) return;
    setSaving(true); setNote('');
    try {
      await invokeAppApi('official_document_action', { document_id: selected.document_id, document_action: documentAction, target_unit_id: payload.target_unit_id || undefined, note: payload.note || undefined, idempotency_key: `${selected.document_id}:${documentAction}:${crypto.randomUUID()}` });
      setNote(`${actionLabel(documentAction)}已完成`);
      await load(lookup);
    } catch (error) { setNote(error instanceof Error ? error.message : '流程操作失敗'); }
    finally { setSaving(false); }
  };
  const createDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.subject.trim()) { setNote('請填寫公文主旨'); return; }
    setSaving(true); setNote('');
    try {
      const result = await invokeAppApi<{ document_id: string }>('official_document_create', form);
      setForm({ subject: '' });
      setNote('公文已建立並自動取號，請選擇下一個會辦或陳核部室送出');
      await load('');
      setSelectedId(result.document_id);
    } catch (error) { setNote(error instanceof Error ? error.message : '公文建立失敗'); }
    finally { setSaving(false); }
  };
  const onScanned = useCallback((value: string) => { setScanner(false); setLookup(value); void load(value); }, [load]);
  const currentStep = selected?.steps.find(step => step.step_id === selected.current_step_id) || null;
  const currentUnit = String(profile.dept_id || '');
  const sameUnit = Boolean(currentStep && currentStep.unit_id === currentUnit);
  const latestEvent = selected?.events[selected.events.length - 1];

  return <AppShell profile={profile} title={system.title}>
    <div className="od-page">
      <header className="od-header"><div><span className="eyebrow">{system.code} · {module.title}</span><h1>{system.title}</h1><p>以部室為單位傳送公文，依序完成會辦、陳核、核決與原申請人收訖；所有動作保留不可刪除的時間軸。</p><div className="od-header-scope"><small>目前可查詢的第一階單位</small><strong>{(data?.scope_root_departments || data?.departments || []).map(department => department.name).join('、') || '尚未載入'}</strong></div></div><div className="od-header-badge"><strong>{data?.documents.length ?? 0}</strong><span>可查詢公文</span></div></header>
      {note && <p className="notice" role="status">{note}</p>}
      <section className="od-search-panel panel"><div className="od-section-title"><div><span className="od-step-no">01</span><h2>條碼／主旨查詢</h2></div><small>掃描只查詢，不會直接收文或簽收</small></div><div className="od-search-row"><label className="od-search-input">搜尋公文編號、條碼或主旨<input value={lookup} onChange={event => setLookup(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(); }} placeholder="輸入公文編號、主旨或條碼" /></label><button type="button" className="secondary-btn" onClick={() => void load()} disabled={loading}>查詢</button><button type="button" className="secondary-btn" onClick={() => setScanner(true)}>掃描條碼</button><button type="button" className="secondary-btn" onClick={() => { setLookup(''); void load(''); }}>清除</button></div><p className="od-help">沒有條碼時可輸入公文主旨；開啟公文後再產生條碼、下載或列印。</p></section>
      <div className="od-layout">
        <section className="panel od-list-panel"><div className="od-section-title"><div><span className="od-step-no">02</span><h2>公文清單</h2></div><button type="button" className="secondary-btn compact" onClick={() => void load()} disabled={loading}>重新載入</button></div>{loading ? <div className="loading-panel">資料載入中…</div> : !data?.documents.length ? <p className="empty">目前沒有符合查詢條件的公文。</p> : <><div className="od-document-list">{pagedDocuments.map(document => <button type="button" key={document.document_id} className={`od-document-item${selected?.document_id === document.document_id ? ' is-selected' : ''}`} onClick={() => { setSelectedId(document.document_id); setTargetUnit(''); }}><span className="od-document-main"><strong>{document.document_no}</strong><span>{document.subject}</span></span><span className={`od-status od-status-${document.status}`}>{statusLabel(document.status)}</span><small>{fmtTime(document.updated_at)}</small></button>)}</div><div className="od-pagination" aria-label="公文清單分頁"><span>第 {documentPage}／{documentPageCount} 頁，共 {data.documents.length} 筆</span><div><button type="button" className="secondary-btn compact" onClick={() => setDocumentPage(page => Math.max(1, page - 1))} disabled={documentPage <= 1}>上一頁</button><button type="button" className="secondary-btn compact" onClick={() => setDocumentPage(page => Math.min(documentPageCount, page + 1))} disabled={documentPage >= documentPageCount}>下一頁</button></div></div></>}</section>
        <section className="panel od-detail-panel">{selected ? <><div className="od-detail-head"><div><span className="eyebrow">{selected.document_no}</span><h2>{selected.subject}</h2><p>原申請人：{selected.originator_name || '—'}　｜　目前狀態：<b>{statusLabel(selected.status)}</b></p></div><div className="od-detail-actions"><button type="button" className="secondary-btn compact" onClick={() => void perform('barcode_generate')} disabled={saving || Boolean(selected.barcode_value)}>產生條碼</button><button type="button" className="secondary-btn compact" onClick={() => selected.barcode_value && setQrDocument(selected)} disabled={!selected.barcode_value}>查看／列印</button></div></div><div className="od-flow-strip">{['建立', '依序會辦', '陳核簽收', '核決', '原申請人收訖'].map((label, index) => <span key={label} className={index <= (selected.status === 'closed' ? 4 : selected.status === 'awaiting_originator' ? 3 : selected.status === 'awaiting_approval' ? 2 : selected.steps.length ? 1 : 0) ? 'is-done' : ''}><i>{index + 1}</i>{label}</span>)}</div>{canManage && (selected.status === 'draft' || selected.status === 'ready_for_next') && <div className="od-route-box"><div><b>{selected.status === 'draft' ? '送出第一個流程節點' : '選擇下一個流程節點'}</b><small>前一個會辦完成後才能選下一站；陳核只能在全部會辦完成後送出。</small></div><label>目標部室<select value={targetUnit} onChange={event => setTargetUnit(event.target.value)}><option value="">請選擇部室</option>{departmentOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div className="od-route-actions"><button type="button" className="primary-btn compact" disabled={saving || !targetUnit} onClick={() => void perform('send_co_sign', { target_unit_id: targetUnit })}>送出會辦</button><button type="button" className="secondary-btn compact" disabled={saving || !targetUnit || (selected.status === 'ready_for_next' && currentStep?.status !== 'completed')} onClick={() => void perform('send_approval', { target_unit_id: targetUnit })}>送出陳核</button></div></div>}{currentStep && <div className="od-current-step"><div><small>目前流程節點 {currentStep.step_no} · {currentStep.step_type === 'co_sign' ? '會辦' : '陳核'}</small><strong>{currentStep.unit_name}</strong><span>{stepStatusLabel(currentStep.status)}　送出：{fmtTime(currentStep.sent_at)}</span></div><div className="od-current-actions">{sameUnit && currentStep.status === 'sent' && <button type="button" className="primary-btn compact" disabled={saving} onClick={() => void perform(currentStep.step_type === 'approval' ? 'approval_receive' : 'receive')}>{currentStep.step_type === 'approval' ? '簽收' : '收文'}</button>}{sameUnit && currentStep.step_type === 'co_sign' && currentStep.status === 'received' && <button type="button" className="primary-btn compact" disabled={saving} onClick={() => void perform('co_sign_complete')}>會辦完成</button>}{sameUnit && currentStep.step_type === 'approval' && currentStep.status === 'received' && <><button type="button" className="primary-btn compact" disabled={saving} onClick={() => void perform('approve')}>核決完成</button><button type="button" className="danger-btn compact" disabled={saving} onClick={() => void perform('return', { note: window.prompt('請輸入退回原因（可留白）') || '' })}>退回補正</button></>}</div></div>}{selected.status === 'returned' && selected.originator_id === profile.user_id && <div className="od-return-box"><b>原申請人補正</b><span>退回歷程已保留；補正完成後可重新送出，會建立新的送出事件。</span><button type="button" className="primary-btn compact" disabled={saving} onClick={() => void perform('resubmit')}>補正後重新送出</button></div>}{selected.status === 'awaiting_originator' && selected.originator_id === profile.user_id && <div className="od-return-box"><b>核決完成，等待原申請人收訖</b><span>收訖後公文才會結案。</span><button type="button" className="primary-btn compact" disabled={saving} onClick={() => void perform('originator_receive')}>原申請人收訖</button></div>}<div className="od-meta-grid"><div><small>公文編號</small><b>{selected.document_no}</b></div><div><small>建立時間</small><b>{fmtTime(selected.created_at)}</b></div><div><small>目前節點</small><b>{currentStep ? `${currentStep.unit_name}｜${stepStatusLabel(currentStep.status)}` : '尚未送出'}</b></div><div><small>查詢條碼</small><b className="od-code">{selected.barcode_value || '尚未產生'}</b></div></div><div className="od-subsection"><div className="od-subsection-title"><h3>流程節點</h3><small>每個部室的收文／完成均獨立記錄</small></div><div className="od-step-table responsive-table"><table><thead><tr><th>順序</th><th>部室</th><th>類型</th><th>狀態</th><th>送出時間</th><th>完成時間</th></tr></thead><tbody>{selected.steps.map(step => <tr key={step.step_id}><td>{step.step_no}</td><td>{step.unit_name}</td><td>{step.step_type === 'co_sign' ? '會辦' : '陳核'}</td><td>{stepStatusLabel(step.status)}</td><td>{fmtTime(step.sent_at)}</td><td>{fmtTime(step.completed_at || step.received_at)}</td></tr>)}</tbody></table>{!selected.steps.length && <p className="empty">尚未選擇流程節點。</p>}</div></div><div className="od-subsection"><div className="od-subsection-title"><h3>不可刪除的完整時間軸</h3><small>伺服器時間，畫面以 Asia/Taipei 顯示</small></div><ol className="od-timeline">{selected.events.map(event => <li key={event.event_id}><time>{fmtTime(event.occurred_at)}</time><div><b>{actionLabel(event.action)}</b><span>{event.actor_dept_name || '未設定部室'}／{event.actor_name || '—'}（{roleLabel(event.actor_role)}）</span>{event.note && <small>{event.note}</small>}</div></li>)}</ol>{!selected.events.length && <p className="empty">尚未有流程事件。</p>}</div>{latestEvent && <p className="od-last-event">最近事件：{actionLabel(latestEvent.action)} · {fmtTime(latestEvent.occurred_at)}</p>}</> : <p className="empty">請先從左側選擇公文。</p>}</section>
      </div>
      {canManage ? <section className="panel od-create-panel"><div className="od-section-title"><div><span className="od-step-no">03</span><h2>建立公文</h2></div><small>公文編號由系統依當日年月日＋三碼流水號自動取號；查詢條碼即公文編號</small></div><form className="od-create-form" onSubmit={createDocument}><label>公文主旨<input value={form.subject} onChange={event => setForm(current => ({ ...current, subject: event.target.value }))} maxLength={300} required placeholder="請輸入公文主旨" /></label><button type="submit" className="primary-btn" disabled={saving}>建立並自動取號</button></form><p className="od-help">同一天已使用的號碼會自動跳至下一號；建立後由單位公文管理人員選擇下一個會辦部室或陳核部室。</p></section> : <section className="panel od-create-panel od-create-restricted"><div className="od-section-title"><div><span className="od-step-no">03</span><h2>建立公文</h2></div></div><p className="od-help">目前帳號只能查詢本人送出的公文；建立與傳送公文請由單位公文管理人員操作。</p></section>}
      {canViewPeople && <section className="panel od-people-panel"><div className="od-section-title"><div><span className="od-step-no">04</span><h2>單位人員資料</h2></div><small>可依姓名、單位、角色與階層篩選；每頁 10 筆</small></div>{data?.people.length ? <><div className="od-people-filters" aria-label="人員資料篩選"><label className="od-filter-field">姓名<input list="od-person-name-options" value={peopleNameFilter} onChange={event => setPeopleNameFilter(event.target.value)} placeholder="全部姓名" /><datalist id="od-person-name-options">{peopleNameOptions.map(option => <option key={option} value={option} />)}</datalist></label><label className="od-filter-field">單位<input list="od-person-unit-options" value={peopleUnitFilter} onChange={event => setPeopleUnitFilter(event.target.value)} placeholder="第一階或第二階單位" /><datalist id="od-person-unit-options">{peopleUnitOptions.map(option => <option key={option} value={option} />)}</datalist></label><label className="od-filter-field">角色<input list="od-person-role-options" value={peopleRoleFilter} onChange={event => setPeopleRoleFilter(event.target.value)} placeholder="全部角色" /><datalist id="od-person-role-options">{peopleRoleOptions.map(option => <option key={option} value={option} />)}</datalist></label><label className="od-filter-field">單位階層<input list="od-person-level-options" value={peopleLevelFilter} onChange={event => setPeopleLevelFilter(event.target.value)} placeholder="全部階層" /><datalist id="od-person-level-options"><option value="第一階" /><option value="第二階" /></datalist></label><button type="button" className="secondary-btn compact od-filter-clear" onClick={() => { setPeopleNameFilter(''); setPeopleUnitFilter(''); setPeopleRoleFilter(''); setPeopleLevelFilter(''); }}>清除篩選</button></div>{peopleRows.length ? <><div className="od-people-table responsive-table"><table><thead><tr><th>姓名</th><th>第一階單位</th><th>第二階單位</th><th>角色</th></tr></thead><tbody>{pagedPeople.map(person => { const parts = departmentParts(person); return <tr key={person.user_id}><td>{person.name}</td><td>{parts.root}</td><td>{parts.child}</td><td><span>{roleLabel(person.rbac_role || person.role)}</span><small className="od-person-level">{departmentLevelLabel(person.department_level)}</small></td></tr>; })}</tbody></table></div><div className="od-pagination" aria-label="單位人員資料分頁"><span>第 {peoplePage}／{peoplePageCount} 頁，共 {peopleRows.length} 筆</span><div><button type="button" className="secondary-btn compact" onClick={() => setPeoplePage(page => Math.max(1, page - 1))} disabled={peoplePage <= 1}>上一頁</button><button type="button" className="secondary-btn compact" onClick={() => setPeoplePage(page => Math.min(peoplePageCount, page + 1))} disabled={peoplePage >= peoplePageCount}>下一頁</button></div></div></> : <p className="empty">沒有符合篩選條件的人員資料。</p>}</> : <p className="empty">目前單位沒有可顯示的人員資料。</p>}</section>}
    </div>
    {scanner && <Scanner onDetected={onScanned} onClose={() => setScanner(false)} />}
    {qrDocument && <QrModal document={qrDocument} onClose={() => setQrDocument(null)} />}
  </AppShell>;
}
