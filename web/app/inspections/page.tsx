'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { invokeAppApi } from '@/lib/supabase';
import type { InspectionRow, Profile } from '@/types/app';
import { PAGE_SIZE, Pager } from '@/components/admin/shared';
import { ComboboxSelect } from '@/components/ComboboxSelect';
import { locationOptions, type LocationLike } from '@/lib/locations';

type InspectionData = { rows: InspectionRow[]; equipment: Array<{ equipment_id: string; name: string; asset_code?: string; floor?: string }>; locations?: LocationLike[] };

function InspectionPage({ profile }: { profile: Profile }) {
  const [data, setData] = useState<InspectionData>({ rows: [], equipment: [], locations: [] });
  // 綁定場域位置後這筆紀錄才會進入位置分析的彙總，location_point 只是現場描述。
  const [locationId, setLocationId] = useState('');
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const load = () => invokeAppApi<InspectionData>('inspections').then(setData).catch(e => setMessage(`巡檢資料載入失敗：${e instanceof Error ? e.message : '請稍後重試'}`));
  useEffect(() => { void load(); }, []);
  useEffect(() => { setPage(current => Math.min(current, Math.max(1, Math.ceil(data.rows.length / PAGE_SIZE)))); }, [data.rows.length]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('儲存中…');
    const form = new FormData(event.currentTarget);
    try {
      await invokeAppApi('create_inspection', {
        equipment_id: form.get('equipment_id'), run_status: form.get('run_status'),
        location_point: form.get('location_point'), abnormal_note: form.get('abnormal_note'),
        location_id: locationId || null,
      });
      setMessage('巡檢紀錄已儲存'); setShowForm(false); setLocationId(''); setPage(1); await load();
    } catch (error) { setMessage(`巡檢儲存失敗：${error instanceof Error ? error.message : '請稍後重試'}`); }
  }
  return <AppShell profile={profile} title="巡檢作業">
    <div className="page-actions"><div><p>以系統服務與資料列權限雙層驗證建立巡檢紀錄，異常結果會進入後續維修流程。</p>{message && <span className="inline-message">{message}</span>}</div><button className="primary-btn compact" onClick={() => setShowForm(v => !v)}>＋ 新增巡檢</button></div>
    {showForm && <form className="panel inspection-form" onSubmit={submit}><label>設備<select name="equipment_id" required><option value="">請選擇設備</option>{data.equipment.map(e => <option key={e.equipment_id} value={e.equipment_id}>{e.asset_code || '未編碼'}｜{e.name}｜{e.floor || '未設定樓層'}</option>)}</select></label><label>運轉狀態<select name="run_status"><option value="normal">正常</option><option value="abnormal">異常</option></select></label><label>巡檢位置<input name="location_point" placeholder="例如：B1F 冷凍機房" /></label><label>場域位置（選填，供位置統計）<ComboboxSelect value={locationId} onChange={setLocationId} options={locationOptions(data.locations || [])} placeholder="輸入可篩選，留白代表不綁定" ariaLabel="場域位置" /></label><label className="wide">異常說明<textarea name="abnormal_note" rows={3} placeholder="異常時請描述現象；正常可留白" /></label><div className="wide form-actions"><button type="button" onClick={() => setShowForm(false)}>取消</button><button className="primary-btn compact">儲存巡檢</button></div></form>}
    <section className="panel table-panel"><div className="panel-head"><h2>近期巡檢紀錄</h2><span>{data.rows.length} 筆</span></div><div className="responsive-table"><table><thead><tr><th>時間</th><th>設備</th><th>樓層／位置</th><th>巡檢人員</th><th>結果</th><th>異常說明</th></tr></thead><tbody>{data.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(row => <tr key={row.record_id}><td>{new Date(row.inspect_time).toLocaleString('zh-TW',{hour12:false})}</td><td><strong>{row.equipment?.name || '未綁定設備'}</strong><small>{row.equipment?.asset_code}</small></td><td>{row.equipment?.floor || '—'}／{row.location_point || '—'}</td><td>{row.users?.name || '—'}</td><td><span className={`status ${row.run_status}`}>{row.run_status === 'normal' ? '正常' : '異常'}</span></td><td>{row.abnormal_note || '—'}</td></tr>)}</tbody></table></div><Pager page={page} total={data.rows.length} onPage={setPage}/></section>
  </AppShell>;
}
export default function Page() { return <AuthGate>{profile => <InspectionPage profile={profile} />}</AuthGate>; }
