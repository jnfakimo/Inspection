type MetricTone = 'cyan' | 'green' | 'amber' | 'violet' | 'red';

export function MetricCard({ label, value, unit, tone = 'cyan', hint }: { label: string; value: number | string; unit?: string; tone?: MetricTone; hint?: string }) {
  return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{value}<small>{unit}</small></strong>{hint && <p>{hint}</p>}</article>;
}
