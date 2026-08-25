/**
 * 樓層代碼的單一正規化規則。
 *
 * 資料庫歷史資料可能使用 B1F、1、頂樓等寫法，API 對外一律以
 * B1、1F、RF 作為比對／分組鍵值；顯示文字由前端另外轉成「頂樓」。
 */
export function canonicalFloor(value: unknown): string {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[樓層]/g, '');
  if (!raw) return '';

  const basementText = raw.match(/^地下(\d+)$/);
  if (basementText) return `B${Number(basementText[1])}`;
  const basement = raw.match(/^B(\d+)F?$/);
  if (basement) return `B${Number(basement[1])}`;
  if (['RF', 'R', 'PH', 'ROOF', '頂', '屋頂'].includes(raw) || /^RF/.test(raw)) return 'RF';

  const above = raw.match(/^(\d+)F?$/);
  if (above) return `${Number(above[1])}F`;
  return raw;
}

export function floorOrder(value: unknown): number {
  const key = canonicalFloor(value);
  const basement = key.match(/^B(\d+)$/);
  if (basement) return 100 - Number(basement[1]);
  if (key === 'RF') return 900;
  const above = key.match(/^(\d+)F$/);
  if (above) return 100 + Number(above[1]);
  return 500;
}
