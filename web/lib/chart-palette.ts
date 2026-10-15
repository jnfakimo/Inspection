// 圖表與資料視覺化色盤的唯一正本（2026-10-15）。
// Chart.js、canvas 與地圖 API 不吃 CSS 變數，所以實際色值集中在這裡；
// 介面元件的顏色一律走 web/app/tokens.css，不要在這裡加 UI 色。
// tools/color-token-check.mjs 只允許這支與少數圖面檔案直接寫色碼。

/** 一般圖表的系列色（一般版主色系，依序取用）。 */
export const CHART_SERIES = ['#0284c7', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777'] as const;

/** 戰情首頁科技風圖表的系列色（霓虹色系）。 */
export const CHART_SERIES_NEON = ['#00d4ff', '#00ff9d', '#ffb300', '#ff3b3b', '#a855f7', '#3b82f6', '#ec4899', '#f97316'] as const;

/** 讀不到 CSS 變數時（SSR、尚未掛上樣式）的一般版備援值。 */
export const CHART_FALLBACK = {
  text: '#172033',
  dim: '#64748b',
  line: '#cbd5e1',
  panel: '#ffffff',
  cyan: '#0284c7',
  green: '#059669',
  amber: '#d97706',
  violet: '#7c3aed',
  red: '#dc2626',
} as const;

/** 讀不到 CSS 變數時的科技版備援值（深色看板使用）。 */
export const CHART_FALLBACK_TECH = {
  dim: '#7893aa',
  line: '#173952',
  cyan: '#00d4ff',
  amber: '#ffb300',
} as const;

/** 主題 token 名稱對應的備援色，供「以 token 名稱指定系列色」的設定使用。 */
export const CHART_TOKEN_FALLBACK: Record<string, string> = {
  '--cyan': CHART_FALLBACK.cyan,
  '--green': CHART_FALLBACK.green,
  '--amber': CHART_FALLBACK.amber,
  '--violet': CHART_FALLBACK.violet,
  '--red': CHART_FALLBACK.red,
};

/** 行情分析工作台可選的色盤；以 `--` 開頭的值會在執行時讀取主題 token。 */
export const MARKET_PALETTE_PRESETS = [
  { id: 'market', label: '市場藍綠', colors: ['--cyan', '--green', '--amber', '--violet', '--red', '#0891b2'] },
  { id: 'produce', label: '蔬果鮮彩', colors: ['#15803d', '#0d9488', '#65a30d', '#f59e0b', '#ea580c', '#db2777'] },
  { id: 'cool', label: '冷色專業', colors: ['#0369a1', '#2563eb', '#4f46e5', '#7c3aed', '#0f766e', '#0891b2'] },
  { id: 'warm', label: '暖色行情', colors: ['#b45309', '#ea580c', '#d97706', '#dc2626', '#be123c', '#9333ea'] },
  { id: 'accessible', label: '高對比友善', colors: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#d55e00', '#56b4e9'] },
];

/** 行情分析工作台「自訂色盤」的預設值。 */
export const MARKET_DEFAULT_CUSTOM_COLORS: string[] = CHART_SERIES.slice(0, 6);
