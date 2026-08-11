'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export default function LoginPage() {
  const [captcha, setCaptcha] = useState<{ id: string; image: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  function nextPath() {
    const requested = new URLSearchParams(window.location.search).get('next');
    return requested && requested.startsWith('/word-cloud/v2/') && !requested.startsWith('/word-cloud/v2/login')
      ? requested : '/word-cloud/v2/handover-pilot/';
  }
  async function loadCaptcha() {
    setCaptcha(null);
    const { data, error } = await getSupabase().functions.invoke('username-login', { body: { action: 'captcha' } });
    if (error || !data?.challenge_id) return setMessage('驗證碼載入失敗，請重新整理');
    setCaptcha({ id: data.challenge_id, image: data.image });
  }
  useEffect(() => { getSupabase().auth.getSession().then(({data}) => { if(data.session) location.replace(nextPath()); else loadCaptcha(); }); }, []);
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
    location.replace(nextPath());
  }
  return <main className="v1-login-page"><form className="login-card v1-login-card" onSubmit={submit}><img className="v1-login-logo" src="/word-cloud/system/assets/logo-title.png" alt="臺北農產第一果菜市場"/><h1>臺北農產公司</h1><p className="v1-login-sub">第一果菜市場 設備巡檢維修系統</p><p className="v1-login-hint">請使用帳號登入</p><label>帳號（英數字）<input name="identifier" required autoComplete="username" placeholder="請輸入帳號" /></label><label>密碼<input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" /></label><label>安全驗證碼（六位數字）<div className="captcha-row"><input name="captcha" inputMode="numeric" pattern="[0-9]*" maxLength={6} required placeholder="輸入圖中六位數字"/>{captcha ? <img src={captcha.image} alt="六位數驗證碼" onClick={loadCaptcha}/> : <button type="button" onClick={loadCaptcha}>重新載入</button>}</div></label>{message && <p className="form-error">{message}</p>}<button className="primary-btn" disabled={busy}>{busy ? '登入中…' : '登入'}</button></form><footer>臺北農產運銷股份有限公司 第一果菜市場 ｜ 整合管理系統 ｜ 第二版</footer></main>;
}
