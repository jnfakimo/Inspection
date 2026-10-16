'use client';

import { useCallback, useEffect, useState } from 'react';
import { invokeAppApi } from '@/lib/supabase';
import { vehicleLineLinkView, type VehicleLineLinkStatus } from '@/lib/vehicle-line-link';

// 個人設定視窗中的「LINE 派車通知」綁定區塊：只綁定登入者本人的 LINE，
// 代碼由伺服器產生且只顯示一次；LINE 使用者 ID 不會回到瀏覽器。
export default function VehicleLineLinkSection({ index }: { index: string }) {
  const [status, setStatus] = useState<VehicleLineLinkStatus | null>(null);
  const [code, setCode] = useState<{ value: string; expiresAt: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await invokeAppApi<VehicleLineLinkStatus>('vehicle_line_link_status');
      setStatus(next);
      if (next.linked) setCode(null);
      return next;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'LINE 綁定狀態讀取失敗');
      return null;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [code]);

  const view = vehicleLineLinkView(status, code, now);

  const start = async () => {
    if (!consent) { setMessage('請先勾選同意綁定說明。'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await invokeAppApi<{ code: string; expires_at: string }>('vehicle_line_link_start', { consent: true });
      setCode({ value: result.code, expiresAt: result.expires_at });
      setConsent(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'LINE 綁定代碼產生失敗');
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true); setMessage('');
    const next = await refresh();
    if (next && !next.linked) setMessage('尚未收到 LINE 的綁定完成通知；請確認已點選機器人回覆的綁定連結。');
    setBusy(false);
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
    setBusy(true); setMessage('');
    try {
      await invokeAppApi<{ unlinked: boolean }>('vehicle_line_unlink');
      setConfirmUnlink(false);
      await refresh();
      setMessage('已解除 LINE 綁定，之後不會再收到個人派車通知。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '解除綁定失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profile-section profile-section-line" aria-labelledby="vehicle-line-title">
      <div className="profile-section-title"><span>{index}</span><div><b id="vehicle-line-title">LINE 派車通知</b><small>綁定本人 LINE，被指派或取消指派公務車時收到個人通知</small></div></div>
      <div className={`google-connection-card${view.state === 'linked' ? ' is-connected' : ''}`}>
        <div className="line-link-mark" aria-hidden="true">LINE</div>
        <div><b>{view.title}</b><span>{view.detail}</span></div>
        {view.state === 'linked' && !confirmUnlink && <button type="button" className="is-connected" onClick={() => setConfirmUnlink(true)} disabled={busy}>解除綁定</button>}
        {view.state === 'pending' && <button type="button" onClick={() => void check()} disabled={busy}>{busy ? '確認中…' : '確認綁定結果'}</button>}
      </div>

      {view.state === 'linked' && confirmUnlink && <div className="line-link-confirm">
        <span>解除後將不再收到個人派車通知，需要時可重新綁定。確定要解除嗎？</span>
        <div className="profile-actions"><button type="button" className="secondary-btn compact" onClick={() => setConfirmUnlink(false)} disabled={busy}>取消</button><button type="button" className="danger-btn compact" onClick={() => void unlink()} disabled={busy}>{busy ? '處理中…' : '確定解除'}</button></div>
      </div>}

      {view.state === 'pending' && code && <div className="line-link-code-box">
        <ol className="line-link-steps">
          <li>在派車 LINE 群組點選系統通知機器人，將它加為好友。</li>
          <li>在與機器人的聊天室傳送下方代碼。</li>
          <li>點選機器人回覆的「綁定帳號」連結，完成後回到這裡按「確認綁定結果」。</li>
        </ol>
        <div className="line-link-code"><code>{code.value}</code><button type="button" className="secondary-btn compact" onClick={() => void copy()}>複製代碼</button></div>
        <small>代碼僅供本次使用，{view.remaining} 後失效；請勿轉傳給他人。</small>
      </div>}

      {(view.state === 'unlinked' || view.state === 'expired') && <div className="line-link-start">
        <label className="line-link-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>我同意將本人 LINE 帳號與系統帳號綁定，用於接收公務車派車個人通知；可隨時在此解除。</span></label>
        <div className="profile-actions"><button type="button" className="primary-btn compact" onClick={() => void start()} disabled={busy || !consent}>{busy ? '產生中…' : view.state === 'expired' ? '重新產生綁定代碼' : '產生綁定代碼'}</button></div>
      </div>}

      {message && <p className="profile-message" role="status">{message}</p>}
    </section>
  );
}
