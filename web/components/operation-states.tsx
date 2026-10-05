import type { ReactNode } from 'react';

export type OperationTone = 'info' | 'success' | 'warning' | 'error';

/** Shared status message for dashboard and module actions. */
export function OperationNotice({
  children,
  tone = 'info',
  action,
}: {
  children: ReactNode;
  tone?: OperationTone;
  action?: ReactNode;
}) {
  return <div className={`operation-notice operation-notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
    <div>{children}</div>
    {action && <div className="operation-notice__action">{action}</div>}
  </div>;
}

/** A predictable loading or empty state for task focused data panels. */
export function OperationState({
  kind,
  title,
  detail,
  action,
}: {
  kind: 'loading' | 'empty';
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return <div className={`operation-state operation-state--${kind}`} role="status" aria-live="polite">
    <strong>{title}</strong>
    {detail && <p>{detail}</p>}
    {action && <div className="operation-state__action">{action}</div>}
  </div>;
}
