'use client';

// SYS-04 水果組電子交接簿（蔬菜組日後沿用同一元件，以 group 區分）。
// 包含：三班現場移交事項（自由文字）、交班與接班雙方確認、事項續辦與完成登記、
// 組(副)長 → 市場副主任 → 市場主任三階批核（批核前先預覽報表）與每日 A4 列印報表。
// 流程與業管組一致；資料表與 RPC 見 supabase/migrations/20261021090000_produce_handover_fruit.sql。
// 外觀共用 handover-sheet；只有本簿特有的區塊放在 produce-handover.css。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AdminHeader, AdminModal, errorMessage, type Row } from '@/components/admin/shared';
import { BlankSelectOption } from '@/components/BlankSelectOption';
import { getSupabase } from '@/lib/supabase';
import { selectableActiveUsers } from '@/lib/user-visibility';
import {
  PRODUCE_ENABLED_MARKETS,
  PRODUCE_GROUPS,
  PRODUCE_MARKET_NAMES,
  PRODUCE_SHIFTS,
  emptyProduceApprovalAccess,
  produceApprovalAccessFrom,
  produceApprovalGateReason,
  produceApprovalReadonlyReason,
  produceApprovalStages,
  produceCurrentShift,
  produceShiftName,
  type ProduceApprovalAccess,
  type ProduceApprovalStage,
  type ProduceGroup,
  type ProduceMarket,
} from '@/lib/produce-handover';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import { HandoverDateNavigation, HandoverIcon, HandoverReportHeading, HandoverReportOverview, HandoverSheetHeader } from './handover-sheet';
import { BusinessSignatures, businessTime, type BusinessShift } from './business-handover-reconciliation';
import { ProduceScrapPanel, ProduceSlipPanel, ProduceStockPanel } from './produce-documents';
import './handover-sheet.css';
import './produce-handover.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile; group: ProduceGroup };
type ProduceApproval = {
  approval_id: string; handover_date: string; stage: ProduceApprovalStage; stage_label: string;
  approver_id: string; approver_name: string; approved_at: string; note?: string | null;
};
type Confirmation = { operation: 'submit' | 'receive' | 'complete'; shift: BusinessShift; entry?: Row };
type Tab = 'duty' | 'stock' | 'scrap' | 'slip';
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'duty', label: '值勤紀錄' }, { key: 'stock', label: '存貨交接明細' },
  { key: 'scrap', label: '報廢報告' }, { key: 'slip', label: '運回放行單' },
];

const ENTRY_MAX = 2000;
const APPROVAL_NOTE_MAX = 500;

function clock() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).reduce<Record<string, string>>((acc, part) => { if (part.type !== 'literal') acc[part.type] = part.value; return acc; }, {});
  return { today: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function moveDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setDate(value.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
function rocDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'long' }).format(new Date(`${date}T12:00:00+08:00`));
  return `${year - 1911} 年 ${month} 月 ${day} 日（${weekday}）`;
}
const isDeleted = (row: Row) => row.is_deleted === true;

