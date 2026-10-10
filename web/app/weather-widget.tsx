'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { PUBLIC_WEATHER_SERVICE, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';
import { createWeatherReader } from '@/lib/weather-api';
import { createRequestSequence } from '@/lib/request-sequence';
import { emptyTownForecastView, formatWeatherMetric, formatWeatherTextMetric, visibleTownForecastView, type TownForecastView } from '@/lib/weather-presentation';
// County weather markers use the transformed SVG county centroids as their anchors.
import { formatWeatherTemperature, layoutWeatherMarkers, WEATHER_MAP_TRANSFORM, WEATHER_MAP_VIEWBOX, type WeatherMapCountyShape } from '@/lib/weather-map-geometry';

type Row = Record<string, any>;
type MapCountyShape = WeatherMapCountyShape & { id: string; title: string };


const COUNTIES = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣'];

// 圖示離海岸線的固定間距（外層座標）。距離是以台灣輪廓為基準量出來的，
// 不是相對畫布的比例——沿岸每個圖示與陸地的空隙才會一致。

// 找不到輪廓時（地圖還沒渲染完）的退路：沿用原本的外圍座標插值。
const readWeather = createWeatherReader({ url: `${SUPABASE_URL}/functions/v1/cwa-weather`, anonKey: SUPABASE_ANON_KEY }, PUBLIC_WEATHER_SERVICE);

