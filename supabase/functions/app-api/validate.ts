// app-api 共用的輸入清理與驗證。純函式、沒有外部相依，index.ts 與 handlers/* 共用同一份。

export function text(value: unknown, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

// 嚴格驗證 YYYY-MM-DD 且為真實存在的日期，避免 2026-13-99 這類假格式進 DB。
export function validISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
