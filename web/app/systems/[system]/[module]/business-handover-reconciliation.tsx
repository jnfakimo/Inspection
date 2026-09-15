'use client';

import { useState } from 'react';
import { AdminModal, type Row } from '@/components/admin/shared';
import { BlankSelectOption } from '@/components/BlankSelectOption';

export type BusinessTransfer = {
  transfer_id: string; handover_date: string; shift_code: string; next_date: string; next_shift: string;
  items: Row[]; revision: string; handed_by: string; handed_name: string; handed_at: string;
  receiver_id: string; receiver_name: string; received_by: string | null; received_name: string | null; received_at: string | null;
};
export type BusinessShift = {
  shift_code: string; items: Row[]; revision: string;
  outgoing: BusinessTransfer | null; incoming: BusinessTransfer | null;
};
export type BusinessConfirmation = { operation: 'submit' | 'receive' | 'complete'; shift: BusinessShift; entry?: Row };
export const businessShiftName = (code: string) => ({ '01-09': '早班', '09-17': '中班', '17-01': '晚班' }[code] || code);
export function businessTime(value: unknown) {
  if (!value) return '尚未確認';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(String(value)));
}
export function BusinessSignatures({ shift, profileId, disabled, onConfirm }: {
  shift: BusinessShift; profileId: string; disabled: boolean; onConfirm: (value: BusinessConfirmation) => void;
}) {
  const { incoming, outgoing } = shift;
  return <div className="business-reconciliation">
    <div className="hs-signs">
      <div className={`hs-sign${incoming?.received_at ? ' is-signed' : ''}`}>
        <div>
          <span>本班接班確認</span>
          {incoming ? <>
            <b>{incoming.handed_name} → {incoming.receiver_name}</b>
            <small>來源：{incoming.handover_date} {businessShiftName(incoming.shift_code)}</small>
            <small>交班：{businessTime(incoming.handed_at)}</small>
            <small>接班：{businessTime(incoming.received_at)}</small>
            {!incoming.received_at && <button type="button" className="primary-btn compact"
              disabled={disabled || incoming.receiver_id !== profileId}
              onClick={() => onConfirm({ operation: 'receive', shift })}>核對上一班內容並確認接班</button>}
          </> : <b>上一班尚未送出交班</b>}
        </div>
      </div>
      <div className={`hs-sign${outgoing?.received_at ? ' is-signed' : ''}`}>
        <div>
          <span>本班交班至下一班</span>
          {outgoing ? <>
            <b>{outgoing.handed_name} → {outgoing.receiver_name}</b>
            <small>交班：{businessTime(outgoing.handed_at)}</small>
            <small>下一班接班：{businessTime(outgoing.received_at)}</small>
            <small>{outgoing.received_at ? '雙方已完成交接勾稽' : '等待指定接班人本人確認'}</small>
          </> : <>
            <b>尚未交班</b>
            <button type="button" className="primary-btn compact" disabled={disabled || Boolean(incoming && (!incoming.received_at || incoming.received_by !== profileId))}
              onClick={() => onConfirm({ operation: 'submit', shift })}>核對事項並送出交班</button>
          </>}
        </div>
      </div>
    </div>
  </div>;
}

export function BusinessConfirmModal({ confirmation, users, profileId, busy, message, onClose, onSave }: {
  confirmation: BusinessConfirmation; users: Row[]; profileId: string; busy: boolean; message: string;
  onClose: () => void; onSave: (receiverId: string) => void;
}) {
  const [receiver, setReceiver] = useState('');
  const { operation, shift, entry } = confirmation;
  const title = operation === 'complete' ? '登記事項已完成' : operation === 'receive' ? '核對上一班交接內容' : '核對本班並指定接班人';
  const items = entry ? [entry] : operation === 'receive' ? shift.incoming?.items || [] : shift.items;
  return <AdminModal title={title} onClose={() => { if (!busy) onClose(); }}>
    <div className="business-confirm-content">
      <p>{operation === 'complete' ? '確認事項已處理完成後，下一班起停止續帶；來源與完成時間會永久保留。'
        : operation === 'receive' ? '請逐項核對下列交班快照。確認接班不代表事項已完成，未完成事項仍須接續處理。'
        : '送出後保存本班交接內容與時間，原始內容鎖定。未完成事項將持續帶入下一班，直到登記完成。'}</p>
      {items.filter(item => !item.is_deleted).length ? <ol className="business-confirm-items">
        {items.filter(item => !item.is_deleted).map(item => <li key={String(item.entry_id)}>
          <b>{item.is_completed ? '已完成' : '未完成・續辦'} · {String(item.category)}</b>
          <p>{String(item.description).replace(/^本日應出勤人數：\d+ 人；未出勤人數：\d+ 人。\s*/u, '')}</p>
          <small>來源：{String(item.handover_date)} {businessShiftName(String(item.shift_code))}</small>
        </li>)}
      </ol> : <p>本班無交接事項，仍須由雙方確認交接。</p>}
      {operation === 'submit' && <label>下一班接班人
        <select value={receiver} onChange={event => setReceiver(event.target.value)} disabled={busy}>
          <BlankSelectOption />
          {users.filter(user => user.user_id !== profileId).map(user => <option key={String(user.user_id)} value={String(user.user_id)}>{String(user.name)}{user.department ? `（${user.department}）` : ''}</option>)}
        </select>
      </label>}
      {message && <p role="alert">{message}</p>}
      <div className="business-stage-actions">
        <button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="primary-btn" onClick={() => onSave(receiver)} disabled={busy || (operation === 'submit' && !receiver)}>
          {busy ? '儲存中…' : operation === 'complete' ? '確認已完成' : operation === 'receive' ? '本人確認接班' : '本人確認交班'}
        </button>
      </div>
    </div>
  </AdminModal>;
}
