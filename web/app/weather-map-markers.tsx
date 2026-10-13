import { WEATHER_MAP_V3_BADGE_RADIUS, WEATHER_MAP_V3_MARKERS, WEATHER_MAP_V3_TEMPERATURE_LABEL_OFFSET_Y } from '@/lib/weather-map-v3';
import { observationTemperature, observationStatus, summaryExpired, weatherPresentation, weatherTime, type WeatherConditions } from '@/lib/weather-observation';

type WeatherRow = WeatherConditions & { county?: string; temperature?: unknown; stationName?: string };
type WeatherSummary = { counties?: WeatherRow[]; stale?: unknown; updatedAt?: unknown };

/** Marker IDs retain the original CWA reference order, even after offshore repositioning. */
export function WeatherMapMarkers({ summary, now, selectedCounty, onSelect }: {
  summary: WeatherSummary | null; now: number; selectedCounty: string; onSelect: (county: string) => void;
}) {
  const expired = summaryExpired(summary, now);
  return <g className="weather-marker-layer">{WEATHER_MAP_V3_MARKERS.map(marker => {
    const county = marker.county;
    const data = summary?.counties?.find(row => String(row.county || '').replace('台', '臺') === county) || {};
    const temperature = observationTemperature(data.temperature);
    const status = observationStatus(data.observedAt, data.temperature, now);
    const conditions = weatherPresentation(data, now);
    const stale = expired || conditions.stale || status === '觀測已逾 90 分鐘';
    const label = `${county}，觀測溫度 ${temperature}，${status}，中央氣象署測站 ${data.stationName || '未提供'}，觀測 ${weatherTime(data.observedAt)}；${conditions.label} ${conditions.description}，${conditions.time}，${conditions.status}${expired ? '；快取已過期' : ''}`;
    return <g key={marker.id} data-marker-id={marker.id} data-county={county}
      className={`weather-marker-known${county === selectedCounty ? ' selected' : ''}${stale ? ' is-stale' : ''}`}
      transform={`translate(${marker.x} ${marker.y})`} role="button" tabIndex={0}
      aria-label={label} aria-pressed={county === selectedCounty} onClick={() => onSelect(county)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(county); } }}>
      <title>{label}</title>
      <circle className="weather-marker-surface" r={WEATHER_MAP_V3_BADGE_RADIUS} />
      <circle className="weather-marker-hit" r={WEATHER_MAP_V3_BADGE_RADIUS} />
      <text x={0} y={-24} textAnchor="middle" dominantBaseline="central" className="weather-marker-county">{county}</text>
      <text x={0} y={-5} textAnchor="middle" dominantBaseline="central" className="weather-marker-symbol" aria-hidden="true">{conditions.symbol}</text>
      <text x={0} y={WEATHER_MAP_V3_TEMPERATURE_LABEL_OFFSET_Y} textAnchor="middle" dominantBaseline="central" className="weather-marker-temperature">{temperature}{stale && temperature !== '未提供' ? '*' : ''}</text>
    </g>;
  })}</g>;
}