export function ProduceHandover({ system, module, profile, group }: Props) {
  const groupName = PRODUCE_GROUPS[group].name;
  const enabledMarkets = PRODUCE_ENABLED_MARKETS[group];
  const [market, setMarket] = useState<ProduceMarket | null>(enabledMarkets[0] || null);
  const [now, setNow] = useState(clock);
  const [date, setDate] = useState(() => (clock().hour < 1 ? moveDate(clock().today, -1) : clock().today));
  const [shifts, setShifts] = useState<BusinessShift[]>([]);
  const [approvals, setApprovals] = useState<ProduceApproval[]>([]);
  const [access, setAccess] = useState<Record<ProduceApprovalStage, ProduceApprovalAccess>>(() => emptyProduceApprovalAccess());
  const [users, setUsers] = useState<Row[]>([]);
  const [receivers, setReceivers] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [editing, setEditing] = useState<{ shiftCode: string; entry: Row | null } | null>(null);
  const [tab, setTab] = useState<Tab>('duty');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewStage, setPreviewStage] = useState<ProduceApprovalStage | null>(null);
  const [previewNote, setPreviewNote] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [noteStage, setNoteStage] = useState<ProduceApprovalStage | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const loadGeneration = useRef(0);
  const approvalSubmitRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 30000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!market) { setAccess(emptyProduceApprovalAccess('unavailable')); setBusy(false); return; }
    const generation = ++loadGeneration.current;
    setBusy(true);
    setAccess(emptyProduceApprovalAccess('checking'));
    setNote('');
    try {
      const client = getSupabase();
      const [dayResult, receiverResult, userResult] = await Promise.all([
        client.rpc('produce_day', { p_group: group, p_market: market, p_date: date }),
        client.rpc('produce_receivers', { p_group: group, p_market: market }),
        client.from('users').select('user_id,name,username,email,status').eq('status', 'active').limit(1000),
      ]);
      if (generation !== loadGeneration.current) return;
      if (dayResult.error) throw dayResult.error;
      const day = dayResult.data as { shifts: BusinessShift[]; approvals: ProduceApproval[]; can: unknown };
      setShifts(day.shifts || []);
      setApprovals(day.approvals || []);
      setAccess(produceApprovalAccessFrom(day.can));
      setReceivers(receiverResult.error ? [] : selectableActiveUsers((receiverResult.data as Row[]) || []));
      setUsers(userResult.error ? [] : selectableActiveUsers(userResult.data || []));
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setShifts([]); setApprovals([]); setAccess(emptyProduceApprovalAccess('unavailable'));
      setNote(`失敗：${errorMessage(error, `${groupName}交接資料載入失敗`)}`);
    } finally {
      if (generation === loadGeneration.current) setBusy(false);
    }
  }, [date, group, groupName, market]);
  useEffect(() => { void load(); }, [load]);

  const userName = useCallback((id: unknown) => users.find(user => String(user.user_id) === String(id))?.name
    || (String(id || '') === profile.user_id ? profile.name : '—'), [profile.name, profile.user_id, users]);

  const stages = useMemo(() => produceApprovalStages(group, market || 'market_1'), [group, market]);
  const approvedKeys = approvals.map(approval => approval.stage);
  const approvedCount = stages.filter(item => approvedKeys.includes(item.stage)).length;
  const currentShift = produceCurrentShift(now, date);
  const activeEntryCount = shifts.reduce((sum, shift) => sum + shift.items.filter(row => !isDeleted(row) && !row.carried).length, 0);
  const completedShiftCount = shifts.filter(shift => Boolean(shift.outgoing?.received_at)).length;
  const marketInfo = PRODUCE_MARKET_NAMES[market || 'market_1'];

  const call = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await getSupabase().rpc(name, args);
    if (error) throw error;
    return data;
  };

  const saveConfirmation = async (receiverId: string) => {
    if (!confirmation || confirmBusy || !market) return;
    setConfirmBusy(true); setConfirmMessage('');
    try {
      const { operation, shift, entry } = confirmation;
      await call('produce_action', {
        p_group: group, p_market: market, p_action: operation, p_date: date, p_shift: shift.shift_code,
        p_entry: entry?.entry_id ?? null, p_receiver: receiverId || null,
        p_revision: operation === 'receive' ? shift.incoming?.revision : shift.revision,
      });
      setConfirmation(null);
      await load();
    } catch (error) { setConfirmMessage(errorMessage(error)); } finally { setConfirmBusy(false); }
  };

  const approve = async (stage: ProduceApprovalStage | null, noteText: string) => {
    if (!stage || !market) return;
    if (access[stage] !== 'allowed') { const reason = produceApprovalReadonlyReason(access[stage]); setNote(reason); setPreviewError(reason); return; }
    const gate = produceApprovalGateReason(stage, approvedKeys, group, market);
    if (gate && !approvedKeys.includes(stage)) { setNote(gate); setPreviewError(gate); return; }
    if (approvalSubmitRef.current) return;
    approvalSubmitRef.current = true;
    setBusy(true); setNote(''); setPreviewError('');
    try {
      await call('produce_approval_save', { p_group: group, p_market: market, p_date: date, p_stage: stage, p_note: noteText.trim() || null });
      setPreviewStage(null); setPreviewNote(''); setNoteStage(null); setNoteDraft('');
      await load();
    } catch (error) {
      const failure = `失敗：批核未儲存，${errorMessage(error)}`;
      setNote(failure); setPreviewError(failure);
    } finally { approvalSubmitRef.current = false; setBusy(false); }
  };

  const closePreview = () => { setPreviewOpen(false); setPreviewStage(null); setPreviewError(''); };
  const previewStageItem = previewStage ? stages.find(item => item.stage === previewStage) || null : null;
  const previewGate = previewStage && market ? produceApprovalGateReason(previewStage, approvedKeys, group, market) : '';
  const previewCanApprove = Boolean(previewStage) && access[previewStage as ProduceApprovalStage] === 'allowed' && !previewGate;

  return <AppShell profile={profile} title={module.title} heading={{ system, module, title: module.title, metaTitle: system.title }}>
    <div className="hs-page">
      <AdminHeader module={module} hideDescription busy={busy} note={note} onReload={load} action={tab !== 'duty' ? undefined :
        <div className="hs-header-actions">
          <button type="button" className="secondary-btn compact" onClick={() => setPreviewOpen(true)} title="在畫面上預覽 A4 報表">
            <HandoverIcon name="eye" size={14} />預覽本日報表</button>
          <button type="button" className="primary-btn compact" onClick={() => window.print()}>
            <HandoverIcon name="printer" size={14} />列印本日報表</button>
        </div>} />

      {market && <div className="hs-market-switch produce-tabs" role="tablist" aria-label={`${groupName}交接簿單據`}>{TABS.map(item =>
        <button key={item.key} type="button" role="tab" className={`secondary-btn compact${tab === item.key ? ' is-active' : ''}`} aria-selected={tab === item.key}
          onClick={() => setTab(item.key)}>{item.label}</button>)}</div>}

      {market && tab === 'stock' && <ProduceStockPanel group={group} market={market} profile={profile} />}
      {market && tab === 'scrap' && <ProduceScrapPanel group={group} market={market} profile={profile} />}
      {market && tab === 'slip' && <ProduceSlipPanel group={group} market={market} profile={profile} />}

      {tab === 'duty' && <section className="panel hs-toolbar produce-toolbar">
        {enabledMarkets.length > 1 && <div className="hs-market-switch" role="group" aria-label="市場別">{enabledMarkets.map(code =>
          <button key={code} type="button" className={`secondary-btn compact${market === code ? ' is-active' : ''}`} aria-pressed={market === code}
            disabled={busy} onClick={() => setMarket(code)}>{PRODUCE_MARKET_NAMES[code].short}</button>)}</div>}
        <HandoverDateNavigation id="produce-handover-date" label="交接日期" value={date} onChange={setDate}
          onPrevious={() => setDate(current => moveDate(current, -1))} onNext={() => setDate(current => moveDate(current, 1))} onToday={() => setDate(clock().today)} />
        <div className="hs-toolbar-right">
          {currentShift && <span className="hs-current-now"><span className="hs-pulse-dot" />目前當班：{currentShift.name}（{currentShift.label}）</span>}
          <span className="hs-toolbar-summary"><HandoverIcon name="calendar" size={15} />{rocDate(date)} · 3 個班別 · 共 {activeEntryCount} 筆交接</span>
        </div>
      </section>}

      {!market && <section className="panel notice danger"><h2>尚未開放</h2><p>{groupName}電子交接簿尚未開放使用，請洽系統管理員。</p></section>}

      {market && tab === 'duty' && <section className="hs-sheet" aria-label={`${groupName}電子交接簿`}>
        <HandoverSheetHeader org={`臺北農產運銷股份有限公司　${marketInfo.name}`} title={`${groupName}現場值勤交接紀錄表`} dateLabel={rocDate(date)} emblem="clipboard" />
        <div className="hs-shifts">
          {PRODUCE_SHIFTS.map((shift, shiftIndex) => {
            const report = shifts.find(item => item.shift_code === shift.code);
            const rows = report?.items || [];
            const activeRows = rows.filter(row => !isDeleted(row));
            const isActive = currentShift?.code === shift.code;
            const started = new Date(`${date}T${shift.code.slice(0, 2)}:00:00+08:00`).getTime() <= Date.now();
            const locked = Boolean(report?.outgoing);
            return <section className={`hs-shift hs-shift-${shiftIndex + 1}${isActive ? ' is-current' : ''}`} key={shift.code}>
              <div className="hs-shift-head">
                <div className="hs-shift-title">
                  <strong className="hs-shift-no">{shiftIndex + 1}</strong>
                  <div>
                    <div className="hs-shift-name"><b>{shift.name}</b>
                      {isActive ? <span className="hs-state is-active"><span className="hs-pulse-dot" />當班中</span> : <span className="hs-state is-normal">班別時段</span>}
                    </div>
                    <div className="hs-shift-times"><span className="hs-chip"><HandoverIcon name="clock" size={14} />時段 {shift.label}</span></div>
                  </div>
                </div>
                <div className="hs-shift-actions">
                  <span className="hs-pill is-count">共 {activeRows.length} 筆交接</span>
                  <button type="button" className="primary-btn compact" disabled={busy || !report || locked || !started}
                    title={!started ? '尚未開始的班別不可記載' : undefined} onClick={() => setEditing({ shiftCode: shift.code, entry: null })}>＋ 新增交接</button>
                </div>
              </div>
              {report && <BusinessSignatures shift={report} profileId={profile.user_id} disabled={busy || confirmBusy || !started}
                onConfirm={value => { setConfirmMessage(''); setConfirmation(value); }} />}
              <div className="hs-shift-body is-single">
                {rows.length ? <div className="produce-entry-list">{rows.map((row, index) => <article className={`produce-entry${isDeleted(row) ? ' is-deleted' : ''}`} key={String(row.entry_id)}>
                  <div className="produce-entry-main">
                    <small>第 {index + 1} 件 · 是否完成：{row.is_completed ? '是' : '否（持續續辦）'}
                      {row.carried ? ` · 續帶自 ${String(row.handover_date)} ${produceShiftName(String(row.shift_code))}` : ''}</small>
                    <p>{String(row.description || '—')}</p>
                    {row.is_completed && <small>完成：{businessTime(row.completed_at)} · {String(row.completed_name || '—')}</small>}
                  </div>
                  <div className="produce-entry-audit">
                    <span>建立 {businessTime(row.created_at)} · {String(row.created_name || userName(row.created_by))}</span>
                    {!isDeleted(row) && row.updated_at && new Date(String(row.updated_at)).getTime() > new Date(String(row.created_at)).getTime() &&
                      <span>修改 {businessTime(row.updated_at)} · {userName(row.updated_by)}</span>}
                    {isDeleted(row) && <span>刪除 {businessTime(row.deleted_at)} · {userName(row.deleted_by)}</span>}
                    <b>{isDeleted(row) ? '已刪除，保留紀錄' : locked || row.content_locked || row.is_completed ? '交接內容已鎖定' : '可編輯事項'}</b>
                    {!isDeleted(row) && report && <div className="produce-entry-actions">
                      {!locked && !row.content_locked && !row.is_completed && !row.carried && <button type="button" className="secondary-btn compact" disabled={busy}
                        onClick={() => setEditing({ shiftCode: shift.code, entry: row })}>修改事項</button>}
                      {!row.is_completed && !locked && <button type="button" className="primary-btn compact" disabled={busy || confirmBusy || !isActive}
                        title={!isActive ? '只能在目前當班登記完成' : undefined}
                        onClick={() => { setConfirmMessage(''); setConfirmation({ operation: 'complete', shift: report, entry: row }); }}>標記已完成</button>}
                    </div>}
                  </div>
                </article>)}</div> : <div className="hs-empty-shift"><HandoverIcon name="note" size={18} /><p>本班尚無交接紀錄，請點擊右上角「＋ 新增交接」建立。</p></div>}
              </div>
            </section>;
          })}
        </div>
      </section>}

      {market && tab === 'duty' && <section className="produce-approval-section panel" aria-label="主管批核流程">
        <div className="produce-approval-head">
          <div><strong>{groupName}主管批核流程</strong>
            <span>{stages.length} 階段簽核（依序）：{stages.map(item => item.label).join('／')}；當日或隔日皆可批核，批核前會先預覽本日報表。</span></div>
          <span className={`produce-approval-badge${approvedCount === stages.length ? ' is-all' : ''}`}>
            {approvedCount === stages.length ? '✓ 批核全部完成' : `批核進度：${approvedCount} / ${stages.length} 階段`}</span>
        </div>
        <div className="produce-approval-grid">{stages.map((item, index) => {
          const approval = approvals.find(entry => entry.stage === item.stage);
          const stageAccess = access[item.stage];
          const gate = approval ? '' : produceApprovalGateReason(item.stage, approvedKeys, group, market);
          const readonly = produceApprovalReadonlyReason(stageAccess);
          const mine = approval?.approver_id === profile.user_id;
          const canApprove = stageAccess === 'allowed' && !gate;
          return <div key={item.stage} className={`produce-approval-card ${approval ? 'is-approved' : 'is-pending'}`}>
            <div className="produce-approval-card-head"><span>第 {index + 1} 階</span><strong>{item.label}</strong>
              <em className={approval ? 'is-done' : 'is-wait'}>{approval ? '✓ 已批核' : '⏳ 待批核'}</em></div>
            <p>{item.desc}</p>
            {approval ? <div className="produce-approval-info">
              <span>批核主管：<b>{approval.approver_name}</b></span>
              <small>批核時間：{businessTime(approval.approved_at)}</small>
              <blockquote>{approval.note || '簽核時未填寫說明'}</blockquote>
              {mine && stageAccess === 'allowed' && <button type="button" className="secondary-btn compact" disabled={busy}
                onClick={() => { setNoteStage(item.stage); setNoteDraft(approval.note || ''); }}><HandoverIcon name="pen" size={13} />修改簽核說明</button>}
            </div> : <div className="produce-approval-info">
              <small>點選後先預覽本日報表，確認內容後再批核。</small>
              {(readonly || gate) && <p className="produce-approval-hint" role="status">{readonly || gate}</p>}
              <button type="button" className="primary-btn compact" disabled={busy || !canApprove} title={readonly || gate || undefined}
                onClick={() => { setPreviewNote(''); setPreviewError(''); setPreviewStage(item.stage); }}><HandoverIcon name="check" size={14} />{item.label} 批核</button>
            </div>}
          </div>;
        })}</div>
      </section>}

      {market && tab === 'duty' && <section className="hs-print-sheet" aria-label={`${groupName}每日列印報表`}>
        <ProduceReport group={group} market={market} date={date} shifts={shifts} approvals={approvals} />
      </section>}
    </div>

    {tab === 'duty' && (previewOpen || previewStage) && market && <div className="hs-preview" role="dialog" aria-modal="true" aria-label={previewStageItem ? `${previewStageItem.label}批核前預覽` : `${groupName}交接本日報表預覽`}>
      <div className="hs-preview-bar">
        <div><strong>{previewStageItem ? `${previewStageItem.label}批核前預覽（A4 版面）` : '本日報表預覽（A4 版面）'}</strong><span>{rocDate(date)} · A4 直式排版</span></div>
        <div>
          <button type="button" className="primary-btn compact" onClick={() => { closePreview(); setTimeout(() => window.print(), 100); }}>
            <HandoverIcon name="printer" size={14} />列印本日報表</button>
          <button type="button" className="secondary-btn compact" onClick={closePreview} disabled={busy && Boolean(previewStageItem)}>{previewStageItem ? '取消批核' : '關閉預覽'}</button>
        </div>
      </div>
      <div className="hs-preview-scroll">
        {previewStageItem && <div className="produce-approval-panel" role="group" aria-label={`${previewStageItem.label}批核`}>
          <div><strong>{previewStageItem.label} 批核</strong><span>請先檢視下方報表，確認無誤後按「確認批核」；批核會記錄您的姓名與時間。</span></div>
          <label><span>簽核說明（可留白）</span>
            <input type="text" maxLength={APPROVAL_NOTE_MAX} placeholder="例如：查核無誤、同意備查" value={previewNote}
              disabled={busy || !previewCanApprove} onChange={event => setPreviewNote(event.target.value)} /></label>
          <button type="button" className="primary-btn compact" disabled={busy || !previewCanApprove} title={previewGate || undefined}
            onClick={() => void approve(previewStage, previewNote)}><HandoverIcon name="check" size={14} />{busy ? '批核中…' : '確認批核'}</button>
          {(previewError || previewGate) && <p className="produce-approval-hint" role="alert">{previewError || previewGate}</p>}
        </div>}
        <div className="hs-preview-paper"><ProduceReport group={group} market={market} date={date} shifts={shifts} approvals={approvals} /></div>
      </div>
    </div>}

    {confirmation && <ProduceConfirmModal confirmation={confirmation} users={receivers} profileId={profile.user_id}
      busy={confirmBusy} message={confirmMessage} onClose={() => setConfirmation(null)} onSave={receiver => void saveConfirmation(receiver)} />}

    {editing && market && <ProduceEntryModal group={group} market={market} date={date} shiftCode={editing.shiftCode} entry={editing.entry} userName={userName}
      onClose={() => setEditing(null)}
      onDone={async action => {
        setEditing(null); await load();
        setNote(action === 'deleted' ? '交接紀錄已標記刪除並保留時間紀錄' : action === 'updated' ? '交接紀錄已修改並保留時間紀錄' : '交接紀錄已新增');
      }} />}

    {noteStage && <AdminModal title={`修改簽核說明｜${stages.find(item => item.stage === noteStage)?.label}`} onClose={() => setNoteStage(null)}>
      <div className="admin-form-grid produce-form"><label className="wide">簽核說明
        <textarea rows={4} maxLength={APPROVAL_NOTE_MAX} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="請輸入審核指示或備註說明…" /></label></div>
      <footer>
        <button type="button" className="secondary-btn" onClick={() => setNoteStage(null)}>取消</button>
        <button type="button" className="primary-btn compact" disabled={busy || access[noteStage] !== 'allowed'} onClick={() => void approve(noteStage, noteDraft)}>確認儲存批核</button>
      </footer>
    </AdminModal>}
  </AppShell>;
}

