'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { LEGACY_BASE } from '@/lib/config';
import { AdminHeader, type AdminProps, errorMessage, fmtTime, type Row, StatusPill } from './shared';

export function LayoutsAdmin({ profile, module }: AdminProps) {
  const [layout, setLayout] = useState<Row | null>(null), [versions, setVersions] = useState<Row[]>([]), [itemsByVersion, setItemsByVersion] = useState<Record<string, Row[]>>({});
  const [selected, setSelected] = useState(''), [items, setItems] = useState<Row[]>([]), [noteText, setNoteText] = useState(''), [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setNote(''); const client = getSupabase();
    const layoutResult = await client.from('dashboard_layouts').select('*').eq('layout_code', 'operations_main').maybeSingle();
    if (layoutResult.error || !layoutResult.data) { setNote(`失敗：${errorMessage(layoutResult.error, '戰情版面主檔載入失敗')}`); setBusy(false); return; }
    const [versionResult, itemResult] = await Promise.all([
      client.from('dashboard_layout_versions').select('*').eq('layout_id', layoutResult.data.layout_id).order('version_no', { ascending: false }).limit(200),
      client.from('dashboard_layout_items').select('*').order('sort_order').limit(5000),
    ]);
    if (versionResult.error || itemResult.error) setNote(`失敗：${errorMessage(versionResult.error || itemResult.error, '戰情版面版本載入失敗')}`);
    const versionRows = versionResult.data || []; const versionIds = new Set(versionRows.map(row => row.version_id)); const grouped: Record<string, Row[]> = {};
    (itemResult.data || []).filter(row => versionIds.has(row.version_id)).forEach(row => { (grouped[row.version_id] ||= []).push(row); });
    setLayout(layoutResult.data); setVersions(versionRows); setItemsByVersion(grouped);
    const preferred = selected && versionIds.has(selected) ? selected : layoutResult.data.published_version_id || versionRows[0]?.version_id || '';
    setSelected(preferred); setItems((grouped[preferred] || []).map(row => ({ ...row }))); setBusy(false);
  }, [selected]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedVersion = versions.find(row => row.version_id === selected);
  const published = versions.find(row => row.version_id === layout?.published_version_id);
  const choose = (versionId: string) => { setSelected(versionId); setItems((itemsByVersion[versionId] || []).map(row => ({ ...row }))); setNoteText(''); };
  const updateItem = (index: number, patch: Row) => setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const rpc = async (publish: boolean) => {
    if (!layout || items.length === 0) { setNote('失敗：版面至少需要一個圖塊'); return; }
    setBusy(true); setNote('');
    const payload = items.map((item, index) => ({ widget_key: item.widget_key, title: item.title, x: Number(item.x || 0), y: Number(item.y || 0), width: Number(item.width || 3), height: Number(item.height || 2), min_width: Number(item.min_width || 1), min_height: Number(item.min_height || 1), visible: Boolean(item.visible), refresh_seconds: Number(item.refresh_seconds || 0), config: item.config || {}, sort_order: index * 10 + 10 }));
    const { error } = await getSupabase().rpc('save_dashboard_layout_version', { p_layout_id: layout.layout_id, p_items: payload, p_note: noteText.trim() || (publish ? 'V2 後台發布' : 'V2 後台草稿'), p_publish: publish });
    if (error) { setNote(`失敗：${errorMessage(error, '版面版本儲存失敗')}`); setBusy(false); return; }
    setNote(publish ? '新版面已發布' : '草稿版本已儲存'); setNoteText(''); await load();
  };
  const restore = async (version: Row) => {
    if (!window.confirm(`確定將第 ${version.version_no} 版還原為目前發布版？`)) return;
    setBusy(true); setNote(''); const { error } = await getSupabase().rpc('publish_dashboard_layout_version', { p_version_id: version.version_id });
    if (error) { setNote(`失敗：${errorMessage(error, '版本復原失敗')}`); setBusy(false); return; }
    setNote(`第 ${version.version_no} 版已還原並發布`); await load();
  };
  const sortedItems = useMemo(() => items.map((item, index) => ({ item, index })).sort((a, b) => Number(a.item.sort_order || a.index) - Number(b.item.sort_order || b.index)), [items]);
  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} action={<a className="secondary-btn" href={`${LEGACY_BASE}/admin.html#settings`}>V1 版面預覽</a>}/>
    <section className="panel admin-panel"><div className="layout-summary"><div><span>目前發布</span><strong>{published ? `第 ${published.version_no} 版` : '尚未發布'}</strong><small>{published?.version_note || '—'}・{fmtTime(published?.published_at)}</small></div><label>編輯版本<select value={selected} onChange={event => choose(event.target.value)}>{versions.map(version => <option key={version.version_id} value={version.version_id}>第 {version.version_no} 版｜{version.state === 'published' ? '已發布' : version.state === 'draft' ? '草稿' : '歷史'}｜{version.version_note || '無備註'}</option>)}</select></label><div><StatusPill value={selectedVersion?.state}/><small>建立：{fmtTime(selectedVersion?.created_at)}</small></div></div>
      <div className="responsive-table layout-editor"><table><thead><tr><th>順序</th><th>圖塊代碼</th><th>顯示標題</th><th>顯示</th><th>寬</th><th>高</th><th>更新秒數</th></tr></thead><tbody>{sortedItems.map(({ item, index }, displayIndex) => <tr key={item.widget_key}><td>{displayIndex + 1}</td><td><code>{item.widget_key}</code></td><td><input value={item.title || ''} onChange={event => updateItem(index, { title: event.target.value })}/></td><td><input type="checkbox" checked={Boolean(item.visible)} onChange={event => updateItem(index, { visible: event.target.checked })}/></td><td><input type="number" min="1" max="12" value={item.width || 3} onChange={event => updateItem(index, { width: Number(event.target.value) })}/></td><td><input type="number" min="1" max="20" value={item.height || 2} onChange={event => updateItem(index, { height: Number(event.target.value) })}/></td><td><input type="number" min="0" max="86400" value={item.refresh_seconds ?? 60} onChange={event => updateItem(index, { refresh_seconds: Number(event.target.value) })}/></td></tr>)}</tbody></table></div>
      <div className="admin-layout-actions"><label>版本備註<input value={noteText} onChange={event => setNoteText(event.target.value)} placeholder="例如：調整巡檢圖塊高度"/></label><div><button className="secondary-btn" disabled={busy} onClick={() => void rpc(false)}>儲存草稿</button><button className="primary-btn compact" disabled={busy} onClick={() => window.confirm('確定建立新版本並立即發布？') && void rpc(true)}>發布新版本</button>{selectedVersion && selectedVersion.version_id !== layout?.published_version_id && <button className="secondary-btn" disabled={busy} onClick={() => void restore(selectedVersion)}>還原並發布此版本</button>}</div></div>
    </section>
  </AppShell>;
}
