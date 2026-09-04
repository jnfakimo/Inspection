import { marketMovementPresentation } from '@/lib/market-movement';

export function MarketMovementBadge({ value, className = '' }: { value: unknown; className?: string }) {
  const movement = marketMovementPresentation(value);
  const classes = ['market-movement-badge', movement.tone, className].filter(Boolean).join(' ');
  return <span className={classes} aria-label={movement.ariaLabel}>
    {movement.symbol && <span className="market-movement-glyph" aria-hidden="true">{movement.symbol}</span>}
    <span>{movement.label}{movement.percentText ? ` ${movement.percentText}` : ''}</span>
  </span>;
}
