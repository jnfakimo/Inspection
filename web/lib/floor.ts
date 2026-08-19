// 樓層名稱的正規化、顯示與排序 —— 對應 V1 的 theme.js `canonicalFloor`、
// floor-utils.js `floorLabel`，以及 arealist.html／patrollist.html 的 `floorOrder`。
//
// 抽成共用模組的理由：`floor_order` 會寫進 floor_spaces 與 locations，兩套不同的
// 計算方式混在同一個欄位裡會讓 `.order('floor_order')` 的結果失去意義。V2 先前
// 在 structuremap-workspace.tsx 自行實作了一版 -1/1/2 的編號，與 V1 寫入的
// 99/101/102 不相容；因為當時新增路徑本身是壞的（market_id 錯誤導致外鍵違反），
// 這個不一致從未實際寫入資料庫。

/** 比對與分組用的鍵值：B1F→B1、1→1F、頂樓→RF。顯示文字請改用 floorLabel()。 */
export function canonicalFloor(value: unknown) {
  const raw = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const basement = raw.match(/^B(\d+)F?$/); if (basement) return `B${basement[1]}`;
  if (['RF', 'R', '頂樓', 'PH', 'ROOF'].includes(raw)) return 'RF';
  const above = raw.match(/^(\d+)F?$/); if (above) return `${above[1]}F`;
  return raw;
}

/** 畫面顯示文字。內部鍵值固定用 'RF'，顯示固定用「頂樓」，兩者不要混用。 */
export function floorLabel(canonicalKey: string) {
  return canonicalKey === 'RF' ? '頂樓' : canonicalKey;
}

/** 排序權重，與 V1 一致：B2=98、B1=99、1F=101、2F=102、RF=900、其他=500。 */
export function floorOrder(value: unknown) {
  const key = canonicalFloor(value);
  const basement = key.match(/^B(\d+)$/); if (basement) return 100 - Number(basement[1]);
  if (key === 'RF') return 900;
  const above = key.match(/^(\d+)F$/); if (above) return 100 + Number(above[1]);
  return 500;
}
