import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const widget = readFileSync(new URL('../app/weather-widget.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/weather-widget-layout.css', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../app/dashboard-client.tsx', import.meta.url), 'utf8');

test('Taiwan map stays left of the county and township drilldown on desktop', () => {
  const mapPosition = widget.indexOf('<section className="weather-map-panel"');
  const infoPosition = widget.indexOf('<div className="weather-info-container">');
  assert.ok(mapPosition >= 0 && infoPosition > mapPosition, 'map markup must precede drilldown markup');
  assert.match(layout, /\.weather-map-panel\{grid-column:1;grid-row:1/);
  assert.match(layout, /\.weather-info-container\{grid-column:2;grid-row:1/);
});

test('township drilldown is collapsed by default', () => {
  const details = widget.match(/<details\b[^>]*className="weather-town-details"[^>]*>/);
  assert.ok(details, 'township details element must exist');
  assert.doesNotMatch(details[0], /\sopen(?:\s|=|>)/, 'township details must not have the open attribute');
});

test('narrow layouts place the map before the drilldown', () => {
  const start = layout.indexOf('@media(max-width:900px)');
  const end = layout.indexOf('@media(max-width:640px)', start);
  assert.ok(start >= 0 && end > start, '900px stacking breakpoint must exist');
  const narrow = layout.slice(start, end);
  assert.match(narrow, /\.weather-widget\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(narrow, /\.weather-map-panel\{grid-column:1;grid-row:1\}/);
  assert.match(narrow, /\.weather-info-container\{grid-column:1;grid-row:2\}/);
});

test('the weather layout override is loaded after the dashboard stylesheet', () => {
  assert.match(dashboard, /import ['"]\.\/dashboard\.css['"];[\s\S]*import ['"]\.\/weather-widget-layout\.css['"]/);
});
