/** Display-only normalization; never changes the source event or alert decisions. */
const SEVERITY = {
  info: { label: '一般', tone: 'pending' },
  warning: { label: '警告', tone: 'in-progress' },
  critical: { label: '嚴重', tone: 'cancelled' },
} as const;
const UNKNOWN_SEVERITY = { label: '未知', tone: 'pending' } as const;

export function equipmentSeverity(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(SEVERITY, value)
    ? SEVERITY[value as keyof typeof SEVERITY]
    : UNKNOWN_SEVERITY;
}
