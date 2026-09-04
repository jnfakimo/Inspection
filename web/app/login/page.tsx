'use client';

import { FormEvent, useEffect, useState } from 'react';
import { localAuth } from '@/lib/local-auth';
import { saveProfile } from '@/lib/profile-cache';
import type { Profile } from '@/types/app';

function nextPath() {
  const requested = new URLSearchParams(window.location.search).get('next');
  if (requested && requested.startsWith('/Inspection/v2/') && !requested.startsWith('/Inspection/v2/login')) return requested;
  return '/Inspection/v2/systems/';
}

export default function LoginPage() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    localAuth.me<Profile>().then(() => location.replace(nextPath())).catch(() => undefined);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      await localAuth.login(String(form.get('identifier') || '').trim(), String(form.get('password') || ''));
      const profile = await localAuth.me<Profile>();
      saveProfile(profile);
      location.replace(nextPath());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '帳號或密碼錯誤');
      setBusy(false);
    }
  }

  return <main className="v1-login-page">
    <form className="login-card v1-login-card" onSubmit={submit}>
      <img className="v1-login-logo" src="/Inspection/system/assets/logo-title.png" alt="臺北農產第一果菜市場" />
      <h1>臺北農產公司</h1>
      <p className="v1-login-sub">第一果菜市場 設備巡檢維修系統</p>
      <p className="v1-login-hint">請使用地端帳號登入</p>
      <label>帳號（英數字）<input name="identifier" required autoComplete="username" placeholder="請輸入帳號" /></label>
      <label>密碼<input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" /></label>
      {message && <p className="form-error">{message}</p>}
      <button className="primary-btn" disabled={busy}>{busy ? '登入中…' : '登入'}</button>
      <p className="v1-login-hint">完全地端模式｜帳號密碼由本機 SQL Server 驗證</p>
    </form>
    <footer>臺北農產運銷股份有限公司 第一果菜市場 ｜ 整合管理系統 ｜ 第二版</footer>
  </main>;
}
