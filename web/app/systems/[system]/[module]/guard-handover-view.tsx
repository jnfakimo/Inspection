// 駐警隊電子交接簿的純畫面元件：只吃資料與回呼，不讀寫任何服務。
// 資料載入、權限與動作都在 guard-handover.tsx；這裡的元件也可以單獨渲染來檢查版面。

import type { ReactNode } from 'react';
import { HandoverIcon, HandoverSheetHeader, type HandoverKpi, type IconName } from './handover-sheet';
import {
  SHIFT_STATE_LABELS, STATUS_LABELS, activityTime, fileSizeLabel, hhmm, incidentTime, itemLine, liveState, previewKind, rocDate,
  type Approval, type Attachment, type GuardLog, type GuardShift,
} from './guard-handover-shared';

// 圖示、表頭與指標卡片改用三本交接簿共用的 handover-sheet，版型才不會各走各的。
export const GuardIcon = HandoverIcon;
export type { IconName };
export type GuardKpi = HandoverKpi;

export function GuardSheetHeader({ date, kpis }: { date: string; kpis: GuardKpi[] }) {
  return <HandoverSheetHeader org="臺北農產運銷股份有限公司　第一果菜市場" title="駐警隊交接紀錄表"
    dateLabel={rocDate(date)} emblem="shield" kpis={kpis} />;
}

function Block({ icon, title, meta, tone, children }: { icon: IconName; title: string; meta?: string; tone?: 'alert'; children: ReactNode }) {
  return <div className={`hs-block${tone ? ` is-${tone}` : ''}`}>
    <h4><span className="hs-block-icon"><GuardIcon name={icon} size={15} /></span>{title}{meta ? <small>{meta}</small> : null}</h4>
    {children}
  </div>;
}

