/**
 * 場域位置（locations）的共用顯示與選項組裝。
 *
 * 巡檢與報修建立時要綁 location_id，位置分析頁才有資料來源；三處表單的顯示規則
 * 必須一致，否則同一個位置在不同頁會長得不一樣。
 */

export type LocationLike = {
  location_id?: unknown;
  floor?: unknown;
  area?: unknown;
  detail?: unknown;
  // PostgREST 的關聯查詢依關係型態回物件或陣列，兩種都要吃。
  markets?: unknown;
};

const marketName = (row: LocationLike) => {
  const raw = Array.isArray(row.markets) ? row.markets[0] : row.markets;
  const name = raw && typeof raw === 'object' ? (raw as { name?: unknown }).name : null;
  return String(name ?? '').trim();
};

/** 市場／樓層／區域／細部位置，空的段落略過。 */
export function locationLabel(row: LocationLike) {
  const parts = [marketName(row), row.floor, row.area, row.detail]
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
  return parts.join('／') || '未命名位置';
}

export function locationOptions(rows: LocationLike[]) {
  return rows
    .filter(row => row.location_id)
    .map(row => ({ value: String(row.location_id), label: locationLabel(row) }));
}
