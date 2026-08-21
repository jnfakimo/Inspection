'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { invokeAdminApi } from '@/lib/admin-api';
import { AdminHeader, AdminModal, type AdminProps, errorMessage, PAGE_SIZE, Pager, type Row, StatusPill } from './shared';

export function LocationsAdmin({ profile, module }: AdminProps) {
  const [locations, setLocations] = useState<Row[]>([]), [departments, setDepartments] = useState<Row[]>([]), [markets, setMarkets] = useState<Row[]>([]);
  const [tab, setTab] = useState<'locations' | 'departments'>('locations'), [busy, setBusy] = useState(true), [note, setNote] = useState(''), [query, setQuery] = useState(''), [editor, setEditor] = useState<Row | null>(null), [locationPage, setLocationPage] = useState(1), [departmentPage, setDepartmentPage] = useState(1);
  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      const client = getSupabase();
      const [locationResult, departmentResult, marketResult] = await Promise.all([
        client.from('locations').select('location_id,market_id,floor,floor_order,area,area_order,detail,detail_order,status,created_at').order('floor_order').order('area_order').limit(2000),
        client.from('departments').select('dept_id,parent_id,name,code,level,sort_order,status,created_at').order('sort_order').limit(1000),
        client.from('markets').select('market_id,name,short_name,status').order('name'),
      ]);
      if (locationResult.error || departmentResult.error || marketResult.error) setNote(`失敗：${errorMessage(locationResult.error || departmentResult.error || marketResult.error, '場域位置載入失敗')}`);
      setLocations(locationResult.data || []); setDepartments(departmentResult.data || []); setMarkets(marketResult.data || []);
    } catch (error) { setNote(`失敗：${errorMessage(error, '場域位置載入失敗')}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const run = async (action: string, payload: Row, success: string) => {
    setBusy(true); setNote('');
    try { await invokeAdminApi(action, payload); setEditor(null); await load(); setNote(success); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const q = query.trim().toLowerCase();
  const locationRows = locations.filter(row => !q || [row.floor, row.area, row.detail, markets.find(market => market.market_id === row.market_id)?.name].some(value => String(value || '').toLowerCase().includes(q)));
  const departmentRows = departments.filter(row => !q || [row.name, row.code].some(value => String(value || '').toLowerCase().includes(q)));
  const pagedLocationRows = locationRows.slice((locationPage - 1) * PAGE_SIZE, locationPage * PAGE_SIZE);
  const pagedDepartmentRows = departmentRows.slice((departmentPage - 1) * PAGE_SIZE, departmentPage * PAGE_SIZE);
  useEffect(() => { setLocationPage(current => Math.min(current, Math.max(1, Math.ceil(locationRows.length / PAGE_SIZE)))); }, [locationRows.length]);
  useEffect(() => { setDepartmentPage(current => Math.min(current, Math.max(1, Math.ceil(departmentRows.length / PAGE_SIZE)))); }, [departmentRows.length]);
  const save = async () => {
    if (!editor) return;
    if (tab === 'locations') {
      if (!editor.market_id || !String(editor.floor || '').trim() || !String(editor.area || '').trim()) { setNote('失敗：請填寫市場、樓層與區域'); return; }
      await run('admin_save_location', { location_id: editor.location_id, market_id: editor.market_id, floor: String(editor.floor).trim(), floor_order: Number(editor.floor_order || 0), area: String(editor.area).trim(), area_order: Number(editor.area_order || 0), detail: String(editor.detail || '').trim(), detail_order: Number(editor.detail_order || 0), status: editor.status || 'active' }, editor.location_id ? '位置已更新' : '位置已新增');
    } else {
      if (!String(editor.name || '').trim()) { setNote('失敗：請填寫部門名稱'); return; }
      await run('admin_save_department', { dept_id: editor.dept_id, parent_id: editor.parent_id || null, name: String(editor.name).trim(), code: String(editor.code || '').trim(), sort_order: Number(editor.sort_order || 0), status: editor.status || 'active' }, editor.dept_id ? '部門已更新' : '部門已新增');
    }
  };
  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} action={<button className="primary-btn compact" onClick={() => setEditor(tab === 'locations' ? { status: 'active', market_id: markets[0]?.market_id, floor_order: 0, area_order: 0, detail_order: 0 } : { status: 'active', sort_order: 0 })}>＋ 新增{tab === 'locations' ? '位置' : '部門'}</button>}/>
    <section className="panel admin-panel"><div className="admin-tabs"><button className={tab === 'locations' ? 'active' : ''} onClick={() => { setTab('locations'); setLocationPage(1); setEditor(null); }}>場域位置</button><button className={tab === 'departments' ? 'active' : ''} onClick={() => { setTab('departments'); setDepartmentPage(1); setEditor(null); }}>組織部門</button></div><div className="admin-toolbar"><input value={query} onChange={event => { setQuery(event.target.value); setLocationPage(1); setDepartmentPage(1); }} placeholder={`搜尋${tab === 'locations' ? '市場、樓層、區域或細部位置' : '部門名稱或代碼'}`}/><span>共 {tab === 'locations' ? locationRows.length : departmentRows.length} 筆</span></div>
      {tab === 'locations' ? <><div className="responsive-table"><table><thead><tr><th>市場</th><th>樓層</th><th>區域</th><th>細部位置</th><th>狀態</th><th>操作</th></tr></thead><tbody>{pagedLocationRows.map(row => <tr key={row.location_id}><td>{markets.find(market => market.market_id === row.market_id)?.name || '—'}</td><td>{row.floor}</td><td>{row.area}</td><td>{row.detail || '—'}</td><td><StatusPill value={row.status}/></td><td><div className="admin-row-actions"><button onClick={() => setEditor({ ...row })}>編輯</button><button className={row.status === 'active' ? 'warn' : ''} onClick={() => window.confirm(`確定${row.status === 'active' ? '停用' : '啟用'}此位置？`) && void run('admin_toggle_location', { location_id: row.location_id, status: row.status === 'active' ? 'inactive' : 'active' }, row.status === 'active' ? '位置已停用' : '位置已啟用')}>{row.status === 'active' ? '停用' : '啟用'}</button></div></td></tr>)}</tbody></table></div><Pager page={locationPage} total={locationRows.length} onPage={setLocationPage}/></> : <><div className="responsive-table"><table><thead><tr><th>部門名稱</th><th>代碼</th><th>上層部門</th><th>層級</th><th>狀態</th><th>操作</th></tr></thead><tbody>{pagedDepartmentRows.map(row => <tr key={row.dept_id}><td><strong>{row.name}</strong></td><td>{row.code || '—'}</td><td>{departments.find(dept => dept.dept_id === row.parent_id)?.name || '—'}</td><td>{row.level || 1}</td><td><StatusPill value={row.status}/></td><td><div className="admin-row-actions"><button onClick={() => setEditor({ ...row })}>編輯</button><button className={row.status === 'active' ? 'warn' : ''} onClick={() => window.confirm(`確定${row.status === 'active' ? '停用' : '啟用'}「${row.name}」？`) && void run('admin_toggle_department', { dept_id: row.dept_id, status: row.status === 'active' ? 'inactive' : 'active' }, row.status === 'active' ? '部門已停用' : '部門已啟用')}>{row.status === 'active' ? '停用' : '啟用'}</button></div></td></tr>)}</tbody></table></div><Pager page={departmentPage} total={departmentRows.length} onPage={setDepartmentPage}/></>}
    </section>
    {editor && <AdminModal title={`${editor.location_id || editor.dept_id ? '編輯' : '新增'}${tab === 'locations' ? '場域位置' : '組織部門'}`} onClose={() => setEditor(null)}><div className="admin-form-grid">{tab === 'locations' ? <><label>市場<select value={editor.market_id || ''} onChange={event => setEditor({ ...editor, market_id: event.target.value })}>{markets.filter(market => market.status === 'active').map(market => <option key={market.market_id} value={market.market_id}>{market.name}</option>)}</select></label><label>樓層<input value={editor.floor || ''} onChange={event => setEditor({ ...editor, floor: event.target.value })}/></label><label>區域<input value={editor.area || ''} onChange={event => setEditor({ ...editor, area: event.target.value })}/></label><label>細部位置<input value={editor.detail || ''} onChange={event => setEditor({ ...editor, detail: event.target.value })}/></label><label>樓層排序<input type="number" value={editor.floor_order ?? 0} onChange={event => setEditor({ ...editor, floor_order: event.target.value })}/></label><label>區域排序<input type="number" value={editor.area_order ?? 0} onChange={event => setEditor({ ...editor, area_order: event.target.value })}/></label></> : <><label>部門名稱<input value={editor.name || ''} onChange={event => setEditor({ ...editor, name: event.target.value })}/></label><label>部門代碼<input value={editor.code || ''} onChange={event => setEditor({ ...editor, code: event.target.value })}/></label><label>上層部門<select value={editor.parent_id || ''} onChange={event => setEditor({ ...editor, parent_id: event.target.value || null })}><option value="">-- 無上層部門 --</option>{departments.filter(dept => dept.dept_id !== editor.dept_id && dept.status === 'active').map(dept => <option key={dept.dept_id} value={dept.dept_id}>{dept.name}</option>)}</select></label><label>排序<input type="number" value={editor.sort_order ?? 0} onChange={event => setEditor({ ...editor, sort_order: event.target.value })}/></label></>}<label>狀態<select value={editor.status || 'active'} onChange={event => setEditor({ ...editor, status: event.target.value })}><option value="active">啟用</option><option value="inactive">停用</option></select></label></div><footer><button className="secondary-btn" onClick={() => setEditor(null)}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存'}</button></footer></AdminModal>}
  </AppShell>;
}
