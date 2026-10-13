import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { WEATHER_MAP_V3_BADGE_RADIUS, WEATHER_MAP_V3_CANVAS, WEATHER_MAP_V3_MARKERS, WEATHER_MAP_V3_TEMPERATURE_LABEL_OFFSET_Y, projectCountySvgPointToWeatherMap } from './weather-map-v3.ts';

const expectedMarkers = [
  ['weather-01', 388.52, 94.35, '新北市'],
  ['weather-02', 461.82, 82.32, '臺北市'],
  ['weather-03', 328.19, 129.36, '桃園市'],
  ['weather-04', 534.37, 123.29, '基隆市'],
  ['weather-05', 278.25, 186.15, '新竹市'],
  ['weather-06', 240.23, 240.25, '苗栗縣'],
  ['weather-07', 201.63, 302.73, '臺中市'],
  ['weather-08', 156.75, 380, '彰化縣'],
  ['weather-09', 126.17, 442.69, '雲林縣'],
  ['weather-10', 120.09, 507.25, '嘉義市'],
  ['weather-11', 132.98, 638.16, '臺南市'],
  ['weather-12', 160.61, 718.78, '高雄市'],
  ['weather-13', 226.42, 800.84, '屏東縣'],
  ['weather-14', 518.99, 320.48, '新竹縣'],
  ['weather-15', 325, 432, '南投縣'],
  ['weather-16', 104.24, 571.38, '嘉義縣'],
  ['weather-17', 554.82, 207.14, '宜蘭縣'],
  ['weather-18', 479.85, 453.68, '花蓮縣'],
  ['weather-19', 370.14, 707.43, '臺東縣'],
] as const;
const markers = readFileSync(new URL('../app/weather-map-markers.tsx', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../app/weather-widget.tsx', import.meta.url), 'utf8');
const sourceSvg = readFileSync(new URL('../public/taiwan-counties.svg', import.meta.url));
const mapLayer = readFileSync(new URL('../public/taiwan-weather-map-layer.png', import.meta.url));
const iconsLayer = readFileSync(new URL('../public/taiwan-weather-icons-layer.png', import.meta.url));

// Preserve the local Blender verification when its untracked design bundle exists.
const localValidation = new URL('../../design/taiwan-weather-blender/weather-layers-scene-validation.json', import.meta.url);
test('local Blender export retains transparent aligned layers without baked temperature text', { skip: !existsSync(localValidation) }, () => {
  const layer = JSON.parse(readFileSync(localValidation, 'utf8'));
  assert.equal(layer.film_transparent, true);
  assert.equal(layer.image_channels, 'RGBA');
  assert.equal(layer.anchor_count, 19);
  assert.equal(layer.max_anchor_error_px, 0);
  assert.deepEqual(layer.layers.map((x: { filename: string }) => x.filename), ['taiwan-weather-map-layer.png', 'taiwan-weather-icons-layer.png']);
  assert.ok(!layer.layers.find((x: { layer: string }) => x.layer === 'icons').visible_objects.some((name: string) => /temperature|text label/i.test(name)));
});

test('V3 marker anchors and all 19 CWA county mappings match the approved values', () => {
  assert.deepEqual(WEATHER_MAP_V3_CANVAS, { width: 619, height: 847 });
  assert.equal(WEATHER_MAP_V3_MARKERS.length, 19);
  assert.equal(WEATHER_MAP_V3_BADGE_RADIUS, 31.5);
  assert.equal(WEATHER_MAP_V3_TEMPERATURE_LABEL_OFFSET_Y, 19);
  assert.deepEqual(WEATHER_MAP_V3_MARKERS.map(({ id, x, y, county }) => [id, x, y, county]), expectedMarkers);
  assert.equal(new Set(WEATHER_MAP_V3_MARKERS.map(marker => marker.county)).size, 19);
});

test('Blender V4 layers are 619x847 RGBA PNGs', () => {
  for (const [name, image] of [['map', mapLayer], ['icons', iconsLayer]] as const) {
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} PNG signature`);
    assert.equal(image.readUInt32BE(16), WEATHER_MAP_V3_CANVAS.width, `${name} width`);
    assert.equal(image.readUInt32BE(20), WEATHER_MAP_V3_CANVAS.height, `${name} height`);
    assert.equal(image[25], 6, `${name} PNG must have an RGBA color type`);
  }
});

test('approved Blender V4 map layer matches the final asset SHA', () => {
  assert.equal(createHash('sha256').update(mapLayer).digest('hex'), '019b1fc6ee5f4cbabbf20ce9188987314dbeca4f01a5b1c86cb1ed2d6076caaf');
});

test('approved Blender V4 icons layer remains unchanged', () => {
  assert.equal(createHash('sha256').update(iconsLayer).digest('hex'), '9b5541ff8580207287aef006d54f30bb077b40526feda6811ad87c1dcc7c809d');
});

test('source county SVG is the approved asset used to build the V3 map', () => {
  const normalizedSvg = sourceSvg.toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(normalizedSvg).digest('hex'), '0217081eeb4c334e49a2f0bc4236dfc7c8ff1658124c8865c3af1773bfd98ac1');
});

test('county affine transform reaches the approved V3 mainland bounds', () => {
  for (const [x, y, expectedX, expectedY] of [[295.2, 242.2, 145, 119], [581.6, 734.5, 520, 834]]) {
    const [actualX, actualY] = projectCountySvgPointToWeatherMap(x, y);
    assert.ok(Math.abs(actualX - expectedX) < 1e-9);
    assert.ok(Math.abs(actualY - expectedY) < 1e-9);
  }
});

test('all 19 badge circles remain within the transparent map canvas', () => {
  for (const marker of WEATHER_MAP_V3_MARKERS) {
    assert.ok(marker.x >= WEATHER_MAP_V3_BADGE_RADIUS && marker.x <= WEATHER_MAP_V3_CANVAS.width - WEATHER_MAP_V3_BADGE_RADIUS, marker.id);
    assert.ok(marker.y >= WEATHER_MAP_V3_BADGE_RADIUS && marker.y <= WEATHER_MAP_V3_CANVAS.height - WEATHER_MAP_V3_BADGE_RADIUS, marker.id);
  }
});

test('widget uses approved map geometry with named data-driven markers', () => {
  assert.ok(widget.includes('viewBox={WEATHER_MAP_V3_VIEWBOX}'));
  assert.ok(widget.includes('WEATHER_MAP_V3_MAP_MATRIX.join'));
  assert.ok(markers.includes('WEATHER_MAP_V3_MARKERS.map'));
  assert.ok(markers.includes('y={WEATHER_MAP_V3_TEMPERATURE_LABEL_OFFSET_Y}'));
  assert.ok(widget.includes('href="/Inspection/v2/taiwan-weather-map-layer.png"'));
  assert.ok(!widget.includes('href="/Inspection/v2/taiwan-weather-icons-layer.png"'));
  assert.ok(markers.includes('weatherPresentation(data, now)'));
  assert.ok(widget.indexOf('taiwan-weather-map-layer.png') < widget.indexOf('weather-county-hit-layer'));
  assert.ok(widget.indexOf('weather-county-hit-layer') < widget.indexOf('<WeatherMapMarkers'));
  assert.ok(widget.includes('圖示優先顯示測站觀測天氣'));
  assert.ok(markers.includes('weather-marker-county'));
  assert.ok(markers.includes('observationTemperature(data.temperature)'));
  assert.ok(!widget.includes('taiwan-weather-preview.png'));
  const details = widget.match(/<details\b[^>]*className="weather-town-details"[^>]*>/);
  assert.ok(details);
  assert.ok(!/\sopen(?:\s|=|>)/.test(details[0]));
});