// Helpers
const localTime = (value: unknown) => {
  if (!value) return '時間未提供';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
};

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
  const [county, setCounty] = useState('臺北市');
  const [townView, setTownView] = useState<TownForecastView<Row>>(() => emptyTownForecastView());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  // SVG is parsed into a narrow, typed set of React attributes. Keeping raw
  // markup out of state avoids an injection sink if the asset is replaced.
  const [mapShapes, setMapShapes] = useState<MapCountyShape[]>([]);
  const [mapError, setMapError] = useState('');
  const [countyCenters, setCountyCenters] = useState<Record<string, [number, number]>>({});
  // 依台灣輪廓量出的自動落點；有手動定位時由 COUNTY_MARKER_POSITIONS 優先取用。
  const summaryRequests = useRef(createRequestSequence());
  const townRequests = useRef(createRequestSequence());
  const currentTownView = visibleTownForecastView(townView, county);
  const { towns, selectedTown, error: townError, busy: townBusy } = currentTownView;
  const markerPositions = useMemo(() => {
    const anchors = COUNTIES.flatMap(name => {
      const center = countyCenters[name];
      return center ? [{ name, x: center[0], y: center[1] }] : [];
    });
    return new Map(layoutWeatherMarkers(anchors, mapShapes).map(marker => [marker.name, marker] as const));
  }, [countyCenters, mapShapes]);

  const switchCounty = useCallback((nextCounty: string) => {
    townRequests.current.invalidate();
    setTownView(emptyTownForecastView<Row>(nextCounty));
    setCounty(nextCounty);
  }, []);

  const loadMap = useCallback(async () => {
    try {
      const res = await fetch('/Inspection/v2/taiwan-counties.svg');
      if (res.ok) {
        const text = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'image/svg+xml');
        
        const { scale: SCALE, translateX: TX, translateY: TY } = WEATHER_MAP_TRANSFORM;

        if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') {
          throw new Error('Invalid Taiwan county SVG');
        }

        const centers: Record<string, [number, number]> = {};
        const shapes: MapCountyShape[] = [];
        doc.querySelectorAll('path.county').forEach((el, index) => {
          const c = el.getAttribute('data-county');
          const cx = el.getAttribute('data-cx');
          const cy = el.getAttribute('data-cy');
          const path = el.getAttribute('d');
          const centerX = Number(cx);
          const centerY = Number(cy);
          if (c && path && Number.isFinite(centerX) && Number.isFinite(centerY)) {
            // Normalize "台" to "臺" just in case the SVG uses "台"
            const canonicalName = c.replace('台', '臺');
            centers[canonicalName] = [
              centerX * SCALE + TX,
              centerY * SCALE + TY
            ];
            shapes.push({
              id: 'county-shape-' + index,
              county: canonicalName,
              centerX,
              centerY,
              path,
              title: el.querySelector('title')?.textContent || canonicalName,
            });
          }
        });
        if (!shapes.length) throw new Error('Taiwan county SVG has no county paths');
        setCountyCenters(centers);
        setMapShapes(shapes);
      } else setMapError('縣市地圖目前無法載入');
    } catch (err) {
      console.error('Map loading failed', err);
      setMapError('縣市地圖目前無法載入');
    }
  }, []);

  const load = useCallback(async () => {
    const request = summaryRequests.current.begin();
    setBusy(true); setError('');
    try {
      const payload = await readWeather<Row>('summary');
      if (summaryRequests.current.isCurrent(request)) setSummary(payload);
    } catch (e: any) {
      if (summaryRequests.current.isCurrent(request)) setError(e.message || '天氣資料載入失敗');
    } finally {
      if (summaryRequests.current.isCurrent(request)) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadMap(); void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 600_000);
    return () => {
      window.clearInterval(timer);
      summaryRequests.current.invalidate();
    };
  }, [loadMap, load]);
  
  useEffect(() => {
    const request = townRequests.current.begin();
    setTownView(emptyTownForecastView<Row>(county));
    if (county) {
      const loadTowns = async () => {
        try {
          const payload = await readWeather<Row>('town', county);
          if (townRequests.current.isCurrent(request)) {
            setTownView({ county, towns: payload.towns || [], selectedTown: null, error: '', busy: false });
          }
        } catch (e) {
          if (townRequests.current.isCurrent(request)) {
            setTownView({ county, towns: [], selectedTown: null, error: e instanceof Error ? e.message : '鄉鎮預報載入失敗', busy: false });
          }
        }
      };
      void loadTowns();
    }
    return () => townRequests.current.invalidate();
  }, [county]);




  const current: Row = (summary?.counties || []).find((row: Row) => row.county.replace('台', '臺') === county) || {};
  const stem = county.replace(/[市縣]$/, '');
  const detail: Row = selectedTown || current;
  const detailPlace = selectedTown ? String(selectedTown.town) : county;
  const countyAlerts: Row[] = (summary?.alerts || []).filter((alert: Row) =>
    (alert.areas || []).some((area: unknown) => String(area).includes(stem)));

  return (
    <div className="weather-widget">
      <section className="weather-map-panel" style={{ background: 'transparent' }} aria-label="台灣縣市即時天氣分布">
      <h3 className="weather-map-heading">台灣縣市天氣</h3>
      {/* 地圖區域 */}
      <div className="weather-map-container" style={{ background: 'transparent' }}>
        {mapError && <p className="weather-map-status" role="status">{mapError}</p>}
        {!mapError && !mapShapes.length && <p className="weather-map-status" role="status">正在載入縣市地圖…</p>}
        <svg viewBox={WEATHER_MAP_VIEWBOX} style={{ width: '100%', height: '100%', display: 'block' }}>
          
          {/* 注入台灣地圖路徑，設定樣式 */}
          <style>{`
            .weather-map-container svg .county {
              fill: #E6F8FC;
              stroke: #55B7E8;
              stroke-width: 0.9px;
              transition: fill 0.2s;
            }
            .weather-map-container svg .county.selected {
              fill: #C6EDF7;
              stroke: #167FB2;
              stroke-width: 2px;
            }
            .weather-map-container svg .county:hover {
              fill: #D8F2F8;
            }
          `}</style>
          {/* 地圖路徑由 React 安全地建立，並用 data-county 屬性選擇器點亮選取的縣市。
              縣市名同時比對「臺」與「台」兩種寫法，SVG 用哪一種都吃得到。
              county 只可能是 COUNTIES 裡的固定值，這裡再擋一次，避免任何外部字串
              被插進樣式表。 */}
          {COUNTIES.includes(county) && <style>{`
            .weather-map-container svg .county[data-county="${county}"],
            .weather-map-container svg .county[data-county="${county.replace('臺', '台')}"] {
              fill: color-mix(in srgb, var(--cyan) 42%, transparent);
              stroke: var(--cyan);
              stroke-width: 2px;
            }
          `}</style>}
          
          <g transform={`translate(${WEATHER_MAP_TRANSFORM.translateX}, ${WEATHER_MAP_TRANSFORM.translateY}) scale(${WEATHER_MAP_TRANSFORM.scale})`} fillRule="evenodd">
            {mapShapes.map(shape => (
              <path
                key={shape.id}
                className="county"
                data-county={shape.county}
                data-cx={shape.centerX}
                data-cy={shape.centerY}
                d={shape.path}
              >
                <title>{shape.title}</title>
              </path>
            ))}
          </g>

          <g className="weather-marker-layer">
            {COUNTIES.map(name => {
              const data = (summary?.counties || []).find((r: Row) => r.county.replace('台', '臺') === name) || {};
              const isSelected = name === county;
              const spot = markerPositions.get(name);
              if (!spot) return null;
              const mx = spot.x;
              const my = spot.y;
              
              return (
                <g
                  key={name}
                  role="button"
                  aria-label={`${name}天氣詳情`}
                  aria-pressed={isSelected}
                  onClick={() => switchCounty(name)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      switchCounty(name);
                    }
                  }}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  tabIndex={0}
                >
                  <title>{name}</title>
                  {/* 圖示與氣溫卡 */}
                  <g transform={`translate(${mx} ${my})`}>
                    <circle r={isSelected ? "12" : "11.5"} fill="#FFFFFF" stroke={isSelected ? "#167FB2" : "#55B7E8"} strokeWidth={isSelected ? "1.5" : "1"} style={{ filter: "drop-shadow(0 1px 2px rgba(8, 42, 75, 0.28))" }} />
                    <text y="-1" textAnchor="middle" dominantBaseline="central" fontSize={isSelected ? "18px" : "16px"}>
                      {weatherIcon(data.weather, data.weatherCode)}
                    </text>
                    <text
                      y={spot.temperatureOffsetY}
                      x="0"
                      textAnchor="middle"
                      dominantBaseline="central" 
                      fontSize="10px"
                      fontWeight="500"
                      fill="#164E70"
                      style={{ letterSpacing: '0.01em' }}
                    >
                      {formatWeatherTemperature(data.temperature) || ''}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
        <div style={{ 
          position: 'absolute', 
          bottom: '24px', 
          right: '24px', 
          background: 'color-mix(in srgb, var(--panel) 90%, transparent)',
          backdropFilter: 'blur(4px)',
          border: '1px solid var(--line)',
          padding: '8px 16px', 
          borderRadius: '20px', 
          color: 'var(--text)', 
          fontSize: '13px',
          fontWeight: '500',
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          pointerEvents: 'none'
        }}>
          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--cyan)' }}></span>
          點擊地圖或周圍圖示可切換縣市
        </div>
      </div>
      </section>

      {/* 資訊區域 */}
      <div className="weather-info-container">
        {busy && !summary && <p className="empty" role="status">正在載入天氣資訊…</p>}
        {error && <div className="inline-message" role="status">
          <span>{summary ? `更新失敗，目前保留上次資料：${error}` : error}</span>
          <button className="secondary-btn compact" onClick={() => void load()} disabled={busy}>重新取得天氣</button>
        </div>}
        {summary?.sourceWarnings?.length > 0 && <p className="inline-message" role="status">部分氣象資料暫缺，請以中央氣象署最新公告為準。</p>}
        
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
          <label className="weather-county-select">縣市
          <select aria-label="選擇縣市" value={county} onChange={e => switchCounty(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--panel2)', color: 'var(--text-hi)', border: '1px solid var(--border)' }}>
            {COUNTIES.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          </label>
          <button onClick={() => void load()} disabled={busy} className="secondary-btn" style={{ padding: '8px 16px', borderRadius: '6px', background: 'var(--panel2)', color: 'var(--text-hi)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            {busy ? '更新中…' : '重新取得'}
          </button>
        </div>
        
        <nav className="weather-breadcrumb" aria-label="目前天氣位置">
          <span>台灣各縣市</span><span aria-hidden="true">›</span><strong>{county}</strong>
          {selectedTown && <><span aria-hidden="true">›</span><strong aria-current="page">{selectedTown.town}</strong></>}
          {selectedTown && <button type="button" className="secondary-btn compact" onClick={() => setTownView(view => view.county === county ? { ...view, selectedTown: null } : view)}>返回縣市摘要</button>}
        </nav>

        <div className="weather-updated" style={{ fontSize: '13px', color: 'var(--dim)' }}>
          {summary?.updatedAt ? `更新時間：${localTime(summary.updatedAt)}` : ''} {summary?.stale ? '【快取資料】' : ''}
          {summary?.usingFallback && <span> · 使用備援氣象服務</span>}
        </div>

        {/* 主要天氣卡片 */}
        <div style={{ background: 'var(--panel2)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 20px 0', color: 'var(--cyan)', fontSize: '28px', borderBottom: '1px solid var(--border-hi)', paddingBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span>{detailPlace}</span>
            <span style={{ color: 'var(--text-hi)', fontSize: '22px' }}>{detail.weather || '未提供'}</span>
            <span style={{ fontSize: '32px', marginLeft: 'auto' }}>{weatherIcon(detail.weather, detail.weatherCode)}</span>
          </h3>
          {selectedTown && <p className="weather-town-forecast-time">鄉鎮預報時間：{selectedTown.startsAt ? localTime(selectedTown.startsAt) : '未提供'}</p>}
          {selectedTown?.description && <p className="weather-town-description">{String(selectedTown.description)}</p>}
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', margin: 0 }}>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>目前溫度</dt>
              <dd style={{ margin: 0, fontSize: '32px', fontWeight: 'bold', color: 'var(--cyan)' }}>{formatWeatherMetric(detail.temperature, '°C', 1)}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>今日高／低</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{formatWeatherMetric(detail.maxTemperature, '°C')} / {formatWeatherMetric(detail.minTemperature, '°C')}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>相對濕度</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{formatWeatherMetric(detail.humidity, '%')}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>降雨機率</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{formatWeatherMetric(detail.rainProbability, '%')}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>風速</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{formatWeatherTextMetric(detail.windSpeed, ' m/s')}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>降雨量</dt>
              <dd style={{ margin: 0, fontSize: '22px', color: 'var(--text-hi)' }}>{formatWeatherMetric(detail.rainfall, ' mm', 1)}</dd>
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
          <details className="weather-town-details">
            <summary>
              <span>鄉鎮預報</span>
              <span>{townBusy ? '載入中…' : towns.length ? `${towns.length} 個鄉鎮` : '展開查看'}</span>
            </summary>
            <div className="responsive-table" style={{ maxHeight: '500px', overflowY: 'auto', background: 'var(--panel2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            {townBusy && <p role="status">正在取得鄉鎮預報…</p>}
            {townError && <p role="status">{townError}</p>}
            {!townBusy && !townError && !towns.length && <p>目前無鄉鎮預報資料。</p>}
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
                    <td style={{ padding: '12px', color: 'var(--text-hi)' }}><button type="button" className="weather-town-select" aria-pressed={selectedTown?.town === town.town} onClick={() => setTownView(view => view.county === county ? { ...view, selectedTown: town } : view)}>{String(town.town)}</button></td>
                    <td style={{ padding: '12px', color: 'var(--text-hi)' }}>{weatherIcon(town.weather, town.weatherCode)} {town.weather || '未提供'}</td>
                    <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-hi)' }}>{formatWeatherMetric(town.temperature, '°C')}</td>
                    <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-hi)' }}>{formatWeatherMetric(town.rainProbability, '%')}</td>
                    <td style={{ padding: '12px', textAlign: 'center', color: 'var(--text-hi)' }}>{formatWeatherMetric(town.humidity, '%')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </details>

      </div>
    </div>
  );
}
