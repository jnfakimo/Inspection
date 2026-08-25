'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

type Department = {
  dept_id: string;
  parent_id?: string | null;
  name: string;
  code?: string | null;
  level?: number | null;
};

function friendlyError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/rate limit|too many|頻繁/i.test(raw)) return '申請過於頻繁，請稍後再試';
  if (/failed to fetch|network|load failed/i.test(raw)) return '網路連線失敗，請確認連線後再試';
  return raw || '帳號申請服務暫時無法使用';
}

export default function AccountApplyPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [captcha, setCaptcha] = useState<{ id: string; image: string } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [done, setDone] = useState(false);

  async function loadCaptcha() {
    setCaptcha(null);
    try {
      const { data, error } = await getSupabase().functions.invoke('username-login', { body: { action: 'captcha' } });
      if (error || !data?.challenge_id) throw new Error(data?.message || '驗證碼載入失敗');
      setCaptcha({ id: data.challenge_id, image: data.image });
    } catch (error) { setMessage(friendlyError(error)); }
  }

  useEffect(() => {
    void Promise.all([
      getSupabase().functions.invoke('username-login', { body: { action: 'account_application_options' } })
        .then(({ data, error }) => {
          if (error || !data?.ok) throw new Error(data?.message || '單位資料載入失敗');
          setDepartments(data.departments || []);
        }),
      loadCaptcha(),
    ]).catch(error => setMessage(friendlyError(error)));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const { data, error } = await getSupabase().functions.invoke('username-login', { body: {
        action: 'account_application',
        name: String(form.get('name') || '').trim(),
        username: String(form.get('username') || '').trim(),
        email: String(form.get('email') || '').trim(),
        phone: String(form.get('phone') || '').trim(),
        dept_id: String(form.get('dept_id') || ''),
        reason: String(form.get('reason') || '').trim(),
        captcha_id: captcha?.id,
        captcha_answer: String(form.get('captcha') || '').trim(),
      }});
      if (error || !data?.ok) throw new Error(data?.message || '帳號申請送出失敗');
      setDone(true); setMessage(data.message || '帳號申請已送出，請等待系統管理員審核');
    } catch (error) {
      setMessage(friendlyError(error)); setBusy(false); await loadCaptcha();
    }
  }

  return <main className="v1-login-page account-apply-page">
    <form className="login-card v1-login-card account-apply-card" onSubmit={submit}>
      <img className="v1-login-logo" src="/Inspection/system/assets/logo-title.png" alt="臺北農產第一果菜市場" />
      <h1>申請系統帳號</h1>
      <p className="v1-login-hint">填寫人員資料後，由系統管理員核定系統角色與直屬課室主管。</p>
      {done ? <div className="account-apply-result">
        <strong>申請完成</strong>
        <p>{message}</p>
        <p>核准後，系統會寄送設定密碼連結到申請信箱。</p>
        <Link className="primary-btn" href="/login/">返回登入</Link>
      </div> : <>
        <div className="account-apply-grid">
          <label>姓名（必填）<input name="name" required maxLength={100} autoComplete="name" /></label>
          <label>登入帳號（必填）<input name="username" required minLength={3} maxLength={64} pattern="[A-Za-z0-9._-]+" autoComplete="username" placeholder="限英數字、句點、底線或連字號" /></label>
          <label>電子郵件（必填）<input name="email" type="email" required maxLength={200} autoComplete="email" /></label>
          <label>聯絡電話<input name="phone" maxLength={50} autoComplete="tel" /></label>
          <label className="wide">所屬單位（必填）<select name="dept_id" required defaultValue="">
            <option value="" disabled>-- 請選擇所屬課室 --</option>
            {departments.map(department => <option key={department.dept_id} value={department.dept_id}>{department.name}</option>)}
          </select></label>
          <label className="wide">申請說明<textarea name="reason" rows={3} maxLength={1000} placeholder="請簡述工作職掌或需要使用的系統" /></label>
          <label className="wide">安全驗證碼（六位數字）
            <div className="captcha-row">
              {captcha ? <img src={captcha.image} alt="六位數驗證碼" onClick={loadCaptcha} /> : <button type="button" onClick={loadCaptcha}>重新載入</button>}
              <button type="button" onClick={loadCaptcha} aria-label="重新產生驗證碼">↻ 重新產生</button>
            </div>
            <input name="captcha" inputMode="numeric" pattern="[0-9]*" maxLength={6} required placeholder="輸入圖中六位數字" />
          </label>
        </div>
        {message && <p className="form-error">{message}</p>}
        <button className="primary-btn" disabled={busy || !captcha || departments.length === 0}>{busy ? '送出中…' : '送出帳號申請'}</button>
        <Link className="forgot-link" href="/login/">返回登入</Link>
      </>}
    </form>
    <footer>臺北農產運銷股份有限公司 第一果菜市場 ｜ 整合管理系統 ｜ 第二版</footer>
  </main>;
}
