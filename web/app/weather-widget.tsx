'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PUBLIC_WEATHER_SERVICE, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';
import { createWeatherReader } from '@/lib/weather-api';
import { createRequestSequence } from '@/lib/request-sequence';
import { emptyTownForecastView, formatWeatherMetric, formatWeatherTextMetric, visibleTownForecastView, type TownForecastView } from '@/lib/weather-presentation';
import { WEATHER_COUNTIES, observationTemperature, observationStatus, summaryExpired, weatherSymbol, weatherTime as localTime } from '@/lib/weather-observation';
import { WeatherCountyObservations } from './weather-county-observations';
import { WEATHER_MAP_V3_BADGE_RADIUS, WEATHER_MAP_V3_CANVAS, WEATHER_MAP_V3_MAP_MATRIX, WEATHER_MAP_V3_MARKERS, WEATHER_MAP_V3_TEMPERATURE_LABEL_OFFSET_Y, WEATHER_MAP_V3_VIEWBOX } from '@/lib/weather-map-v3';

type Row = Record<string, any>;
type MapCountyShape = { id: string; county: string; path: string; title: string };


const COUNTIES = WEATHER_COUNTIES;

const readWeather = createWeatherReader({ url: `${SUPABASE_URL}/functions/v1/cwa-weather`, anonKey: SUPABASE_ANON_KEY }, PUBLIC_WEATHER_SERVICE);

