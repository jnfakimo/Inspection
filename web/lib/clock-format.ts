/**
 * 上下午 12 小時制的時間文字。內部資料一律維持 24 小時制的 `HH:mm`，這裡只負責「顯示」。
 *
 * 公務車派車管理系統依使用者要求，時間欄位與畫面顯示都用「上午／下午」：
 *   00:00 → 上午 12:00　　09:30 → 上午 9:30　　12:00 → 下午 12:00　　13:30 → 下午 1:30
 * 其他系統的時間欄位仍是 24 小時制（見 AGENTS.md），所以共用元件以 hour12 選項開啟，預設不變。
 */
export function formatClock12(hour: number, minute: number | string, second?: number | string): string {
  const h24 = ((Math.floor(hour) % 24) + 24) % 24;
  const period = h24 < 12 ? '上午' : '下午';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(minute).padStart(2, '0');
  const ss = second === undefined || second === '' ? '' : `:${String(second).padStart(2, '0')}`;
  return `${period} ${h12}:${mm}${ss}`;
}

/** `HH:mm`（或 `HH:mm:ss`）轉成上下午文字；格式不符時原樣回傳。 */
export function hhmmTo12(value: string): string {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return String(value ?? '');
  return formatClock12(Number(match[1]), match[2], match[3]);
}

/** `YYYY-MM-DD HH:mm[:ss]` 轉成 `YYYY-MM-DD 上午 h:mm[:ss]`；格式不符時原樣回傳。 */
export function dateTimeTo12(value: string): string {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return String(value ?? '');
  return `${match[1]} ${formatClock12(Number(match[2]), match[3], match[4])}`;
}
