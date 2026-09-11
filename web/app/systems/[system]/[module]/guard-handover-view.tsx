// 駐衛警電子交接簿的純畫面元件：只吃資料與回呼，不讀寫任何服務。
// 資料載入、權限與動作都在 guard-handover.tsx；這裡的元件也可以單獨渲染來檢查版面。

import type { ReactNode } from 'react';
import {
  SHIFT_STATE_LABELS, STATUS_LABELS, activityTime, fileSizeLabel, hhmm, incidentTime, itemLine, previewKind, rocDate,
  type Approval, type Attachment, type GuardLog, type GuardShift,
} from './guard-handover-shared';

export type IconName = 'shield' | 'clock' | 'route' | 'users' | 'note' | 'flag' | 'alert' | 'box' | 'pen' | 'check' | 'clip' | 'image' | 'video' | 'file' | 'doc' | 'calendar';

// 線條圖示一律用 currentColor，跟著主題與所在元件的顏色走，不另外寫死色碼。
const ICON_PATHS: Record<IconName, ReactNode> = {
  shield: <><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  route: <><path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2.2" /></>,
  users: <><circle cx="9.5" cy="7.5" r="3.5" /><path d="M3 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1" /><path d="M16 4.3a3.5 3.5 0 0 1 0 6.4" /><path d="M21 20v-1a4.5 4.5 0 0 0-3-4.2" /></>,
  note: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  alert: <><path d="M12 3.5l9 16H3l9-16z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
  box: <><path d="M3 7.5l9-4.5 9 4.5-9 4.5-9-4.5z" /><path d="M3 7.5v9l9 4.5 9-4.5v-9" /><path d="M12 12v9" /></>,
  pen: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  clip: <path d="M20.5 11.5l-8.2 8.2a5.3 5.3 0 0 1-7.5-7.5l8.2-8.2a3.6 3.6 0 0 1 5.1 5.1l-8.2 8.2a1.8 1.8 0 0 1-2.5-2.5l7.5-7.5" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M21 16l-5-5L6 20" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5l5-3v9l-5-3z" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
};

export function GuardIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg className="guard-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICON_PATHS[name]}</svg>;
}

export type GuardKpi = { label: string; value: string; icon: IconName; tone: 'cyan' | 'green' | 'amber' | 'red' | 'violet' };

export function GuardSheetHeader({ date, kpis }: { date: string; kpis: GuardKpi[] }) {
  return <>
    <header className="guard-sheet-head">
      <div className="guard-sheet-title">
        <span className="guard-sheet-emblem"><GuardIcon name="shield" size={28} /></span>
        <div><small>臺北農產運銷股份有限公司　第一果菜市場</small><h2>駐衛警交接紀錄表</h2></div>
      </div>
      <b className="guard-date-chip"><GuardIcon name="calendar" size={17} />{rocDate(date)}</b>
    </header>
    {kpis.length > 0 && <div className="guard-kpis">{kpis.map(kpi => <div className={`guard-kpi is-${kpi.tone}`} key={kpi.label}>
      <span className="guard-kpi-icon"><GuardIcon name={kpi.icon} size={19} /></span>
      <div><b>{kpi.value}</b><small>{kpi.label}</small></div>
    </div>)}</div>}
  </>;
}

function Block({ icon, title, meta, tone, children }: { icon: IconName; title: string; meta?: string; tone?: 'alert'; children: ReactNode }) {
  return <div className={`guard-block${tone ? ` is-${tone}` : ''}`}>
    <h4><span className="guard-block-icon"><GuardIcon name={icon} size={15} /></span>{title}{meta ? <small>{meta}</small> : null}</h4>
    {children}
  </div>;
}

function conditionTone(condition: string) {
  return condition === '正常' ? 'is-ok' : condition === '短少' ? 'is-warn' : 'is-bad';
}

