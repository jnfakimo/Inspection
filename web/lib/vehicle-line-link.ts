// 個人設定「LINE 派車通知」區塊的顯示邏輯（純函式，便於單元測試）。

export type VehicleLineLinkStatus = {
  linked: boolean;
  linked_at: string | null;
  pending_expires_at: string | null;
};

export type VehicleLineLinkState = 'loading' | 'linked' | 'pending' | 'expired' | 'unlinked';

export type VehicleLineLinkView = {
  state: VehicleLineLinkState;
  title: string;
  detail: string;
  remaining: string;
};

const TAIPEI_TIME = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} 分 ${String(rest).padStart(2, '0')} 秒` : `${rest} 秒`;
}

export function vehicleLineLinkView(
  status: VehicleLineLinkStatus | null,
  code: { value: string; expiresAt: string } | null,
  now: number,
): VehicleLineLinkView {
  if (!status) return { state: 'loading', title: '讀取中', detail: '正在確認 LINE 綁定狀態…', remaining: '' };
  if (status.linked) {
    const at = status.linked_at && Number.isFinite(Date.parse(status.linked_at))
      ? TAIPEI_TIME.format(new Date(status.linked_at)).replace(/\s+/g, ' ') : '';
    return {
      state: 'linked',
      title: '已綁定',
      detail: at ? `綁定時間 ${at}；指派或取消指派時會收到個人通知（需管理員啟用）。` : '指派或取消指派時會收到個人通知（需管理員啟用）。',
      remaining: '',
    };
  }
  // 代碼只在產生當下顯示一次；重新整理後伺服器只回傳仍在等待中，不再回傳代碼本身。
  const expiresAt = code ? Date.parse(code.expiresAt) : NaN;
  if (code && Number.isFinite(expiresAt)) {
    if (expiresAt > now) {
      return { state: 'pending', title: '等待 LINE 完成綁定', detail: '請依下方步驟在 LINE 完成綁定。', remaining: formatRemaining(expiresAt - now) };
    }
    return { state: 'expired', title: '綁定代碼已失效', detail: '代碼超過 10 分鐘未使用，請重新產生。', remaining: '' };
  }
  if (status.pending_expires_at && Date.parse(status.pending_expires_at) > now) {
    return { state: 'expired', title: '尚有未完成的綁定', detail: '基於安全，代碼不會重複顯示；請重新產生新的代碼。', remaining: '' };
  }
  return { state: 'unlinked', title: '尚未綁定', detail: '綁定後才會收到個人派車通知；群組通知不受影響。', remaining: '' };
}
