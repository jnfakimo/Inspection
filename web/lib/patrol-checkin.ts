export type PatrolCheckinResult = {
  duplicate?: boolean;
  event?: { checkin_at?: string | null } | null;
};

const taipeiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function formatTaipeiCheckinAt(value: unknown, includeDate = true) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '時間待確認';
  const parts = Object.fromEntries(taipeiFormatter.formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  return includeDate ? `${parts.year}-${parts.month}-${parts.day} ${time}` : time;
}

export function patrolCheckinConfirmation(label: string, result: PatrolCheckinResult) {
  const time = formatTaipeiCheckinAt(result.event?.checkin_at);
  return result.duplicate
    ? `「${label}」已於 ${time} 完成打卡，本次未重複建立紀錄`
    : `已完成「${label}」打卡｜打卡時間 ${time}`;
}
