'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export default function LoginPage() {
  const [captcha, setCaptcha] = useState<{ id: string; image: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function loadCaptcha() {
    setCaptcha(null);
    const { data, error } = await getSupabase().functions.invoke('username-login', { body: { action: 'captcha' } });
    if (error || !data?.challenge_id) return setMessage('驗證碼載入失敗，請重新整理');
    setCaptcha({ id: data.challenge_id, image: data.image });
  }
  useEffect(() => { getSupabase().auth.getSession().then(({data}) => { if(data.session) location.replace('/word-cloud/v2/'); else loadCaptcha(); }); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    const { data, error } = await getSupabase().functions.invoke('username-login', { body: {
      identifier: String(form.get('identifier') || '').trim(), password: String(form.get('password') || ''),
      captcha_id: captcha?.id, captcha_answer: String(form.get('captcha') || '').trim(),
    }});
    if (error || !data?.access_token) { setMessage(data?.message || '帳號、密碼或驗證碼錯誤'); setBusy(false); await loadCaptcha(); return; }
    const result = await getSupabase().auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    if (result.error) { setMessage('登入狀態建立失敗'); setBusy(false); return; }
    location.replace('/word-cloud/v2/');
  }
  return <main className="login-page"><section className="login-copy"><p className="eyebrow">TAPMC · FIRST FRUIT & VEGETABLE MARKET</p><h1>北農智慧<br/>巡檢平台</h1><p>設備、巡檢、維修、告警與分析整合於同一個營運工作臺。</p><div className="login-tags"><span>PostgreSQL</span><span>Realtime</span><span>FCM</span><span>RBAC</span></div></section><form className="login-card" onSubmit={submit}><div><small>SECURE ACCESS</small><h2>系統登入</h2></div><label>帳號或 Email<input name="identifier" required autoComplete="username" /></label><label>密碼<input name="password" type="password" required autoComplete="current-password" /></label><label>圖形驗證碼<div className="captcha-row"><input name="captcha" inputMode="numeric" maxLength={6} required />{captcha ? <img src={captcha.image} alt="六位數驗證碼" onClick={loadCaptcha}/> : <button type="button" onClick={loadCaptcha}>重新載入</button>}</div></label>{message && <p className="form-error">{message}</p>}<button className="primary-btn" disabled={busy}>{busy ? '登入中…' : '登入平台'}</button><a href="/word-cloud/system/login.html">返回既有登入頁</a></form></main>;
}
