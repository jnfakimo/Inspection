import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
// Execute the real parsers in an isolated runtime with no network or database access.
const source = fs.readFileSync(new URL('../supabase/functions/cwa-weather/index.ts', import.meta.url), 'utf8');
const code = source.replace(/^import .*?;\s*/s, '').split('Deno.serve(')[0];
const context = vm.createContext({ Deno: { env: { get: () => '' } }, createClient: () => new Proxy({}, { get() { throw Error('Database access forbidden'); } }), fetch() { throw Error('Network forbidden'); } });
vm.runInContext(stripTypeScriptTypes(code + '\nglobalThis.parsers = {parseCountyForecast, parseObservations, parseTownForecast, countyWeatherTime};'), context);
const { parseCountyForecast, parseObservations, parseTownForecast, countyWeatherTime } = context.parsers;
test('CWA Wx retains its own validity period and exact description/code', () => {
 const rows = parseCountyForecast({ records: { location: [{ locationName: '臺北市', weatherElement: [
  { elementName: 'Wx', time: [{ startTime: '2099-10-13 12:00:00', endTime: '2099-10-13 18:00:00', parameter: { parameterName: '多雲短暫雨', parameterValue: '08' } }] },
  { elementName: 'MinT', time: [{ startTime: '2099-10-14 12:00:00', endTime: '2099-10-14 18:00:00', parameter: { parameterName: '21' } }] }
 ] }] } });
 const row = rows.get('臺北市');
 assert.equal(row.weather, '多雲短暫雨');assert.equal(row.weatherCode, '08');
 assert.equal(row.startsAt, '2099-10-13T12:00:00+08:00');assert.equal(row.endsAt, '2099-10-13T18:00:00+08:00');
 assert.equal(row.minTemperature, 21);assert.equal(row.temperature, undefined);
 assert.equal(countyWeatherTime('X'), null);
});
test('observation weather and temperature share the selected station/time, without overriding forecast', () => {
 const station = (name, altitude, temp, weather) => ({ StationName: name, GeoInfo: { CountyName: '臺北市', StationAltitude: altitude }, ObsTime: { DateTime: '2026-10-13T14:00:00+08:00' }, WeatherElement: { AirTemperature: temp, Weather: weather } });
 const parsed = parseObservations({ records: { Station: [station('臺北', 6, 0, '晴'), station('山區', 500, -3.5, '雨')] } }).get('臺北市');
 assert.equal(parsed.temperature, 0);assert.equal(parsed.observedWeather, '晴');assert.equal(parsed.stationName, '臺北');
 assert.equal(parsed.observedAt, '2026-10-13T14:00:00+08:00');assert.equal(parsed.weather, undefined);
 for (const value of ['X', '-99', '', undefined]) {
  const row = parseObservations({ Station: [station('臺北', 6, -3.5, value)] }).get('臺北市');
  assert.equal(row.observedWeather, null);assert.equal(row.temperature, -3.5);
 }
 for (const value of ['X', -99, '']) assert.equal(parseObservations({ Station: [station('臺北', 6, value, '雨')] }).get('臺北市').temperature, null);
});

test('town forecast keeps its existing start-time contract without county-only fields', () => {
 const rows = parseTownForecast({ locations: [{ location: [{ LocationName: '萬華區', WeatherElement: [{ ElementName: '天氣現象', Time: [{ StartTime: '2099-10-13T12:00:00+08:00', EndTime: '2099-10-13T18:00:00+08:00', ElementValue: [{ Weather: '多雲', WeatherCode: '04' }] }] }] }] }] }, '臺北市');
 assert.equal(rows.length, 1);assert.equal(rows[0].weather, '多雲');assert.equal(rows[0].startsAt, '2099-10-13T12:00:00+08:00');
 assert.equal(rows[0].endsAt, undefined);
});
