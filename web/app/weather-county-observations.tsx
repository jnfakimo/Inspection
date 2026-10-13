import { WEATHER_COUNTIES as COUNTIES, observationTemperature, observationStatus, summaryExpired, weatherSymbol, weatherTime as localTime } from '@/lib/weather-observation';
type Row = Record<string, any>;
export function WeatherCountyObservations({ summary, now }: { summary: Row | null; now: number }) {
  const expired = summaryExpired(summary, now);
  return (<section className="weather-county-observations" aria-label="22 縣市觀測溫度與天氣預報">
          <h3>22 縣市觀測溫度與天氣預報</h3>
          <p>來源：中央氣象署。溫度為各縣市代表測站觀測，非全縣平均；晴雨為縣市預報。</p>
          {expired && <p role="status">快取已過期；以下為上次取得的資料，請留意觀測時間。</p>}
          <ul className="weather-county-grid">
            {COUNTIES.map(name => {
              const row: Row = (summary?.counties || []).find((item: Row) => String(item.county || '').replace('台', '臺') === name) || {};
              return <li key={name}>
                <div className="weather-county-observation-title"><strong>{name}</strong><b>{observationTemperature(row.temperature)}</b></div>
                <p><span aria-hidden="true">{weatherSymbol(row.weather)}</span> 預報：{row.weather || '未提供'}</p>
                <p>測站：{row.stationName || '未提供'}</p>
                <p>觀測：{localTime(row.observedAt)}</p>
                <p>{observationStatus(row.observedAt, row.temperature, now)}</p>
              </li>;
            })}
          </ul>
        </section>);
}
