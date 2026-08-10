'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { invokeAppApi } from '@/lib/supabase';
import type { InspectionRow, Profile } from '@/types/app';

type InspectionData = { rows: InspectionRow[]; equipment: Array<{ equipment_id: string; name: string; asset_code?: string; floor?: string }> };

function InspectionPage({ profile }: { profile: Profile }) {
  const [data, setData] = useState<InspectionData>({ rows: [], equipment: [] });
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const load = () => invokeAppApi<InspectionData>('inspections').then(setData).catch(e => setMessage(e.message));
  useEffect(() => { void load(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('儲存中…');
    const form = new FormData(event.currentTarget);
    try {
      await invokeAppApi('create_inspection', {
        equipment_id: form.get('equipment_id'), run_status: form.get('run_status'),
        location_point: form.get('location_point'), abnormal_note: form.get('abnormal_note'),
      });
      setMessage('巡檢紀錄已儲存'); setShowForm(false); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '儲存失敗'); }
  }
  return <AppShell profile={profile} title="巡檢作業">
    <div className="page-actions"><div><p>以 API 與 RLS 雙層驗證建立巡檢紀錄，異常結果會進入後續維修流程。</p>{message && <span className="inline-message">{message}</span>}</div><button className="primary-btn compact" onClick={() => setShowForm(v => !v)}>＋ 新增巡檢</button></div>
    {showForm && <form className="panel inspection-form" onSubmit={submit}><label>設備<select name="equipment_id" required><option value="">請選擇設備</option>{data.equipment.map(e => <option key={e.equipment_id} value={e.equipment_id}>{e.asset_code || '未編碼'}｜{e.name}｜{e.floor || '未設定樓層'}</option>)}</select></label><label>運轉狀態<select name="run_status"><option value="normal">正常</option><option value="abnormal">異常</option></select></label><label>巡檢位置<input name="location_point" placeholder="例如：B1F 冷凍機房" /></label><label className="wide">異常說明<textarea name="abnormal_note" rows={3} placeholder="異常時請描述現象；正常可留白" /></label><div className="wide form-actions"><button type="button" onClick={() => setShowForm(false)}>取消</button><button className="primary-btn compact">儲存巡檢</button></div></form>}
    <section className="panel table-panel"><div className="panel-head"><h2>近期巡檢紀錄</h2><span>{data.rows.length} 筆</span></div><div className="responsive-table"><table><thead><tr><th>時間</th><th>設備</th><th>樓層／位置</th><th>巡檢人員</th><th>結果</th><th>異常說明</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.record_id}><td>{new Date(row.inspect_time).toLocaleString('zh-TW',{hour12:false})}</td><td><strong>{row.equipment?.name || '未綁定設備'}</strong><small>{row.equipment?.asset_code}</small></td><td>{row.equipment?.floor || '—'}／{row.location_point || '—'}</td><td>{row.users?.name || '—'}</td><td><span className={`status ${row.run_status}`}>{row.run_status === 'normal' ? '正常' : '異常'}</span></td><td>{row.abnormal_note || '—'}</td></tr>)}</tbody></table></div></section>
  </AppShell>;
}
export default function Page() { return <AuthGate>{profile => <InspectionPage profile={profile} />}</AuthGate>; }
