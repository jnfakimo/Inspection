// The summary contract uses station observations for temperature and F-C0032-001
// forecasts for weather/weatherCode, with separate observedWeather from the same station.
// Never substitute forecast min/max for observations.
export const WEATHER_COUNTIES = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];

export function observationTemperature(value: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'string') return '未提供';
  const text = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return '未提供';
  const n = Number(text);
  return Number.isFinite(n) && n > -90 ? `${n.toFixed(1)}°C` : '未提供';
}

// Classify the actual CWA description, in severity order. Numeric codes alone
// are deliberately not interpreted without a verified code-table contract.
export function weatherSymbol(description: unknown, night = false): string {
  const text = typeof description === 'string' ? description.trim() : '';
  if (/雷|閃電/.test(text)) return '⛈️';
  if (/雪|冰雹|霰/.test(text)) return '❄️';
  if (/雨/.test(text)) return !night && /晴/.test(text) ? '🌦️' : '🌧️';
  if (/霧|霾/.test(text)) return '🌫️';
  if (/陰/.test(text)) return '☁️';
  if (/雲/.test(text)) return night ? '☁️' : /晴/.test(text) ? '🌤️' : '🌥️';
  if (/晴/.test(text)) return night ? '🌙' : '☀️';
  return '？';
}

export function observationStatus(observedAt: unknown, temperature: unknown, now: number): string {
  if (observationTemperature(temperature) === '未提供') return '觀測值未提供';
  const observed = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
  if (!Number.isFinite(observed) || observed > now + 300_000) return '觀測時間待確認';
  return now - observed > 90 * 60_000 ? '觀測已逾 90 分鐘' : '最近觀測';
}

export function summaryExpired(summary: { stale?: unknown; updatedAt?: unknown } | null, now: number): boolean {
  if (!summary) return false;
  const updated = typeof summary.updatedAt === 'string' ? Date.parse(summary.updatedAt) : NaN;
  return Boolean(summary.stale) || !Number.isFinite(updated) || now - updated >= 600_000;
}

export function weatherTime(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '時間未提供';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

// Display convention only, not a sunrise/sunset calculation.
export function taipeiWeatherNight(now: number): boolean {
  const hour = new Date(now + 8 * 3600000).getUTCHours();
  return hour >= 18 || hour < 6;
}

export type WeatherConditions = { weather?: unknown; weatherCode?: unknown; startsAt?: unknown; endsAt?: unknown; observedWeather?: unknown; observedAt?: unknown };

/** A symbol is always accompanied by its actual source and validity period. */
export function weatherPresentation(row: WeatherConditions, now: number) {
  const observed = typeof row.observedWeather === 'string' ? row.observedWeather.trim() : '';
  const hasObservation = observed !== '' && !/^(?:X|[-+]?\d+(?:\.\d+)?|null|undefined)$/i.test(observed);
  const description = hasObservation ? observed : (typeof row.weather === 'string' ? row.weather.trim() : '');
  const symbol = weatherSymbol(description, taipeiWeatherNight(now));
  const label = hasObservation ? '測站觀測天氣' : '縣市預報';
  const start = typeof row.startsAt === 'string' ? Date.parse(row.startsAt) : NaN;
  const end = typeof row.endsAt === 'string' ? Date.parse(row.endsAt) : NaN;
  const observation = typeof row.observedAt === 'string' ? Date.parse(row.observedAt) : NaN;
  const status = hasObservation
    ? (!Number.isFinite(observation) || observation > now + 300_000 ? '觀測時間待確認' : now - observation > 90 * 60_000 ? '觀測已逾 90 分鐘' : '最近觀測')
    : (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ? '預報時段待確認' : now >= end ? '預報已過期' : now < start ? '預報尚未開始' : '預報有效時段');
  const time = hasObservation ? weatherTime(row.observedAt) : `${weatherTime(row.startsAt)} ～ ${weatherTime(row.endsAt)}`;
  return { symbol, label, description: description || '未提供', time, status: symbol === '？' ? `晴雨資料未提供或無法辨識；${status}` : status,
    stale: status === '觀測已逾 90 分鐘' || status === '預報已過期' };
}
