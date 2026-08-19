'use client';

import { useCallback, useEffect, useState } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';

type Row = Record<string, any>;

const COUNTIES = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣'];

const MAIN_ISLAND_VIEWBOX = '220 185 450 610';
const MARKER_POSITIONS: Record<string, [number, number]> = {
  '基隆市': [540, 230],
  '臺北市': [485, 215],
  '新北市': [430, 225],
  '桃園市': [375, 245],
  '新竹市': [325, 280],
  '新竹縣': [285, 325],
  '苗栗縣': [250, 385],
  '臺中市': [250, 450],
  '彰化縣': [250, 515],
  '雲林縣': [250, 580],
  '嘉義市': [250, 645],
  '嘉義縣': [270, 705],
  '臺南市': [325, 735],
  '高雄市': [395, 755],
  '屏東縣': [495, 725],
  '臺東縣': [565, 675],
  '花蓮縣': [620, 555],
  '宜蘭縣': [625, 390],
  '南投縣': [455, 465]
};
const LEFT_TEMP_COUNTIES = new Set(['苗栗縣', '臺中市', '彰化縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣']);

const ENDPOINT = `${SUPABASE_URL}/functions/v1/cwa-weather`;

// Helpers
const localTime = (value: unknown) => {
  if (!value) return '時間未提供';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
};
const num = (value: unknown, digits = 0) => (value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—');

function weatherIcon(text: string, code?: string) {
  const value = String(text || '') + ' ' + String(code || '');
  if (/雷|閃電|雷雨/.test(value)) return '⛈️';
  if (/雪|冰雹/.test(value)) return '❄️';
  if (/雨|陣雨|降雨/.test(value)) return /晴/.test(value) ? '🌦️' : '🌧️';
  if (/霧|霾/.test(value)) return '🌫️';
  if (/陰/.test(value)) return '☁️';
  if (/雲/.test(value)) return /晴/.test(value) ? '🌤️' : '🌥️';
  if (/晴/.test(value)) return '☀️';
  return '🌡️';
}

export function WeatherWidget() {
  const [summary, setSummary] = useState<Row | null>(null);
  const [towns, setTowns] = useState<Row[]>([]);
  const [county, setCounty] = useState('臺北市');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [mapSvg, setMapSvg] = useState<string>('');
  const [countyCenters, setCountyCenters] = useState<Record<string, [number, number]>>({});
  const [townsOpen, setTownsOpen] = useState(false);

  const loadMap = useCallback(async () => {
    try {
      const res = await fetch((process.env.NEXT_PUBLIC_BASE_PATH || '') + '/taiwan-counties.svg');
      if (res.ok) {
        const text = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'image/svg+xml');
        
        const centers: Record<string, [number, number]> = {};
        doc.querySelectorAll('.county').forEach(el => {
          const c = el.getAttribute('data-county');
          const cx = el.getAttribute('data-cx');
          const cy = el.getAttribute('data-cy');
          if (c && cx && cy) {
            // Normalize "台" to "臺" just in case the SVG uses "台"
            const canonicalName = c.replace('台', '臺');
            centers[canonicalName] = [Number(cx), Number(cy)];
          }
        });
        setCountyCenters(centers);
        
        // Extract inner HTML of the <svg> tag
        setMapSvg(doc.documentElement.innerHTML);
      }
    } catch (err) {
      console.error('Map loading failed', err);
    }
  }, []);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const url = new URL(ENDPOINT);
      url.searchParams.set('view', 'summary');
      const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error(payload.message || `API Error ${res.status}`);
      setSummary(payload);
    } catch (e: any) {
      setError(e.message || '天氣資料載入失敗');
    }
    setBusy(false);
  }, []);

  useEffect(() => { void loadMap(); void load(); }, [loadMap, load]);
  
  useEffect(() => {
    if (townsOpen && county) {
      const loadTowns = async () => {
        try {
          const url = new URL(ENDPOINT);
          url.searchParams.set('view', 'town');
          url.searchParams.set('county', county);
          const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
          const payload = await res.json();
          if (res.ok && payload.ok) setTowns(payload.towns || []);
        } catch (e) {
          console.error(e);
        }
      };
      loadTowns();
    } else {
      setTowns([]);
    }
  }, [county, townsOpen]);

  if (busy && !summary) return <p className="empty">正在取得中央氣象署資料…</p>;
  if (error && !summary) return <p className="empty">氣象服務暫時無法使用：{error}</p>;

  const current: Row = (summary?.counties || []).find((row: Row) => row.county.replace('台', '臺') === county) || {};
  const stem = county.replace(/[市縣]$/, '');
  const countyAlerts: Row[] = (summary?.alerts || []).filter((alert: Row) =>
    (alert.areas || []).some((area: unknown) => String(area).includes(stem)));

  return (
    <div className="weather-widget" style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* 地圖區域 */}
      <div className="weather-map-container" style={{ flex: '1 1 400px', position: 'relative', minHeight: '650px', background: 'var(--panel2)', borderRadius: '12px', overflow: 'hidden' }}>
        <svg viewBox={MAIN_ISLAND_VIEWBOX} style={{ width: '100%', height: '100%', display: 'block' }}>
          
          {/* 注入台灣地圖路徑，設定樣式 */}
          <style>{`
            .weather-map-container svg .county {
              fill: var(--panel);
              stroke: var(--border-hi);
              stroke-width: 1px;
              transition: fill 0.2s;
            }
            .weather-map-container svg .county.selected {
              fill: rgba(34, 211, 238, 0.2);
              stroke: var(--cyan);
              stroke-width: 2px;
            }
            .weather-map-container svg .county:hover {
              fill: rgba(255, 255, 255, 0.1);
            }
          `}</style>
          
          {mapSvg && <g dangerouslySetInnerHTML={{ __html: mapSvg }} />}

          <g className="weather-marker-layer">
            {COUNTIES.map(name => {
              const data = (summary?.counties || []).find((r: Row) => r.county.replace('台', '臺') === name) || {};
              const pos = MARKER_POSITIONS[name];
              const cx = countyCenters[name];
              if (!pos || !cx) return null;
              
              const isLeft = LEFT_TEMP_COUNTIES.has(name);
              const isSelected = name === county;
              
              return (
                <g key={name} onClick={() => setCounty(name)} style={{ cursor: 'pointer', outline: 'none' }} tabIndex={0}>
                  {/* 連接線 */}
                  <line x1={cx[0]} y1={cx[1]} x2={pos[0]} y2={pos[1]} stroke="var(--cyan)" strokeWidth="1.5" strokeDasharray="3,3" opacity="0.6" />
                  <path d={`M${cx[0]} ${cx[1]} a3,3 0 1,1 0,0.1`} fill="var(--cyan)" />
                  
                  {/* 圖示與氣溫卡 */}
                  <g transform={`translate(${pos[0]} ${pos[1]})`}>
                    <circle r={isSelected ? "28" : "24"} fill={isSelected ? "var(--cyan)" : "var(--panel)"} stroke="var(--cyan)" strokeWidth={isSelected ? "0" : "1.5"} opacity={isSelected ? "1" : "0.9"} />
                    <text y="-2" textAnchor="middle" dominantBaseline="central" fontSize={isSelected ? "26px" : "22px"}>
                      {weatherIcon(data.weather, data.weatherCode)}
                    </text>
                    <text 
                      y={isLeft ? "2" : "38"} 
                      x={isLeft ? "-32" : "0"} 
                      textAnchor={isLeft ? "end" : "middle"} 
                      dominantBaseline="central" 
                      fontSize="20px" 
                      fontWeight="bold" 
                      fill="var(--text-hi)" 
                      style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}
                    >
                      {data.temperature ? Math.round(Number(data.temperature)) + '°' : ''}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
        <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.6)', padding: '6px 12px', borderRadius: '4px', color: 'var(--cyan)', fontSize: '14px' }}>
          點擊地圖 切換縣市
        </div>
      </div>

      {/* 資訊區域 */}
      <div className="weather-info-container" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* 全區警報 */}
        <div className="weather-bulletins">
          {(summary?.bulletins || []).map((item: Row) => (
            <span key={String(item.key)} className={`weather-bulletin ${item.status}`} style={{ display: 'block', marginBottom: '8px', padding: '8px', background: 'var(--panel2)', borderRadius: '4px', borderLeft: '3px solid var(--amber)' }}>
              <b style={{ color: 'var(--text-hi)' }}>{String(item.label)}</b> {String(item.title)}
              {item.status !== 'clear' && item.issuedAt ? <small style={{ marginLeft: '8px', color: 'var(--dim)' }}>{localTime(item.issuedAt)}</small> : null}
            </span>
          ))}
        </div>

        <div className="weather-controls" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={county} onChange={e => setCounty(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--panel2)', color: 'var(--text-hi)', border: '1px solid var(--border)' }}>
            {COUNTIES.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <button onClick={() => void load()} disabled={busy} className="secondary-btn" style={{ padding: '8px 16px', borderRadius: '6px', background: 'var(--panel2)', color: 'var(--text-hi)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            {busy ? '更新中…' : '重新取得'}
          </button>
          <button onClick={() => setTownsOpen(!townsOpen)} className="secondary-btn" style={{ padding: '8px 16px', borderRadius: '6px', background: 'rgba(34, 211, 238, 0.1)', color: 'var(--cyan)', border: '1px solid var(--cyan)', cursor: 'pointer' }}>
            {townsOpen ? '隱藏鄉鎮預報' : '顯示鄉鎮預報'}
          </button>
        </div>
        
        <div style={{ fontSize: '13px', color: 'var(--dim)' }}>
          {summary?.updatedAt ? `更新時間：${localTime(summary.updatedAt)}` : ''} {summary?.stale ? '【快取資料】' : ''}
        </div>

        {/* 主要天氣卡片 */}
        <div style={{ background: 'var(--panel2)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 20px 0', color: 'var(--cyan)', fontSize: '28px', borderBottom: '1px solid var(--border-hi)', paddingBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span>{county}</span>
            <span style={{ color: 'var(--text-hi)', fontSize: '22px' }}>{current.weather || '—'}</span>
            <span style={{ fontSize: '32px', marginLeft: 'auto' }}>{weatherIcon(current.weather, current.weatherCode)}</span>
          </h3>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', margin: 0 }}>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>目前溫度</dt>
              <dd style={{ margin: 0, fontSize: '32px', fontWeight: 'bold', color: 'var(--cyan)' }}>{num(current.temperature, 1)}<small style={{ fontSize: '20px' }}>°C</small></dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>今日高／低</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{num(current.maxTemperature)} / {num(current.minTemperature)}°C</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>相對濕度</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{num(current.humidity)}%</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>降雨機率</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{num(current.rainProbability)}%</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>風速</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{num(current.windSpeed, 1)} m/s</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>降雨量</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{num(current.rainfall, 1)} mm</dd>
            </div>
          </dl>
        </div>

        {/* 該縣市警報 */}
        {countyAlerts.length > 0 && (
          <div className="weather-alerts" style={{ background: 'rgba(255,59,59,0.1)', borderLeft: '4px solid var(--red)', padding: '16px', borderRadius: '4px' }}>
            {countyAlerts.map((alert: Row, index: number) => (
              <p key={index} style={{ margin: index === 0 ? '0 0 8px 0' : '8px 0', color: 'var(--red)' }}>
                <b>{String(alert.title || '氣象警特報')}</b><br/>
                <small style={{ color: 'var(--text-hi)' }}>{alert.content ? String(alert.content) : '請注意安全'}</small>
              </p>
            ))}
          </div>
        )}

        {/* 鄉鎮市區列表 */}
        {townsOpen && (
          <div className="responsive-table" style={{ maxHeight: '500px', overflowY: 'auto', background: 'var(--panel2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 10 }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: '12px', color: 'var(--dim)', borderBottom: '1px solid var(--border-hi)' }}>鄉鎮</th>
                  <th style={{ textAlign: 'left', padding: '12px', color: 'var(--dim)', borderBottom: '1px solid var(--border-hi)' }}>天氣</th>
                  <th style={{ padding: '12px', textAlign: 'center', color: 'var(--dim)', borderBottom: '1px solid var(--border-hi)' }}>溫度</th>
                  <th style={{ padding: '12px', textAlign: 'center', color: 'var(--dim)', borderBottom: '1px solid var(--border-hi)' }}>降雨</th>
                  <th style={{ padding: '12px', textAlign: 'center', color: 'var(--dim)', borderBottom: '1px solid var(--border-hi)' }}>濕度</th>
                </tr>
              </thead>
              <tbody>
                {towns.map((town, i) => (
                  <tr key={String(town.town)} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '12px', color: 'var(--text-hi)' }}><strong>{String(town.town)}</strong></td>
                    <td style={{ padding: '12px', color: 'var(--text-hi)' }}>{weatherIcon(town.weather, town.weatherCode)} {town.weather || '—'}</td>
                    <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-hi)' }}>{num(town.temperature)}°C</td>
                    <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-hi)' }}>{num(town.rainProbability)}%</td>
                    <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-hi)' }}>{num(town.humidity)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!towns.length && <p style={{ padding: '24px', textAlign: 'center', color: 'var(--dim)' }}>載入中或無資料…</p>}
          </div>
        )}

      </div>
    </div>
  );
}