/* ───────────── 確認視窗（交班、接班、完成） ───────────── */

function ProduceConfirmModal({ confirmation, users, profileId, busy, message, onClose, onSave }: {
  confirmation: Confirmation; users: Row[]; profileId: string; busy: boolean; message: string;
  onClose: () => void; onSave: (receiverId: string) => void;
}) {
  const [receiver, setReceiver] = useState('');
  const { operation, shift, entry } = confirmation;
  const title = operation === 'complete' ? '登記事項已完成' : operation === 'receive' ? '核對上一班交接內容' : '核對本班並指定接班人';
  const items = (entry ? [entry] : operation === 'receive' ? shift.incoming?.items || [] : shift.items).filter(item => !isDeleted(item));
  return <AdminModal title={title} onClose={() => { if (!busy) onClose(); }}>
    <div className="produce-confirm">
      <p>{operation === 'complete' ? '確認事項已處理完成後，下一班起停止續帶；來源與完成時間會永久保留。'
        : operation === 'receive' ? '請逐項核對下列交班快照。確認接班不代表事項已完成，未完成事項仍須接續處理。'
        : '送出後保存本班交接內容與時間，原始內容鎖定。未完成事項將持續帶入下一班，直到登記完成。'}</p>
      {items.length ? <ol className="produce-confirm-items">{items.map(item => <li key={String(item.entry_id)}>
        <b>{item.is_completed ? '已完成' : '未完成・續辦'}</b>
        <p>{String(item.description)}</p>
        <small>來源：{String(item.handover_date)} {produceShiftName(String(item.shift_code))}</small>
      </li>)}</ol> : <p>本班無交接事項，仍須由雙方確認交接。</p>}
      {operation === 'submit' && <label>下一班接班人
        <select value={receiver} onChange={event => setReceiver(event.target.value)} disabled={busy}>
          <BlankSelectOption />
          {users.filter(user => user.user_id !== profileId).map(user => <option key={String(user.user_id)} value={String(user.user_id)}>{String(user.name)}{user.department ? `（${user.department}）` : ''}</option>)}
        </select></label>}
      {message && <p role="alert" className="inline-message danger">{message}</p>}
      <div className="produce-confirm-actions">
        <button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="primary-btn" onClick={() => onSave(receiver)} disabled={busy || (operation === 'submit' && !receiver)}>
          {busy ? '儲存中…' : operation === 'complete' ? '確認已完成' : operation === 'receive' ? '本人確認接班' : '本人確認交班'}</button>
      </div>
    </div>
  </AdminModal>;
}

