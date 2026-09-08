'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';
import { fmtTime } from '@/components/admin/shared';

type Observation = { device_label: string; address_text: string | null; source_time_text: string | null };
type Collector = { collector_id: string; name: string; active: boolean; paired_at: string | null;
  last_contact_at: string | null; last_read_at: string | null; last_received_at: string | null;
  last_status: string; latest_snapshot_id: string | null };
type Snapshot = { snapshot_id: string; captured_at: string; received_at: string; observations: Observation[] };
type Pairing = { collector_id: string; pairing_code: string; expires_at: string };

export function FindTagSyncPanel({ isAdmin }: { isAdmin: boolean }) {
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('FindTag 桌機');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [disabling, setDisabling] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const reading = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (reading.current || signal?.aborted) return;
    reading.current = true;
    const request = new AbortController();
    const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 15_000);
    try {
      const client = getSupabase();
      const result = await client.from('findtag_collectors')
        .select('collector_id,name,active,paired_at,last_contact_at,last_read_at,last_received_at,last_status,latest_snapshot_id')
        .order('created_at', { ascending: false }).limit(50).abortSignal(request.signal);
      if (result.error) throw result.error;
      const sources = (result.data || []) as Collector[];
      const ids = sources.flatMap(source => source.latest_snapshot_id ? [source.latest_snapshot_id] : []);
      const views = ids.length ? await client.from('findtag_visible_snapshots')
        .select('snapshot_id,captured_at,received_at,observations').in('snapshot_id', ids)
        .abortSignal(request.signal) : { data: [], error: null };
      if (views.error) throw views.error;
      if (signal?.aborted) return;
      setCollectors(sources); setSnapshots((views.data || []) as Snapshot[]); setNote('');
    } catch {
      if (!signal?.aborted) setNote('FindTag 同步資料目前無法讀取。保留上次畫面，請勿將它當作即時位置。');
    } finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort); reading.current = false;
      if (!signal?.aborted) { setLoading(false); setNow(Date.now()); }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (controller.signal.aborted) return;
      if (!document.hidden) await load(controller.signal);
      timer = setTimeout(tick, 30_000);
    };
    void tick();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load]);
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setPairing(null), Math.max(0, new Date(pairing.expires_at).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);
  const createPairing = async () => {
    setSaving(true); setNote('');
    try {
      const { data, error } = await getSupabase().rpc('findtag_create_pairing', { p_name: name });
      if (error) throw error;
      setPairing(data as Pairing); await load();
    } catch { setNote('桌機授權建立失敗，請確認管理員權限及啟用來源數量。'); }
    finally { setSaving(false); }
  };
  const download = () => {
    if (!pairing || new Date(pairing.expires_at).getTime() <= Date.now()) return;
    const content = JSON.stringify({ version: 1, backend: SUPABASE_URL, anon_key: SUPABASE_ANON_KEY, ...pairing });
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'FindTag-桌機配對.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const disable = async (id: string) => {
    setSaving(true);
    try {
      const { error } = await getSupabase().rpc('findtag_disable_collector', { p_collector_id: id });
      if (error) throw error;
      setDisabling(null); await load();
    } catch { setNote('停用桌機授權失敗，尚未變更。'); }
    finally { setSaving(false); }
  };
  return <section className="panel tracking-table-panel findtag-sync" aria-labelledby="findtag-sync-title">
    <div className="findtag-sync-heading">
      <div><h2 id="findtag-sync-title">FindTag 桌機自動同步</h2><p>每 30 秒更新畫面；桌機每 60 秒讀取一次目前可見清單。</p></div>
      <button type="button" className="secondary-btn compact" disabled={loading || saving} onClick={() => void load()}>更新同步狀態</button>
    </div>
    <p className="tracking-form-hint">目前可同步名稱、地址及來源時間文字，尚未取得經緯度與穩定設備識別碼。以下不是完整設備盤點，不會自動綁車、標示地圖座標或計算里程。FindTag 清單必須保持開啟；尚未支援無人值守切頁或讀取整段歷史軌跡。</p>
    {note && <p className="notice danger" role="alert">{note}</p>}
    {loading && <p role="status">正在讀取同步狀態…</p>}
    {!loading && !note && !collectors.length && <p className="empty">尚未授權桌機。完成配對後，這裡會自動顯示讀取結果。</p>}
    {collectors.map(source => {
      const view = snapshots.find(item => item.snapshot_id === source.latest_snapshot_id);
      const recent = source.last_contact_at && now - new Date(source.last_contact_at).getTime() < 180_000;
      const recentRead = source.last_read_at && now - new Date(source.last_read_at).getTime() < 180_000;
      const state = !source.active ? '已停用' : !source.paired_at ? '等待桌機配對' : !recent ? '桌機未聯絡／離線' : source.last_status === 'read_failed' ? '桌機在線，但 FindTag 清單不可讀' : !recentRead ? '桌機補傳中，尚無近期清單' : '桌機同步連線正常（不代表位置即時）';
      return <article className="findtag-source" key={source.collector_id}>
        <div className="findtag-sync-heading"><h3>{source.name}</h3><span>{state}</span></div>
        <p>最後聯絡：{source.last_contact_at ? fmtTime(source.last_contact_at) : '尚無'}　｜　最後讀取：{source.last_read_at ? fmtTime(source.last_read_at) : '尚無'}</p>
        {view ? <><p>目前可見 {view.observations.length} 列　｜　這份內容首次收件：{fmtTime(view.received_at)}</p>
          <div className="responsive-table"><table><thead><tr><th>設備顯示名稱</th><th>FindTag 顯示地址</th><th>FindTag 原始時間（時區未確認）</th><th>資料品質</th></tr></thead>
            <tbody>{view.observations.map((row, index) => <tr key={`${view.snapshot_id}-${index}`}><td>{row.device_label}</td><td>{row.address_text || '尚未取得完整地址'}</td><td>{row.source_time_text || '畫面未顯示時間'}</td><td>{row.address_text ? '畫面文字／尚無座標' : '資料未完整顯示／尚待確認'}</td></tr>)}</tbody>
          </table></div></> : <p>尚未收到可見清單；不以零座標或假資料代替。</p>}
        {isAdmin && source.active && (disabling === source.collector_id
          ? <div className="findtag-actions"><span>確定停用此桌機？既有觀測資料會保留。</span><button className="secondary-btn compact" onClick={() => setDisabling(null)}>取消</button><button className="danger-btn compact" disabled={saving} onClick={() => void disable(source.collector_id)}>確認停用</button></div>
          : <button className="danger-btn compact" onClick={() => setDisabling(source.collector_id)}>停用桌機授權</button>)}
      </article>;
    })}
    {isAdmin && <details className="findtag-setup"><summary>新增桌機同步授權</summary>
      <p>配對檔有效 10 分鐘，只能配對一台桌機。請勿轉傳；網站不會要求 FindTag 帳號或密碼。</p>
      <div className="findtag-actions"><label>桌機名稱<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <button className="primary-btn compact" disabled={saving || !name.trim()} onClick={() => void createPairing()}>產生桌機配對檔</button>
        {pairing && <button className="secondary-btn compact" onClick={download}>下載桌機配對檔</button>}
      </div>
      {pairing && <p role="status">配對檔已產生，有效至 {fmtTime(pairing.expires_at)}。下載後交給本機同步程式完成配對。</p>}
    </details>}
  </section>;
}