function conditionTone(condition: string) {
  return condition === '正常' ? 'is-ok' : condition === '損壞' || condition === '遺失' ? 'is-bad' : 'is-warn';
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

export function GuardShiftCard({ index, shift, log, nameOf, namesOf, actions, canEdit, attachmentsFor, onPreview, now }: {
  index: number; shift: GuardShift; log: GuardLog | null; nameOf: (id: unknown) => string; namesOf: (ids: string[] | null | undefined) => string;
  actions: ReactNode; canEdit: boolean; attachmentsFor: (shiftName: string, incidentId: string) => Attachment[]; onPreview: (file: Attachment) => void;
  now?: number;
}) {
  const frozen = Boolean(log && log.status !== 'draft');
  const times = frozen && log ? log : shift;
  const scheduled = frozen && log ? log.scheduled_user_ids : shift.scheduled_user_ids;
  const patrol = frozen && log?.patrol_snapshot ? log.patrol_snapshot : shift.patrol;
  const snapshot = Boolean(frozen && log?.patrol_snapshot);
  const state = liveState(now, shift.work_from, shift.work_to, shift.state) ?? shift.state;
  const patrolNow = liveState(now, shift.patrol_from, shift.patrol_to) === 'active';
  const current = state === 'active';
  const notStarted = state === 'upcoming' && !snapshot;
  const rateTone = patrol.rate >= 100 ? 'is-ok' : patrol.rate >= 60 ? 'is-warn' : 'is-bad';
  const incidents = log?.incidents || [];

  return <section className={`hs-shift hs-shift-${(index % 4) + 1}${current ? ' is-current' : ''}`} aria-current={current ? 'time' : undefined}>
    <div className="hs-shift-head">
      <div className="hs-shift-title">
        <strong className="hs-shift-no">{index + 1}</strong>
        <div>
          <div className="hs-shift-name"><b>{shift.name}</b>{current
            ? <span className="hs-current-badge"><i className="hs-pulse-dot" aria-hidden="true" />當班中</span>
            : <span className={`hs-state is-${state}`}>{SHIFT_STATE_LABELS[state] || state}</span>}</div>
          <div className="hs-shift-times">
            <span className={`hs-chip${current ? ' is-now' : ''}`}><GuardIcon name="clock" size={14} />班別 {hhmm(times.shift_start)}–{hhmm(times.shift_end)}</span>
            <span className={`hs-chip${patrolNow ? ' is-now' : ''}`}><GuardIcon name="route" size={14} />預定巡檢 {hhmm(times.patrol_start)}–{hhmm(times.patrol_end)}{patrolNow ? '・巡檢進行中' : ''}</span>
          </div>
        </div>
      </div>
      <div className="hs-shift-actions">
        <span className={`hs-pill${log ? ` is-${log.status}` : ''}`}>{log ? STATUS_LABELS[log.status] || log.status : '尚未建立'}</span>
        {actions}
      </div>
    </div>
    <div className="hs-shift-body">
      <div className="hs-col">
        <Block icon="users" title="值勤人員"><dl className="hs-staff">
          <dt>排定人員</dt><dd>{namesOf(scheduled)}<small>巡檢排班</small></dd>
          <dt>實際值勤</dt><dd>{log ? namesOf(log.actual_user_ids) : '—'}</dd>
          {log?.substitute_note ? <><dt>代班說明</dt><dd>{log.substitute_note}</dd></> : null}
        </dl></Block>
        {log ? <>
          <Block icon="note" title="勤務概況"><p className={log.duty_summary ? '' : 'hs-muted'}>{log.duty_summary || '尚未填寫'}</p></Block>
          <Block icon="flag" title="重要交辦事項"><p className={log.important_notes ? '' : 'hs-muted'}>{log.important_notes || '無'}</p></Block>
          <Block icon="alert" title="異常事件" meta={`${incidents.length} 件`} tone={incidents.length ? 'alert' : undefined}>
            {incidents.length ? <ol className="hs-events">{incidents.map((incident, itemIndex) => <li key={incident.id || itemIndex}>
              <div className="hs-event-top">
                <span className="hs-tag is-alert">{incident.category}</span>
                <time>{incidentTime(incident.time)}</time>
                <span className="hs-event-place">{incident.location || '地點未填'}</span>
              </div>
              <p>{incident.description}</p>
              {incident.action ? <p><b>處理：</b>{incident.action}</p> : null}
              {incident.reported_to ? <p><b>通報：</b>{incident.reported_to}</p> : null}
              <AttachmentChips files={attachmentsFor(shift.name, incident.id)} onPreview={onPreview} />
            </li>)}</ol> : <p className="hs-muted">本班無異常事件。</p>}
          </Block>
        </> : <div className="hs-empty-shift"><span className="hs-block-icon"><GuardIcon name="note" size={18} /></span>
          <p>本班尚未建立交接。{canEdit ? '請由值勤人員按「建立交接」填寫。' : ''}</p></div>}
      </div>
      <div className="hs-col">
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
          {log.items.length ? <table className="hs-mini-table"><thead><tr><th>物品</th><th>數量</th><th>狀態</th><th>備註</th></tr></thead><tbody>
            {log.items.map((item, itemIndex) => <tr key={itemIndex}><td>{item.name}</td><td>{item.qty}</td>
              <td><span className={`hs-tag ${conditionTone(item.condition)}`}>{item.condition}</span></td><td>{item.note || '—'}</td></tr>)}
          </tbody></table> : <p className="hs-muted">未登錄點交物品。</p>}
        </Block>}
        {log && <Block icon="pen" title="交接簽名" meta={`最後編修 ${activityTime(log.updated_at)} · ${nameOf(log.updated_by)}`}>
          <div className="hs-signs">
            <div className={`hs-sign${log.handover_by ? ' is-signed' : ''}`}><span className="hs-sign-icon"><GuardIcon name={log.handover_by ? 'check' : 'pen'} size={16} /></span>
              <div><span>交班人</span><b>{log.handover_by ? nameOf(log.handover_by) : '尚未簽名'}</b>{log.handover_at && <small>{activityTime(log.handover_at)}</small>}</div></div>
            <div className={`hs-sign${log.takeover_by ? ' is-signed' : ''}`}><span className="hs-sign-icon"><GuardIcon name={log.takeover_by ? 'check' : 'pen'} size={16} /></span>
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
  return <section className="hs-report">
    <header><h2>臺北農產運銷股份有限公司第一果菜市場<br />駐警隊交接紀錄表</h2><p>{rocDate(date)}</p></header>
    {shifts.length ? shifts.map(shift => {
      const log = logFor(shift.name);
      const frozen = Boolean(log && log.status !== 'draft');
      const times = frozen && log ? log : shift;
      const patrol = frozen && log?.patrol_snapshot ? log.patrol_snapshot : shift.patrol;
      const scheduled = frozen && log ? log.scheduled_user_ids : shift.scheduled_user_ids;
      return <table className="hs-report-shift" key={shift.name}><tbody>
        <tr><th className="hs-report-label">班別</th><td>{shift.name}（{hhmm(times.shift_start)}–{hhmm(times.shift_end)}）</td><th className="hs-report-label">預定巡檢</th><td>{hhmm(times.patrol_start)}–{hhmm(times.patrol_end)}　狀態：{log ? STATUS_LABELS[log.status] || log.status : '尚未建立'}</td></tr>
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
    }) : <p className="hs-report-empty">巡檢排班沒有任何啟用中的班別。</p>}
    <footer>
      <div><b>主管簽核</b><br />{approval ? `${nameOf(approval.approver_id)}　${activityTime(approval.approved_at)}${approval.note ? `\n說明：${approval.note}` : ''}` : '尚未簽核'}</div>
      <div><b>產製時間</b><br />{activityTime(new Date().toISOString())}</div>
    </footer>
  </section>;
}