export function WeatherWidget() {
  const [summary, setSummary] = useState<Row | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const expired = summaryExpired(summary, now);
  const [county, setCounty] = useState('臺北市');
  const [townView, setTownView] = useState<TownForecastView<Row>>(() => emptyTownForecastView());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  // SVG is parsed into a narrow, typed set of React attributes. Keeping raw
  // markup out of state avoids an injection sink if the asset is replaced.
  const [mapShapes, setMapShapes] = useState<MapCountyShape[]>([]);
  const [mapError, setMapError] = useState('');
  const summaryRequests = useRef(createRequestSequence());
  const townRequests = useRef(createRequestSequence());
  const currentTownView = visibleTownForecastView(townView, county);
  const { towns, selectedTown, error: townError, busy: townBusy } = currentTownView;

  const switchCounty = useCallback((nextCounty: string) => {
    townRequests.current.invalidate();
    setTownView(emptyTownForecastView<Row>(nextCounty));
    setCounty(nextCounty);
  }, []);

  const loadMap = useCallback(async () => {
    try {
      const res = await fetch('/Inspection/v2/taiwan-counties.svg');
      if (!res.ok) throw new Error('County SVG request failed');
      const text = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') {
        throw new Error('Invalid Taiwan county SVG');
      }
      const shapes: MapCountyShape[] = [];
      doc.querySelectorAll('path.county').forEach((el, index) => {
        const rawCounty = el.getAttribute('data-county');
        const pathData = el.getAttribute('d');
        if (rawCounty && pathData) {
          const county = rawCounty.replace('台', '臺');
          shapes.push({
            id: 'county-shape-' + index,
            county,
            path: pathData,
            title: el.querySelector('title')?.textContent || county,
          });
        }
      });
      if (!shapes.length) throw new Error('Taiwan county SVG has no county paths');
      setMapShapes(shapes);
      setMapError('');
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
      <section className="weather-map-panel" style={{ background: 'transparent' }} aria-label="台灣縣市天氣分布；溫度為測站觀測，晴雨圖示為縣市預報">
      <h3 className="weather-map-heading">台灣縣市天氣</h3>
      {/* 地圖區域 */}
      <div className="weather-map-container" style={{ background: 'transparent' }}>
        {mapError && <p className="weather-map-status" role="status">{mapError}</p>}
        {!mapError && !mapShapes.length && <p className="weather-map-status" role="status">正在載入縣市地圖…</p>}
        <svg viewBox={WEATHER_MAP_V3_VIEWBOX} style={{ width: '100%', height: '100%', display: 'block' }}>
          
          {/* 注入台灣地圖路徑，設定樣式 */}
          <style>{`.weather-map-container svg .county { fill: transparent; stroke: transparent; stroke-width: 1.1px; pointer-events: all; transition: fill 0.2s, stroke 0.2s; }
.weather-map-container svg .county.selected { fill: color-mix(in srgb, var(--cyan) 16%, transparent); stroke: color-mix(in srgb, var(--cyan) 58%, transparent); stroke-width: 2px; }
.weather-map-container svg .county[role="button"] { cursor: pointer; }
.weather-map-container svg .county[role="button"]:hover { fill: color-mix(in srgb, var(--cyan) 12%, transparent); }
.weather-map-container svg .county[role="button"]:focus-visible { stroke: var(--cyan); stroke-width: 2.5px; }
.weather-map-container svg .weather-map-art, .weather-map-container svg .weather-icons-art { pointer-events: none; }
.weather-map-container svg .weather-marker-hit { fill: transparent; stroke: transparent; pointer-events: all; }
.weather-map-container svg .weather-marker-known.selected .weather-marker-hit { fill: color-mix(in srgb, var(--cyan) 8%, transparent); stroke: var(--cyan); stroke-width: 1.6px; }
.weather-map-container svg .weather-marker-known:focus-visible .weather-marker-hit { stroke: var(--cyan); stroke-width: 2px; }
.weather-map-container svg .weather-marker-temperature { fill: var(--text-hi); font-size: 11px; font-weight: 700; paint-order: stroke; stroke: var(--panel); stroke-width: 1px; }
.weather-map-container svg [role="button"]:focus-visible { outline: none; }`}</style>
          {/* Blender V4 raster provides the approved map appearance; SVG paths remain the county hit regions. */}
          <image className="weather-map-art" href="/Inspection/v2/taiwan-weather-map-layer.png" x={0} y={0} width={WEATHER_MAP_V3_CANVAS.width} height={WEATHER_MAP_V3_CANVAS.height} preserveAspectRatio="none" aria-hidden="true" pointerEvents="none" />
          <g className="weather-county-hit-layer" transform={`matrix(${WEATHER_MAP_V3_MAP_MATRIX.join(' ')})`} fillRule="evenodd">
            {mapShapes.map(shape => {
              const selectable = COUNTIES.includes(shape.county);
              const isSelected = shape.county === county;
              return (
                <path
                  key={shape.id}
                  className={isSelected ? 'county selected' : 'county'}
                  data-county={shape.county}
                  role={selectable ? 'button' : undefined}
                  aria-label={selectable ? `${shape.county}天氣摘要` : undefined}
                  aria-pressed={selectable ? isSelected : undefined}
                  onClick={selectable ? () => switchCounty(shape.county) : undefined}
                  onKeyDown={selectable ? event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      switchCounty(shape.county);
                    }
                  } : undefined}
                  tabIndex={selectable ? 0 : undefined}
                  d={shape.path}
                >
                  <title>{shape.title}</title>
                </path>
              );
            })}
          </g>

          <g className="weather-marker-layer">
            {WEATHER_MAP_V3_MARKERS.map((marker, index) => {
              const mappedCounty = marker.county;
              const data = mappedCounty
                ? (summary?.counties || []).find((row: Row) => String(row.county || '').replace('台', '臺') === mappedCounty) || {}
                : {};
              const isSelected = mappedCounty === county;
              const temperature = mappedCounty ? observationTemperature(data.temperature) : '--°C';
              const markerNumber = String(index + 1).padStart(2, '0');
              const markerLabel = mappedCounty
                ? `${mappedCounty}，觀測溫度 ${temperature}，預報 ${data.weather || '未提供'}`
                : `位置 ${markerNumber}：縣市對應待確認，氣溫 ${temperature}`;
              return (
                <g
                  key={marker.id}
                  className={mappedCounty ? `weather-marker-known${isSelected ? ' selected' : ''}` : 'weather-marker-unknown'}
                  transform={`translate(${marker.x} ${marker.y})`}
                  role={mappedCounty ? 'button' : 'img'}
                  aria-label={markerLabel}
                  aria-pressed={mappedCounty ? isSelected : undefined}
                  onClick={mappedCounty ? () => switchCounty(mappedCounty) : undefined}
                  onKeyDown={mappedCounty ? event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      switchCounty(mappedCounty);
                    }
                  } : undefined}
                  tabIndex={mappedCounty ? 0 : undefined}
                  style={{ cursor: mappedCounty ? 'pointer' : 'default', outline: 'none' }}
                >
                  <title>{markerLabel}</title>
                  <circle className="weather-marker-hit" r={WEATHER_MAP_V3_BADGE_RADIUS} />
                  <text x={0} y={-8} textAnchor="middle" dominantBaseline="central" className="weather-marker-symbol" aria-hidden="true">{mappedCounty ? weatherSymbol(data.weather) : '？'}</text>
                  <text x={0} y={WEATHER_MAP_V3_TEMPERATURE_LABEL_OFFSET_Y} textAnchor="middle" dominantBaseline="central" className="weather-marker-temperature">
                    {temperature}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

      </div>
        <p className="weather-map-caption" role="note">
          <span className="weather-map-caption__dot" aria-hidden="true" />
          <span>溫度為測站觀測，晴雨圖示為縣市預報；問號表示資料或縣市對應待確認。完整 22 縣市資料列於下方。</span>
        </p>
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
          {summary?.updatedAt ? `資料取得時間：${localTime(summary.updatedAt)}` : ''} {expired ? '【快取已過期，保留上次資料】' : ''}
          {summary?.usingFallback && <span> · 使用備援氣象服務</span>}
        </div>

        <WeatherCountyObservations summary={summary} now={now} />

        {/* 主要天氣卡片 */}
        <div style={{ background: 'var(--panel2)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 20px 0', color: 'var(--cyan)', fontSize: '28px', borderBottom: '1px solid var(--border-hi)', paddingBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span>{detailPlace}</span>
            <span style={{ color: 'var(--text-hi)', fontSize: '22px' }}>預報：{detail.weather || '未提供'}</span>
            <span style={{ fontSize: '32px', marginLeft: 'auto' }}>{weatherSymbol(detail.weather)}</span>
          </h3>
          {!selectedTown && <p className="weather-town-forecast-time">中央氣象署 · 測站：{current.stationName || '未提供'} · 觀測：{localTime(current.observedAt)} · {observationStatus(current.observedAt, current.temperature, now)}</p>}
          {selectedTown && <p className="weather-town-forecast-time">鄉鎮預報時間：{selectedTown.startsAt ? localTime(selectedTown.startsAt) : '未提供'}</p>}
          {selectedTown?.description && <p className="weather-town-description">{String(selectedTown.description)}</p>}
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', margin: 0 }}>
            <div>
              <dt style={{ color: 'var(--dim)', fontSize: '14px', marginBottom: '8px' }}>{selectedTown ? '預報溫度' : '觀測溫度'}</dt>
              <dd style={{ margin: 0, fontSize: '32px', fontWeight: 'bold', color: 'var(--cyan)' }}>{observationTemperature(detail.temperature)}</dd>
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
                    <td style={{ padding: '12px', color: 'var(--text-hi)' }}>{weatherSymbol(town.weather)} {town.weather || '未提供'}</td>
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
