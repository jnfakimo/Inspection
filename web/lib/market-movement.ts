export type MarketMovementTone = 'rise' | 'fall' | 'steady' | 'neutral';

export type MarketMovementPresentation = {
  tone: MarketMovementTone;
  symbol: '▲' | '▼' | '—' | '';
  label: '上漲' | '下跌' | '持平' | '無比較基準';
  percentText: string;
  text: string;
  ariaLabel: string;
};

export function marketMovementPresentation(value: unknown, precision = 1): MarketMovementPresentation {
  const numeric = value === null || value === undefined || value === '' ? null : Number(value);
  if (numeric === null || !Number.isFinite(numeric)) {
    return { tone: 'neutral', symbol: '', label: '無比較基準', percentText: '', text: '無比較基準', ariaLabel: '無比較基準' };
  }
  if (Math.abs(numeric) < .05) {
    const percentText = `${(0).toFixed(precision)}%`;
    return { tone: 'steady', symbol: '—', label: '持平', percentText, text: `— 持平 ${percentText}`, ariaLabel: `持平 ${percentText}` };
  }
  const rise = numeric > 0;
  const symbol = rise ? '▲' : '▼';
  const label = rise ? '上漲' : '下跌';
  const percentText = `${Math.abs(numeric).toFixed(precision)}%`;
  return { tone: rise ? 'rise' : 'fall', symbol, label, percentText, text: `${symbol} ${label} ${percentText}`, ariaLabel: `${label} ${percentText}` };
}
