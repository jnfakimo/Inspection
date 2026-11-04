'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeAppApi } from '@/lib/supabase';
import { createRequestSequence } from '@/lib/request-sequence';
import { createVehicleLineActionLock } from '@/lib/vehicle-line-binding';

type Status = { linked: boolean; linked_at: string | null; pending_expires_at: string | null };
type Subscription = { equipment_id: string; asset_code: string | null; qr_code: string | null; name: string };

export default function EquipmentLineLinkSection({ index, assetsAllowed, monitoringAllowed }: {
  index: string; assetsAllowed: boolean; monitoringAllowed: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [subscriptionCode, setSubscriptionCode] = useState('');
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const requests = useRef(createRequestSequence());
  const actionLock = useRef(createVehicleLineActionLock());
  const refresh = useCallback(async () => {
    const request = requests.current.begin();
    try {
      const result = await invokeAppApi<Status>('equipment_line_link_status');
      if (!requests.current.isCurrent(request)) return;
      setStatus(result);
      if (result.linked) setCode('');
      if (result.linked) {
        const list = await invokeAppApi<Subscription[]>('equipment_line_subscriptions');
        if (!requests.current.isCurrent(request)) return;
        setSubscriptions(list);
      } else setSubscriptions([]);
      setMessage('');
    } catch (error) {
      if (!requests.current.isCurrent(request)) return;
      setMessage(error instanceof Error ? error.message : 'LINE 綁定狀態讀取失敗。');
    }
  }, []);
  useEffect(() => {
    const sequence = requests.current;
    void refresh();
    return () => sequence.invalidate();
  }, [refresh]);

  const start = async () => {
    if (!consent) return;
    const lease = actionLock.current.acquire();
    if (!lease) return;
    requests.current.invalidate();
    setBusy(true); setMessage('');
    try {
      const result = await invokeAppApi<{ code: string; expires_at: string }>('equipment_line_link_start', { consent: true });
      if (!result.code) throw new Error('綁定代碼產生失敗。');
      setCode(result.code);
      setStatus({ linked: false, linked_at: null, pending_expires_at: result.expires_at });
      setConsent(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '綁定代碼產生失敗。');
    } finally { if (actionLock.current.release(lease)) setBusy(false); }
  };
  const unlink = async () => {
    const lease = actionLock.current.acquire();
    if (!lease) return;
    requests.current.invalidate();
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('equipment_line_unlink');
      setConfirmUnlink(false); setCode('');
      await refresh();
      setMessage('已解除設備查詢 LINE 綁定。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '解除綁定失敗。');
    } finally { if (actionLock.current.release(lease)) setBusy(false); }
  };
  const subscribe = async () => {
    const lease = actionLock.current.acquire();
    if (!lease) return;
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('equipment_line_subscribe', { code: subscriptionCode.trim() });
      setSubscriptionCode('');
      await refresh();
      setMessage('已訂閱此設備的未結警示與緊急監控事件。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '訂閱失敗。');
    } finally { if (actionLock.current.release(lease)) setBusy(false); }
  };
  const unsubscribe = async (equipmentId: string) => {
    const lease = actionLock.current.acquire();
    if (!lease) return;
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('equipment_line_unsubscribe', { equipment_id: equipmentId });
      await refresh();
      setMessage('已取消此設備的異常通知。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '取消訂閱失敗。');
    } finally { if (actionLock.current.release(lease)) setBusy(false); }
  };

  return <section className="profile-section profile-section-line" aria-labelledby={`equipment-line-title-${index}`}>
    <div className="profile-section-title"><span>{index}</span><div>
      <b id={`equipment-line-title-${index}`}>LINE 設備查詢</b>
      <small>綁定本人 LINE 後，可私訊「設備 設備編號」查詢有權限的設備資料</small>
    </div></div>
    <div className={`google-connection-card${status?.linked ? ' is-connected' : ''}`}>
      <div className="line-link-mark" aria-hidden="true">LINE</div>
      <div><b>{status?.linked ? '已綁定' : status ? '尚未綁定' : '讀取中'}</b>
        <span>{status?.linked ? '可在 LINE 私訊「設備 設備編號」；查詢時仍會檢查目前權限。'
          : '只綁定目前登入的系統帳號；可隨時解除。'}</span></div>
      {status?.linked && !confirmUnlink && <button type="button" className="is-connected"
        onClick={() => setConfirmUnlink(true)} disabled={busy}>解除綁定</button>}
      {!status?.linked && <button type="button" onClick={() => void refresh()} disabled={busy}>確認綁定結果</button>}
    </div>
    {status?.linked && confirmUnlink && <div className="line-link-confirm">
      <span>確定要解除本人 LINE 與中央巡檢系統的設備查詢綁定嗎？</span>
      <div className="profile-actions">
        <button type="button" className="secondary-btn compact" onClick={() => setConfirmUnlink(false)} disabled={busy}>取消</button>
        <button type="button" className="danger-btn compact" onClick={() => void unlink()} disabled={busy}>確定解除</button>
      </div>
    </div>}
    {status?.linked && <div className="line-link-start">
      <strong>訂閱設備異常通知</strong>
      <p>只推播您自行訂閱的設備；每次送出前仍檢查帳號與監控權限。可隨時取消。</p>
      {assetsAllowed && monitoringAllowed ? <div className="profile-actions">
        <input aria-label="要訂閱的設備編號" value={subscriptionCode} maxLength={80}
          onChange={event => setSubscriptionCode(event.target.value)} placeholder="設備編號或 QR 編碼" />
        <button type="button" className="primary-btn compact" onClick={() => void subscribe()}
          disabled={busy || !subscriptionCode.trim()}>訂閱設備</button>
      </div> : <p>目前沒有設備主檔與監控查閱權限，無法新增訂閱；仍可取消既有訂閱。</p>}
      {subscriptions.length > 0 && <ul className="line-link-steps">
        {subscriptions.map(item => <li key={item.equipment_id}>
          {item.asset_code || item.qr_code || item.equipment_id}　{item.name}
          <button type="button" className="secondary-btn compact" disabled={busy}
            onClick={() => void unsubscribe(item.equipment_id)}>取消訂閱</button>
        </li>)}
      </ul>}
    </div>}
    {!status?.linked && assetsAllowed && <>
      <ol className="line-link-steps">
        <li>在 LINE 將「@ltb9602a」臺北農產巡檢通知加為好友。</li>
        <li>勾選同意後產生代碼，於一對一聊天室傳送代碼。</li>
        <li>開啟機器人回覆的 LINE 帳號綁定連結，再回本頁確認結果。</li>
      </ol>
      {code && <div className="line-link-code-box"><div className="line-link-code"><code>{code}</code>
        <button type="button" className="secondary-btn compact" onClick={async () => {
          try { await navigator.clipboard.writeText(code); setMessage('代碼已複製。'); }
          catch { setMessage('無法自動複製，請手動選取代碼。'); }
        }}>複製代碼</button>
      </div><small>代碼一次性且 10 分鐘後失效，請勿轉傳。</small></div>}
      <label className="line-link-consent"><input type="checkbox" checked={consent} disabled={busy}
        onChange={event => setConsent(event.target.checked)} />
        <span>我同意將本人 LINE 與中央巡檢系統帳號綁定，用於設備查詢；可隨時在此解除。</span>
      </label>
      <div className="profile-actions"><button type="button" className="primary-btn compact"
        onClick={() => void start()} disabled={!consent || busy}>{busy ? '處理中…' : '產生綁定代碼'}</button></div>
    </>}
    {message && <p className="profile-message" role="status">{message}</p>}
  </section>;
}