/* ───────────── 新增／修改／刪除（標記）事項 ───────────── */

function ProduceEntryModal({ group, market, date, shiftCode, entry, userName, onClose, onDone }: {
  group: ProduceGroup; market: ProduceMarket; date: string; shiftCode: string; entry: Row | null; userName: (id: unknown) => string;
  onClose: () => void; onDone: (action: 'created' | 'updated' | 'deleted') => void | Promise<void>;
}) {
  const [description, setDescription] = useState(String(entry?.description || ''));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const shift = PRODUCE_SHIFTS.find(item => item.code === shiftCode);

  const save = async (remove: boolean) => {
    if (!remove && !description.trim()) { setMessage('請填寫交接事項'); return; }
    if (remove && !confirmDelete) { setConfirmDelete(true); setMessage('刪除後仍會保留紀錄並以刪除線顯示；請再按一次確認。'); return; }
    setBusy(true); setMessage('');
    try {
      const { error } = await getSupabase().rpc('produce_entry_save', {
        p_group: group, p_market: market, p_date: date, p_shift: shiftCode,
        p_entry: entry?.entry_id ?? null, p_description: remove ? null : description, p_delete: remove,
      });
      if (error) throw error;
      await onDone(remove ? 'deleted' : entry ? 'updated' : 'created');
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };

  return <AdminModal className="produce-modal" title={`${entry ? '修改交接' : '新增交接'}｜${shift?.name || shiftCode} ${shift?.label || ''}`} onClose={onClose}>
    {entry && <div className="produce-history"><b>異動時間紀錄</b>
      <span>建立：{businessTime(entry.created_at)} · {String(entry.created_name || userName(entry.created_by))}</span>
      {entry.updated_at && <span>最後修改：{businessTime(entry.updated_at)} · {userName(entry.updated_by)}</span>}</div>}
    <div className="admin-form-grid produce-form"><label className="wide">現場移交事項
      <textarea rows={7} maxLength={ENTRY_MAX} value={description} onChange={event => setDescription(event.target.value)} placeholder="請填寫現場移交事項（例如：存貨交接、公物順移、廢貨交接⋯）" />
      <small>{description.length} / {ENTRY_MAX} 字；自由填寫，不限格式。</small></label></div>
    {message && <p role="alert" className="inline-message danger">{message}</p>}
    <footer>
      <button type="button" className="secondary-btn" onClick={onClose}>取消</button>
      {entry && <button type="button" className="danger-btn compact" disabled={busy} onClick={() => void save(true)}>{confirmDelete ? '確認刪除' : '刪除紀錄'}</button>}
      <button type="button" className="primary-btn compact" disabled={busy} onClick={() => void save(false)}>{busy ? '儲存中…' : entry ? '儲存修改' : '新增交接紀錄'}</button>
    </footer>
  </AdminModal>;
}

/* ───────────── 螢幕預覽與 A4 列印共用的報表 ───────────── */

function ProduceReport({ group, market, date, shifts, approvals }: {
  group: ProduceGroup; market: ProduceMarket; date: string; shifts: BusinessShift[]; approvals: ProduceApproval[];
}) {
  const groupName = PRODUCE_GROUPS[group].name;
  const info = PRODUCE_MARKET_NAMES[market];
  const stages = produceApprovalStages(group, market);
  const signed = stages.filter(stage => approvals.some(approval => approval.stage === stage.stage)).length;
  const entryCount = shifts.reduce((sum, shift) => sum + shift.items.filter(row => !isDeleted(row) && !row.carried).length, 0);
  const doneShifts = shifts.filter(shift => Boolean(shift.outgoing?.received_at)).length;
  return <div className="produce-print-content hs-report hs-daily-report">
    <HandoverReportHeading kicker={`${groupName}每日報表`} site={info.name} organization={`臺北農產運銷股份有限公司${info.name}`}
      title={`${groupName}現場值勤交接紀錄表`} subtitle="三班現場移交事項與三階段主管簽核" date={rocDate(date)}
      approved={signed === stages.length} approvedLabel="主管簽核完成" pendingLabel={`主管簽核進度 ${signed}/${stages.length}`} />
    <HandoverReportOverview label={`${groupName}日報摘要`} metrics={[
      { label: '交接紀錄', value: String(entryCount), detail: '筆' },
      { label: '完成交接班', value: String(doneShifts), detail: `班／${PRODUCE_SHIFTS.length} 班` },
      { label: '主管簽核', value: `${signed}/${stages.length}`, detail: signed === stages.length ? '全部完成' : '階段已簽' },
    ]} />
    <div className="hs-report-section-title">一、三班現場移交事項與交接簽認</div>
    <table className="produce-print-table hs-report-shift">
      <thead><tr><th style={{ width: '18%' }}>班別時段</th><th>現場移交事項</th></tr></thead>
      <tbody>{PRODUCE_SHIFTS.map((shift, index) => {
        const report = shifts.find(item => item.shift_code === shift.code);
        const rows = (report?.items || []).filter(row => !isDeleted(row));
        return <tr key={shift.code} className={`hs-report-shift-row hs-report-shift-${index + 1}`}>
          <td className="hs-report-shift-name"><b>{shift.name}</b><br /><small>{shift.label}</small></td>
          <td>
            {rows.length ? <ol className="produce-print-entries">{rows.map(row => <li key={String(row.entry_id)}>
              <b>【{row.is_completed ? '已完成' : '未完成／續辦'}】</b>
              {row.carried && <small>來源 {String(row.handover_date)} {produceShiftName(String(row.shift_code))}　</small>}
              {row.is_completed && <small>完成 {businessTime(row.completed_at)} · {String(row.completed_name)}　</small>}
              <span>{String(row.description || '')}</span></li>)}</ol> : <span className="produce-print-muted">本班無交接事項。</span>}
            <div className="produce-print-sign">
              <p>接班：{report?.incoming?.received_name || '尚未確認'} · {businessTime(report?.incoming?.received_at)}</p>
              <p>交班：{report?.outgoing?.handed_name || '尚未確認'} · {businessTime(report?.outgoing?.handed_at)}</p>
              <p>交予：{report?.outgoing?.receiver_name || '尚未指定'} · 下一班接班：{businessTime(report?.outgoing?.received_at)}</p>
            </div>
          </td>
        </tr>;
      })}</tbody>
    </table>
    <div className="hs-report-section-title">二、主管批核紀錄（{stages.map(item => item.label).join(' · ')}）</div>
    <div className="produce-print-approvals">{stages.map(stage => {
      const approval = approvals.find(item => item.stage === stage.stage);
      return <div key={stage.stage} className="hs-report-approval-stage">
        <div className="hs-report-approval-stage-heading"><strong>{stage.label}</strong>
          <span className={`hs-report-approval-stage-status${approval ? ' is-signed' : ''}`}>{approval ? '［已批核］' : '［未批核］'}</span></div>
        <div className="hs-report-approval-stage-body">
          <div><span>簽章／批核人：</span><b>{approval?.approver_name || '　　　　'}</b></div>
          <div><span>批核時間：</span><small>{approval ? businessTime(approval.approved_at) : '　　年　月　日'}</small></div>
          <div className="hs-report-approval-stage-note"><span>簽核說明（已保存）：</span><p>{approval ? approval.note || '簽核時未填寫說明' : '尚未簽核'}</p></div>
        </div>
      </div>;
    })}</div>
  </div>;
}
