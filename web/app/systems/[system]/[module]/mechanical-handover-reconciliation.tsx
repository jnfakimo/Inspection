'use client';

import { useState } from 'react';
import { AdminModal, type Row } from '@/components/admin/shared';
import { BlankSelectOption } from '@/components/BlankSelectOption';

export type MechanicalTransfer = {
  transfer_id: string; handover_date: string; shift_code: string; next_date: string; next_shift: string;
  items: Row[]; revision: string; handed_by: string; handed_name: string; handed_at: string;
  receiver_id: string; receiver_name: string; received_by: string | null; received_name: string | null; received_at: string | null;
};
export type MechanicalShiftReport = {
  shift_code: string; items: Row[]; revision: string;
  outgoing: MechanicalTransfer | null; incoming: MechanicalTransfer | null;
};
export type MechanicalConfirmation = { operation: 'submit' | 'receive'; shift: MechanicalShiftReport };

export const mechanicalShiftName = (code: string) => ({ '01-09': '早班', '09-17': '中班', '17-01': '晚班' }[code] || code);
export function mechanicalHandoverTime(value: unknown) {
  if (!value) return '尚未確認';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(String(value)));
}

export function MechanicalSignatures({ shift, profileId, disabled, onConfirm }: {
  shift: MechanicalShiftReport; profileId: string; disabled: boolean; onConfirm: (value: MechanicalConfirmation) => void;
}) {
  const { incoming, outgoing } = shift;
  return <div className="mechanical-reconciliation">
    <div className="hs-signs">
      <div className={`hs-sign${incoming?.received_at ? ' is-signed' : ''}`}><div>
        <span>本班接班確認</span>
        {incoming ? <>
          <b>{incoming.handed_name} → {incoming.receiver_name}</b>
          <small>來源：{incoming.handover_date} {mechanicalShiftName(incoming.shift_code)}</small>
          <small>交班：{mechanicalHandoverTime(incoming.handed_at)}</small>
          <small>接班：{mechanicalHandoverTime(incoming.received_at)}</small>
          {!incoming.received_at && <button type="button" className="primary-btn compact"
            disabled={disabled || incoming.receiver_id !== profileId}
            onClick={() => onConfirm({ operation: 'receive', shift })}>核對上一班內容並確認接班</button>}
        </> : <b>上一班尚未送出交班</b>}
      </div></div>
      <div className={`hs-sign${outgoing?.received_at ? ' is-signed' : ''}`}><div>
        <span>本班交班至下一班</span>
        {outgoing ? <>
          <b>{outgoing.handed_name} → {outgoing.receiver_name}</b>
          <small>交班：{mechanicalHandoverTime(outgoing.handed_at)}</small>
          <small>下一班接班：{mechanicalHandoverTime(outgoing.received_at)}</small>
          <small>{outgoing.received_at ? '雙方已完成交接勾稽' : '等待指定接班人本人確認'}</small>
        </> : <>
          <b>尚未交班</b>
          <button type="button" className="primary-btn compact"
            disabled={disabled || Boolean(incoming && (!incoming.received_at || incoming.received_by !== profileId))}
            onClick={() => onConfirm({ operation: 'submit', shift })}>核對事項並送出交班</button>
        </>}
      </div></div>
    </div>
  </div>;
}

export function MechanicalConfirmModal({ confirmation, users, profileId, busy, message, onClose, onSave }: {
  confirmation: MechanicalConfirmation; users: Row[]; profileId: string; busy: boolean; message: string;
  onClose: () => void; onSave: (receiverId: string) => void;
}) {
  const [receiver, setReceiver] = useState('');
  const { operation, shift } = confirmation;
  const items = operation === 'receive' ? shift.incoming?.items || [] : shift.items;
  return <AdminModal title={operation === 'receive' ? '核對上一班交接內容' : '核對本班並指定接班人'} onClose={() => { if (!busy) onClose(); }}>
    <div className="mechanical-confirm-content">
      <p>{operation === 'receive'
        ? '請逐項核對交班快照。確認接班不代表工作已完成，未完成工作會繼續帶入本班。'
        : '送出後會保存本班工作快照與交班時間。未完成工作會自動帶入下一班，直到續辦紀錄標示完成。'}</p>
      {items.length ? <ol className="mechanical-confirm-items">{items.map(item => <li key={String(item.entry_id)}>
        <b>{item.is_completed ? '已完成' : '未完成・續辦'} · {String(item.work_item || '未選常用工作項目')}</b>
        <p>{String(item.details || item.notes || '無補充說明')}</p>
        <small>來源：{String(item.work_date)} {mechanicalShiftName(String(item.shift_code))} · 處理結果：{String(item.result || '—')}</small>
      </li>)}</ol> : <p>本班無工作事項，仍須由雙方確認交接。</p>}
      {operation === 'submit' && <label>下一班接班人<select value={receiver} onChange={event => setReceiver(event.target.value)} disabled={busy}>
        <BlankSelectOption />
        {users.filter(user => user.user_id !== profileId).map(user => <option key={String(user.user_id)} value={String(user.user_id)}>{String(user.name)}{user.department ? `（${user.department}）` : ''}</option>)}
      </select></label>}
      {message && <p role="alert">{message}</p>}
      <div className="mechanical-confirm-actions">
        <button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="primary-btn" onClick={() => onSave(receiver)} disabled={busy || (operation === 'submit' && !receiver)}>
          {busy ? '儲存中…' : operation === 'receive' ? '本人確認接班' : '本人確認交班'}
        </button>
      </div>
    </div>
  </AdminModal>;
}
