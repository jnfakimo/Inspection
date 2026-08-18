'use client';

// 戰情儀表板的「臺灣即時氣象」元件，對應 V1 的 system/weather-widget.js。
//
// 資料一律走既有的 cwa-weather Edge Function（view=summary／county／town），
// 中央氣象署的 API key 留在函式端，前端只帶 anon key，與 V1 相同。
//
// 與 V1 的差異：V1 在儀表板嵌了一張可點選的臺灣 SVG 地圖（assets/taiwan-counties.svg）
// 當縣市選取器。這裡改用下拉選單——地圖在 12 欄版面裡會被壓到難以點選，
// 而且那張圖只是選取介面，不影響任何數據。警特報、縣市觀測與鄉鎮預報三段都保留。

import { useCallback, useEffect, useState } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';

type Row = Record<string, any>;
const COUNTIES = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];
const ENDPOINT = `${SUPABASE_URL}/functions/v1/cwa-weather`;

const num = (value: unknown, digits = 0) =>
  value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
const localTime = (value: unknown) => {
  if (!value) return '';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value)
    : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
};

async function callWeather(view: string, params: Record<string, string> = {}) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('view', view);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { cache: 'no-store', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || `氣象服務回應 ${response.status}`);
  return payload as Row;
}

export function WeatherWidget() {
  const [summary, setSummary] = useState<Row | null>(null);
  const [county, setCounty] = useState('臺北市');
  const [towns, setTowns] = useState<Row[]>([]);
  const [townsOpen, setTownsOpen] = useState(false);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setSummary(await callWeather('summary')); }
    catch (e) { setError(e instanceof Error ? e.message : '氣象資料讀取失敗'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 鄉鎮預報是另一支資料集，切換縣市或收合時不預先抓，按下才載入。
  const loadTowns = useCallback(async (target: string) => {
    setTowns([]); setError('');
    try {
      const payload = await callWeather('town', { county: target });
      setTowns(Array.isArray(payload.towns) ? payload.towns : []);
    } catch (e) { setError(e instanceof Error ? e.message : '鄉鎮預報讀取失敗'); }
  }, []);
  useEffect(() => { if (townsOpen) void loadTowns(county); }, [townsOpen, county, loadTowns]);

  if (busy && !summary) return <p className="empty">正在讀取中央氣象署資料…</p>;
  if (error && !summary) return <p className="empty">氣象資料讀取失敗：{error}</p>;

  const current: Row = (summary?.counties || []).find((row: Row) => row.county === county) || {};
  const stem = county.replace(/[市縣]$/, '');
  const countyAlerts: Row[] = (summary?.alerts || []).filter((alert: Row) =>
    (alert.areas || []).some((area: unknown) => String(area).includes(stem)));

  return <div className="weather-widget">
    <div className="weather-bulletins">
      {(summary?.bulletins || []).map((item: Row) => <span key={String(item.key)} className={`weather-bulletin ${item.status}`}>
        <b>{String(item.label)}</b>{String(item.title)}
        {item.status !== 'clear' && item.issuedAt ? <small>{localTime(item.issuedAt)}</small> : null}
      </span>)}
    </div>

    <div className="weather-controls">
      <select value={county} onChange={e => { setCounty(e.target.value); setTowns([]); }}>
        {COUNTIES.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
      <button className="secondary-btn" onClick={() => void load()} disabled={busy}>{busy ? '更新中…' : '重新整理'}</button>
      <button className="secondary-btn" onClick={() => setTownsOpen(open => !open)}>{townsOpen ? '收合鄉鎮預報' : '鄉鎮預報'}</button>
      <span>{summary?.updatedAt ? `更新：${localTime(summary.updatedAt)}` : ''}{summary?.stale ? '（快取資料）' : ''}</span>
    </div>

    <dl className="weather-metrics">
      <div><dt>天氣</dt><dd>{current.weather || '—'}</dd></div>
      <div><dt>目前溫度</dt><dd>{num(current.temperature, 1)}°C</dd></div>
      <div><dt>今日高／低</dt><dd>{num(current.maxTemperature)}／{num(current.minTemperature)}°C</dd></div>
      <div><dt>相對濕度</dt><dd>{num(current.humidity)}%</dd></div>
      <div><dt>風速</dt><dd>{num(current.windSpeed, 1)} m/s</dd></div>
      <div><dt>降雨機率</dt><dd>{num(current.rainProbability)}%</dd></div>
      <div><dt>時雨量</dt><dd>{num(current.rainfall, 1)} mm</dd></div>
      <div><dt>觀測站</dt><dd>{current.stationName || '—'}{current.observedAt ? `（${localTime(current.observedAt)}）` : ''}</dd></div>
    </dl>

    {countyAlerts.length > 0 && <div className="weather-alerts">
      {countyAlerts.map((alert: Row, index: number) => <p key={index}>
        <b>{String(alert.title || '氣象特報')}</b>{alert.content ? `　${String(alert.content)}` : ''}
      </p>)}
    </div>}

    {townsOpen && <div className="responsive-table"><table>
      <thead><tr><th>鄉鎮</th><th>天氣</th><th>溫度</th><th>降雨機率</th><th>濕度</th></tr></thead>
      <tbody>{towns.map(town => <tr key={String(town.town)}>
        <td><strong>{String(town.town)}</strong></td>
        <td>{town.weather || '—'}</td>
        <td>{num(town.temperature)}°C</td>
        <td>{num(town.rainProbability)}%</td>
        <td>{num(town.humidity)}%</td>
      </tr>)}</tbody>
    </table>{!towns.length && <p className="empty">正在讀取 {county} 的鄉鎮預報…</p>}</div>}

    {error && summary && <p className="inline-message danger">{error}</p>}
  </div>;
}
