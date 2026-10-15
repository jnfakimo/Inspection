export function normalizeLocalizedDate(value: string): string | null {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})([-/])(\d{2})\2(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  if (year < 1 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > monthDays[month - 1]) return null;
  return match[1] + '-' + match[3] + '-' + match[4];
}

export function formatLocalizedDate(value: string): string {
  const normalized = normalizeLocalizedDate(value);
  return normalized ? normalized.replaceAll('-', '/') : '';
}

export function validateLocalizedDate(value: string, options: {
  required?: boolean;
  min?: string;
  max?: string;
} = {}): 'required' | 'invalid' | 'min' | 'max' | null {
  const normalized = normalizeLocalizedDate(value);
  if (normalized === '') return options.required ? 'required' : null;
  if (!normalized) return 'invalid';
  const min = options.min ? normalizeLocalizedDate(options.min) : '';
  const max = options.max ? normalizeLocalizedDate(options.max) : '';
  if (min && normalized < min) return 'min';
  if (max && normalized > max) return 'max';
  return null;
}

export function localizedDateDraftForUpdate(
  controlledValue: string,
  previousControlledValue: string,
  currentDraft: string | null,
): string | null {
  return controlledValue === previousControlledValue ? currentDraft : null;
}