export function AttachmentChips({ files, onPreview, onRemove }: {
  files: Attachment[]; onPreview: (file: Attachment) => void; onRemove?: (file: Attachment) => void;
}) {
  if (!files.length) return null;
  return <div className="guard-files">{files.map(file => {
    const kind = previewKind(file.content_type, file.file_name);
    const icon: IconName = kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'pdf' ? 'doc' : 'file';
    return <span className="guard-file-wrap" key={file.attachment_id}>
      <button type="button" className="guard-file" onClick={() => onPreview(file)} title={`預覽 ${file.file_name}`}>
        <span className={`guard-file-icon is-${kind}`}><GuardIcon name={icon} size={16} /></span>
        <span className="guard-file-text"><span className="guard-file-name">{file.file_name}</span>
          <small>{fileSizeLabel(file.file_size)}{file.compressed ? '・已壓縮' : ''}</small></span>
      </button>
      {onRemove && <button type="button" className="guard-file-remove" aria-label={`移除附件 ${file.file_name}`} onClick={() => onRemove(file)}>×</button>}
    </span>;
  })}</div>;
}

export function GuardShiftCard({ index, shift, log, nameOf, namesOf, actions, canEdit, attachmentsFor, onPreview }: {
  index: number; shift: GuardShift; log: GuardLog | null; nameOf: (id: unknown) => string; namesOf: (ids: string[] | null | undefined) => string;
  actions: ReactNode; canEdit: boolean; attachmentsFor: (shiftName: string, incidentId: string) => Attachment[]; onPreview: (file: Attachment) => void;
}) {
  const frozen = Boolean(log && log.status !== 'draft');
  const times = frozen && log ? log : shift;
  const scheduled = frozen && log ? log.scheduled_user_ids : shift.scheduled_user_ids;
  const patrol = frozen && log?.patrol_snapshot ? log.patrol_snapshot : shift.patrol;
  const snapshot = Boolean(frozen && log?.patrol_snapshot);
  const notStarted = shift.state === 'upcoming' && !snapshot;
  const rateTone = patrol.rate >= 100 ? 'is-ok' : patrol.rate >= 60 ? 'is-warn' : 'is-bad';
  const incidents = log?.incidents || [];

  return <section className={`guard-shift guard-shift-${(index % 4) + 1}`}>
    <div className="guard-shift-head">
      <div className="guard-shift-title">
        <strong className="guard-shift-no">{index + 1}</strong>
        <div>
          <div className="guard-shift-name"><b>{shift.name}</b><span className={`guard-state is-${shift.state}`}>{SHIFT_STATE_LABELS[shift.state] || shift.state}</span></div>
          <div className="guard-shift-times">
            <span className="guard-chip"><GuardIcon name="clock" size={14} />班別 {hhmm(times.shift_start)}–{hhmm(times.shift_end)}</span>
            <span className="guard-chip"><GuardIcon name="route" size={14} />預定巡檢 {hhmm(times.patrol_start)}–{hhmm(times.patrol_end)}</span>
          </div>
        </div>
      </div>
      <div className="guard-shift-actions">
        <span className={`guard-pill${log ? ` is-${log.status}` : ''}`}>{log ? STATUS_LABELS[log.status] || log.status : '尚未建立'}</span>
        {actions}
      </div>
    </div>
    <div className="guard-shift-body">
      <div className="guard-col">
        <Block icon="users" title="值勤人員"><dl className="guard-staff">
          <dt>排定人員</dt><dd>{namesOf(scheduled)}<small>巡檢排班</small></dd>
          <dt>實際值勤</dt><dd>{log ? namesOf(log.actual_user_ids) : '—'}</dd>
          {log?.substitute_note ? <><dt>代班說明</dt><dd>{log.substitute_note}</dd></> : null}
        </dl></Block>
        {log ? <>
          <Block icon="note" title="勤務概況"><p className={log.duty_summary ? '' : 'guard-muted'}>{log.duty_summary || '尚未填寫'}</p></Block>
          <Block icon="flag" title="重要交辦事項"><p className={log.important_notes ? '' : 'guard-muted'}>{log.important_notes || '無'}</p></Block>
          <Block icon="alert" title="異常事件" meta={`${incidents.length} 件`} tone={incidents.length ? 'alert' : undefined}>
            {incidents.length ? <ol className="guard-incidents">{incidents.map((incident, itemIndex) => <li key={incident.id || itemIndex}>
              <div className="guard-incident-top">
                <span className="guard-tag is-alert">{incident.category}</span>
                <time>{incidentTime(incident.time)}</time>
                <span className="guard-incident-place">{incident.location || '地點未填'}</span>
              </div>
              <p>{incident.description}</p>
              {incident.action ? <p><b>處理：</b>{incident.action}</p> : null}
              {incident.reported_to ? <p><b>通報：</b>{incident.reported_to}</p> : null}
              <AttachmentChips files={attachmentsFor(shift.name, incident.id)} onPreview={onPreview} />
            </li>)}</ol> : <p className="guard-muted">本班無異常事件。</p>}
          </Block>
        </> : <div className="guard-empty-shift"><span className="guard-block-icon"><GuardIcon name="note" size={18} /></span>
          <p>本班尚未建立交接。{canEdit ? '請由值勤人員按「建立交接」填寫。' : ''}</p></div>}
      </div>
      <div className="guard-col">
        <Block icon="route" title="巡邏打卡摘要" meta={`${snapshot ? '交班時快照' : '即時統計'}・${patrol.window_start}–${patrol.window_end}`}>
          <div className="guard-patrol-stats">
            <div><b>{patrol.expected}</b><span>應打卡</span></div>
            <div><b>{notStarted ? '—' : patrol.checked}</b><span>已打卡</span></div>
            <div className={!notStarted && patrol.unchecked ? 'is-low' : ''}><b>{notStarted ? '—' : patrol.unchecked}</b><span>未打卡</span></div>
            <div className={!notStarted && patrol.rate < 100 ? 'is-low' : ''}><b>{notStarted ? '—' : `${patrol.rate}%`}</b><span>完成率</span></div>
          </div>
          {!notStarted && <div className="guard-progress" role="progressbar" aria-label="巡邏完成率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={patrol.rate}>
            <span className={rateTone} style={{ width: `${Math.max(0, Math.min(100, patrol.rate))}%` }} />
          </div>}
          <p className="guard-patrol-note">{notStarted ? '本班尚未開始巡檢。'
            : patrol.unchecked_floors.length ? `未打卡樓層：${patrol.unchecked_floors.map(floor => `${floor.floor}×${floor.count}`).join('、')}` : '所有巡邏點均已打卡。'}
          {!notStarted && patrol.checkers.length ? `　打卡人員：${patrol.checkers.join('、')}` : ''}</p>
        </Block>
        {log && <Block icon="box" title="物品點交" meta={`${log.items.length} 項`}>
          {log.items.length ? <table className="guard-mini-table"><thead><tr><th>物品</th><th>數量</th><th>狀態</th><th>備註</th></tr></thead><tbody>
            {log.items.map((item, itemIndex) => <tr key={itemIndex}><td>{item.name}</td><td>{item.qty}</td>
              <td><span className={`guard-tag ${conditionTone(item.condition)}`}>{item.condition}</span></td><td>{item.note || '—'}</td></tr>)}
          </tbody></table> : <p className="guard-muted">未登錄點交物品。</p>}
        </Block>}
        {log && <Block icon="pen" title="交接簽名" meta={`最後編修 ${activityTime(log.updated_at)} · ${nameOf(log.updated_by)}`}>
          <div className="guard-signs">
            <div className={`guard-sign${log.handover_by ? ' is-signed' : ''}`}><span className="guard-sign-icon"><GuardIcon name={log.handover_by ? 'check' : 'pen'} size={16} /></span>
              <div><span>交班人</span><b>{log.handover_by ? nameOf(log.handover_by) : '尚未簽名'}</b>{log.handover_at && <small>{activityTime(log.handover_at)}</small>}</div></div>
            <div className={`guard-sign${log.takeover_by ? ' is-signed' : ''}`}><span className="guard-sign-icon"><GuardIcon name={log.takeover_by ? 'check' : 'pen'} size={16} /></span>
              <div><span>接班人</span><b>{log.takeover_by ? nameOf(log.takeover_by) : '尚未簽名'}</b>{log.takeover_at && <small>{activityTime(log.takeover_at)}</small>}</div></div>
          </div>
        </Block>}
      </div>
    </div>
  </section>;
}

