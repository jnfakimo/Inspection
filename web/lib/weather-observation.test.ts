import assert from 'node:assert/strict';
import test from 'node:test';
import { WEATHER_COUNTIES, observationTemperature, observationStatus, summaryExpired, weatherSymbol, taipeiWeatherNight, weatherPresentation } from './weather-observation.ts';

test('Taipei night convention never displays a sun for clear or partly rainy descriptions', () => {
  assert.equal(taipeiWeatherNight(Date.parse('2026-10-13T17:59:00+08:00')), false);
  assert.equal(taipeiWeatherNight(Date.parse('2026-10-13T18:00:00+08:00')), true);
  assert.equal(taipeiWeatherNight(Date.parse('2026-10-14T05:59:00+08:00')), true);
  assert.equal(taipeiWeatherNight(Date.parse('2026-10-14T06:00:00+08:00')), false);
  assert.equal(weatherSymbol('晴天', true), '🌙');
  assert.equal(weatherSymbol('晴時多雲', true), '☁️');
  assert.equal(weatherSymbol('多雲', true), '☁️');
  assert.equal(weatherSymbol('晴時多雲短暫雨', true), '🌧️');
  assert.equal(weatherSymbol('雷陣雨', true), '⛈️');
  assert.equal(weatherSymbol(undefined, true), '？');
});

test('observations retain zero and negative values; reject CWA missing sentinels', () => {
  for (const value of [null, undefined, '', ' ', 'X', -99, '-99', -999, NaN, Infinity, true, [], {}]) {
    assert.equal(observationTemperature(value), '未提供', String(value));
  }
  assert.equal(observationTemperature(0), '0.0°C');
  assert.equal(observationTemperature(-3.5), '-3.5°C');
  assert.equal(observationTemperature('31.4'), '31.4°C');
});

test('actual descriptions distinguish sun, rain and hazardous weather; unknown is never sunny', () => {
  for (const [text, symbol] of [['晴天','☀️'], ['多雲時晴','🌤️'], ['陰天','☁️'], ['多雲','🌥️'], ['陰短暫雨','🌧️'], ['晴午後短暫雷陣雨','⛈️'], ['晴時多雲短暫雨','🌦️'], ['陰有雪','❄️'], ['晴有霧','🌫️']]) {
    assert.equal(weatherSymbol(text), symbol);
  }
  for (const text of [null, undefined, '', 'X', '99', '未提供']) assert.equal(weatherSymbol(text), '？');
});

test('a stale cache and an old or unknown observation remain explicitly different states', () => {
  const time = Date.parse('2026-10-13T06:13:57Z');
  assert.equal(summaryExpired({ updatedAt: '2026-10-13T06:13:57Z' }, time), false);
  assert.equal(summaryExpired({ updatedAt: '2026-10-13T06:13:57Z' }, time + 600_000), true);
  assert.equal(summaryExpired({ updatedAt: '2026-10-13T06:13:57Z', stale: true }, time), true);
  assert.equal(summaryExpired({}, time), true);
  assert.equal(observationStatus('2026-10-13T14:00:00+08:00', 0, time), '最近觀測');
  assert.equal(observationStatus('2026-10-13T14:00:00+08:00', 25.4, time + 90 * 60_000), '觀測已逾 90 分鐘');
  assert.equal(observationStatus(null, 25.4, time), '觀測時間待確認');
  assert.equal(observationStatus('2026-10-13T14:00:00+08:00', -99, time), '觀測值未提供');
});

test('all 22 named counties are available independently of the 19 map markers', () => {
  assert.equal(WEATHER_COUNTIES.length, 22);
  assert.equal(new Set(WEATHER_COUNTIES).size, 22);
  for (const county of ['南投縣','澎湖縣','金門縣','連江縣']) assert.ok(WEATHER_COUNTIES.includes(county));
});

test('weather presentation distinguishes station observation, forecast period and missing legacy fields', () => {
  const now = Date.parse('2026-10-13T14:00:00+08:00');
  const forecast = { weather: '晴天', startsAt: '2026-10-13T12:00:00+08:00', endsAt: '2026-10-13T18:00:00+08:00' };
  assert.equal(weatherPresentation(forecast, now).status, '預報有效時段');
  const observed = weatherPresentation({ ...forecast, observedWeather: '雨', observedAt: '2026-10-13T13:50:00+08:00' }, now);
  assert.equal(observed.symbol, '🌧️');
  assert.equal(observed.label, '測站觀測天氣');
  assert.equal(observed.time, '2026-10-13 13:50');
  assert.equal(observed.status, '最近觀測');
  assert.equal(weatherPresentation(forecast, now + 4 * 3600000).stale, true);
  assert.equal(weatherPresentation(forecast, now - 3 * 3600000).status, '預報尚未開始');
  assert.equal(weatherPresentation({ weather: '晴天' }, now).status, '預報時段待確認');
  assert.equal(weatherPresentation({}, now).symbol, '？');
  assert.match(weatherPresentation({}, now).status, /晴雨資料未提供/);
  for (const invalid of ['X', '-99', ' ', null]) {
    assert.equal(weatherPresentation({ ...forecast, observedWeather: invalid }, now).label, '縣市預報');
  }
  assert.equal(weatherPresentation({ observedWeather: '晴', observedAt: '2026-10-13T10:00:00+08:00' }, now).stale, true);
});
