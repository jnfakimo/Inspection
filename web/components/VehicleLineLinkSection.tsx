'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeAppApi } from '@/lib/supabase';
import { createRequestSequence } from '@/lib/request-sequence';
import {
  createVehicleLineActionLock,
  readVehicleLineBinding,
  startVehicleLineLink,
  unlinkVehicleLine,
  vehicleLineUnavailableKind,
} from '@/lib/vehicle-line-binding';
import { vehicleLineLinkView, type VehicleLineLinkStatus } from '@/lib/vehicle-line-link';

type Unavailable = 'schema' | 'driver' | 'generic' | null;

const api = (action: string, payload?: Record<string, unknown>) => invokeAppApi<unknown>(action, payload);

function unavailableText(kind: Exclude<Unavailable, null>) {
  if (kind === 'schema') return 'LINE 綁定服務尚未就緒，請稍後再試。';
  if (kind === 'driver') return '僅列入有效駕駛名冊的人員可以綁定；如有疑問請洽派車管理員。';
  return '目前無法確認 LINE 綁定狀態，請稍後再試。';
}

// 「LINE 派車通知」綁定區塊：個人資料設定與派車申請頁共用。只綁定登入者本人的 LINE，
// 代碼由伺服器產生且只顯示一次；LINE 使用者 ID 不會回到瀏覽器。
export default function VehicleLineLinkSection({ index }: { index: string }) {
  const [status, setStatus] = useState<VehicleLineLinkStatus | null>(null);
  const [unavailable, setUnavailable] = useState<Unavailable>(null);
  const [code, setCode] = useState<{ value: string; expiresAt: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // 狀態查詢以序號丟棄過期回應；產生代碼與解除綁定以動作鎖防止連點重送。
  const statusRequests = useRef(createRequestSequence());
  const actionLock = useRef(createVehicleLineActionLock());

  const refresh = useCallback(async () => {
    const request = statusRequests.current.begin();
    try {
      const next = await readVehicleLineBinding(api);
      if (!statusRequests.current.isCurrent(request)) return null;
      setStatus(next);
      setUnavailable(null);
      if (next.linked) setCode(null);
      return next;
    } catch (error) {
      if (!statusRequests.current.isCurrent(request)) return null;
      const kind = vehicleLineUnavailableKind(error);
      setUnavailable(kind === 'linked' ? 'generic' : kind);
      return null;
    }
  }, []);

  useEffect(() => {
    const requests = statusRequests.current;
    void refresh();
    return () => requests.invalidate();
  }, [refresh]);

  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [code]);

  const view = vehicleLineLinkView(status, code, now);

  const start = async () => {
    if (!consent) { setMessage('請先勾選同意綁定說明。'); return; }
    const lease = actionLock.current.acquire();
    if (!lease) return;
    setBusy(true); setMessage('');
    try {
      const intent = await startVehicleLineLink(api, consent);
      setCode({ value: intent.code, expiresAt: intent.expires_at });
      setConsent(false);
    } catch (error) {
      const kind = vehicleLineUnavailableKind(error);
      if (kind === 'linked') {
        await refresh();
        setMessage('此帳號已綁定 LINE。');
      } else if (kind === 'schema' || kind === 'driver') {
        setUnavailable(kind);
      } else {
        setMessage(error instanceof Error && error.message !== 'line-link-intent-invalid' ? error.message : 'LINE 綁定代碼產生失敗，請稍後再試。');
      }
    } finally {
      if (actionLock.current.release(lease)) setBusy(false);
    }
  };

  const check = async () => {
    const lease = actionLock.current.acquire();
    if (!lease) return;
    setBusy(true); setMessage('');
    try {
      const next = await refresh();
      if (next && !next.linked) setMessage('尚未收到 LINE 的綁定完成通知；請確認已點選機器人回覆的綁定連結。');
    } finally {
      if (actionLock.current.release(lease)) setBusy(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.value);
      setMessage('代碼已複製，請貼到 LINE 聊天室送出。');
    } catch {
      setMessage('無法自動複製，請手動選取代碼。');
    }
  };

  const unlink = async () => {
    const lease = actionLock.current.acquire();
    if (!lease) return;
    setBusy(true); setMessage('');
    try {
      const changed = await unlinkVehicleLine(api);
      setConfirmUnlink(false);
      await refresh();
      setMessage(changed ? '已解除 LINE 綁定，之後不會再收到個人派車通知。' : '此帳號目前沒有 LINE 綁定。');
    } catch (error) {
      const kind = vehicleLineUnavailableKind(error);
      if (kind === 'schema') setUnavailable(kind);
      else setMessage(error instanceof Error && !error.message.startsWith('line-') ? error.message : '解除綁定失敗，請稍後再試。');
    } finally {
      if (actionLock.current.release(lease)) setBusy(false);
    }
  };

  const cardTitle = unavailable ? '無法綁定' : view.title;
  const cardDetail = unavailable ? unavailableText(unavailable) : view.detail;

  return (
    <section className="profile-section profile-section-line" aria-labelledby={`vehicle-line-title-${index}`}>
      <div className="profile-section-title"><span>{index}</span><div><b id={`vehicle-line-title-${index}`}>LINE 派車通知</b><small>綁定本人 LINE，被指派或取消指派公務車時收到個人通知</small></div></div>
      <div className={`google-connection-card${!unavailable && view.state === 'linked' ? ' is-connected' : ''}`}>
        <div className="line-link-mark" aria-hidden="true">LINE</div>
        <div><b>{cardTitle}</b><span>{cardDetail}</span></div>
        {!unavailable && view.state === 'linked' && !confirmUnlink && <button type="button" className="is-connected" onClick={() => setConfirmUnlink(true)} disabled={busy}>解除綁定</button>}
        {!unavailable && view.state === 'pending' && <button type="button" onClick={() => void check()} disabled={busy}>{busy ? '確認中…' : '確認綁定結果'}</button>}
        {unavailable && unavailable !== 'driver' && <button type="button" onClick={() => void check()} disabled={busy}>重新讀取</button>}
      </div>

      {!unavailable && view.state === 'linked' && confirmUnlink && <div className="line-link-confirm">
        <span>解除後將不再收到個人派車通知，需要時可重新綁定。確定要解除嗎？</span>
        <div className="profile-actions"><button type="button" className="secondary-btn compact" onClick={() => setConfirmUnlink(false)} disabled={busy}>取消</button><button type="button" className="danger-btn compact" onClick={() => void unlink()} disabled={busy}>{busy ? '處理中…' : '確定解除'}</button></div>
      </div>}

      {!unavailable && view.state === 'pending' && code && <div className="line-link-code-box">
        <ol className="line-link-steps">
          <li>在 LINE 搜尋 ID「@ltb9602a」（臺北農產巡檢通知），將它加為好友。</li>
          <li>在與它的一對一聊天室傳送下方代碼。</li>
          <li>點選機器人回覆的「綁定帳號」連結，完成後回到這裡按「確認綁定結果」。</li>
        </ol>
        <div className="line-link-code"><code>{code.value}</code><button type="button" className="secondary-btn compact" onClick={() => void copy()}>複製代碼</button></div>
        <small>代碼僅供本次使用，{view.remaining} 後失效；請勿轉傳給他人。</small>
      </div>}

      {!unavailable && (view.state === 'unlinked' || view.state === 'expired') && <div className="line-link-start">
        <label className="line-link-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>我同意將本人 LINE 帳號與系統帳號綁定，用於接收公務車派車個人通知；可隨時在此解除。</span></label>
        <div className="profile-actions"><button type="button" className="primary-btn compact" onClick={() => void start()} disabled={busy || !consent}>{busy ? '產生中…' : view.state === 'expired' ? '重新產生綁定代碼' : '產生綁定代碼'}</button></div>
      </div>}

      {message && <p className="profile-message" role="status">{message}</p>}
    </section>
  );
}