export function GuardDailyReport({ date, shifts, approval, logFor, nameOf, namesOf, attachmentCount }: {
  date: string; shifts: GuardShift[]; approval: Approval | null; logFor: (name: string) => GuardLog | null;
  nameOf: (id: unknown) => string; namesOf: (ids: string[] | null | undefined) => string;
  attachmentCount: (shiftName: string, incidentId: string) => number;
}) {
  return <section className="guard-report">
    <header><h2>臺北農產運銷股份有限公司第一果菜市場<br />駐衛警交接紀錄表</h2><p>{rocDate(date)}</p></header>
    {shifts.length ? shifts.map(shift => {
      const log = logFor(shift.name);
      const frozen = Boolean(log && log.status !== 'draft');
      const times = frozen && log ? log : shift;
      const patrol = frozen && log?.patrol_snapshot ? log.patrol_snapshot : shift.patrol;
      const scheduled = frozen && log ? log.scheduled_user_ids : shift.scheduled_user_ids;
      return <table className="guard-report-shift" key={shift.name}><tbody>
        <tr><th className="guard-report-label">班別</th><td>{shift.name}（{hhmm(times.shift_start)}–{hhmm(times.shift_end)}）</td><th className="guard-report-label">預定巡檢</th><td>{hhmm(times.patrol_start)}–{hhmm(times.patrol_end)}　狀態：{log ? STATUS_LABELS[log.status] || log.status : '尚未建立'}</td></tr>
        <tr><th>排定人員</th><td>{namesOf(scheduled)}</td><th>實際值勤</th><td>{log ? namesOf(log.actual_user_ids) : '—'}{log?.substitute_note ? `\n代班：${log.substitute_note}` : ''}</td></tr>
        <tr><th>勤務概況</th><td colSpan={3}>{log?.duty_summary || '—'}</td></tr>
        <tr><th>重要交辦</th><td colSpan={3}>{log?.important_notes || '—'}</td></tr>
        <tr><th>異常事件</th><td colSpan={3}>{log?.incidents.length ? log.incidents.map(incident => {
          const files = attachmentCount(shift.name, incident.id);
          // 各段自己結尾的標點先去掉再以「；」串接，避免印出「。；」這種重複標點。
          const clean = (value: string) => value.trim().replace(/[。；;，,、]+$/u, '');
          const parts = [`${incident.category}：${clean(incident.description)}`,
            incident.action ? `處理：${clean(incident.action)}` : '', incident.reported_to ? `通報：${clean(incident.reported_to)}` : ''].filter(Boolean);
          return `${incidentTime(incident.time)}　${incident.location || '—'}　${parts.join('；')}${files ? `（附件 ${files} 件）` : ''}`;
        }).join('\n') : '無'}</td></tr>
        <tr><th>物品點交</th><td colSpan={3}>{log?.items.length ? log.items.map(itemLine).join('、') : '—'}</td></tr>
        <tr><th>巡邏打卡</th><td colSpan={3}>{`應打卡 ${patrol.expected}／已打卡 ${patrol.checked}／完成率 ${patrol.rate}%`}{patrol.unchecked_floors.length ? `；未打卡：${patrol.unchecked_floors.map(floor => `${floor.floor}×${floor.count}`).join('、')}` : ''}</td></tr>
        <tr><th>交班簽名</th><td>{log?.handover_by ? `${nameOf(log.handover_by)}　${activityTime(log.handover_at)}` : ''}</td><th>接班簽名</th><td>{log?.takeover_by ? `${nameOf(log.takeover_by)}　${activityTime(log.takeover_at)}` : ''}</td></tr>
      </tbody></table>;
    }) : <p className="guard-report-empty">巡檢排班沒有任何啟用中的班別。</p>}
    <footer>
      <div><b>主管簽核</b><br />{approval ? `${nameOf(approval.approver_id)}　${activityTime(approval.approved_at)}${approval.note ? `\n說明：${approval.note}` : ''}` : '尚未簽核'}</div>
      <div><b>產製時間</b><br />{activityTime(new Date().toISOString())}</div>
    </footer>
  </section>;
}
