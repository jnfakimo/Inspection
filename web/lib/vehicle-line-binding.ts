// 公務車個人 LINE 綁定的前端共用邏輯：回應驗證、代碼格式檢查、防連點鎖與錯誤分類。
// 原由 Codex 於 2026-10-08 撰寫（未進 main），2026-10-16 整合；個人設定與派車申請頁兩個入口共用。
export type VehicleLineBindingSnapshot = {
  linked: boolean;
  linked_at: string | null;
  pending_expires_at: string | null;
};

export type VehicleLineLinkIntent = {
  code: string;
  expires_at: string;
};

export type VehicleLineApi = (action: string, payload?: Record<string, unknown>) => Promise<unknown>;

export function createVehicleLineActionLock() {
  let activeLease: symbol | null = null;
  return {
    acquire() {
      if (activeLease) return null;
      activeLease = Symbol('vehicle-line-action');
      return activeLease;
    },
    release(lease: symbol) {
      if (activeLease !== lease) return false;
      activeLease = null;
      return true;
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dataOf(value: unknown): Record<string, unknown> {
  const outer = record(value);
  return Object.keys(record(outer.data)).length ? record(outer.data) : outer;
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export async function readVehicleLineBinding(api: VehicleLineApi): Promise<VehicleLineBindingSnapshot> {
  const data = dataOf(await api('vehicle_line_link_status'));
  if (typeof data.linked !== 'boolean') throw new Error('binding-status-invalid');
  return {
    linked: data.linked,
    linked_at: data.linked ? validTimestamp(data.linked_at) : null,
    pending_expires_at: data.linked ? null : validTimestamp(data.pending_expires_at),
  };
}

export async function startVehicleLineLink(api: VehicleLineApi, consent: boolean): Promise<VehicleLineLinkIntent> {
  if (!consent) throw new Error('line-consent-required');
  const data = dataOf(await api('vehicle_line_link_start', { consent: true }));
  const code = typeof data.code === 'string' ? data.code : '';
  const expiresAt = validTimestamp(data.expires_at);
  if (!/^LINK-[A-Za-z0-9_-]{32}$/.test(code) || !expiresAt) throw new Error('line-link-intent-invalid');
  return { code, expires_at: expiresAt };
}

export async function unlinkVehicleLine(api: VehicleLineApi): Promise<boolean> {
  const data = dataOf(await api('vehicle_line_unlink'));
  if (typeof data.unlinked !== 'boolean') throw new Error('line-unlink-result-invalid');
  return data.unlinked;
}

export async function unlinkVehicleLineAfterConfirmation(
  api: VehicleLineApi,
  confirm: () => boolean,
): Promise<boolean | null> {
  if (!confirm()) return null;
  return unlinkVehicleLine(api);
}

export function vehicleLineUnavailableKind(error: unknown): 'schema' | 'driver' | 'linked' | 'generic' {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/(?:PGRST202|PGRST204|PGRST205|42P01|42883)|LINE.*(?:schema|service).*(?:unavailable|not ready)|LINE.*(?:資料表|服務).*(?:尚未|未就緒)/i.test(message)) return 'schema';
  // app-api 實際回傳「此帳號尚未列入有效駕駛名單。」「此帳號目前不符合駕駛綁定資格。」，兩種寫法都要歸為駕駛資格問題。
  if (/(?:active driver|driver roster|駕駛名冊|駕駛名單|駕駛資格|駕駛綁定資格|駕駛人員)/i.test(message)) return 'driver';
  if (/(?:already linked|已綁定)/i.test(message)) return 'linked';
  return 'generic';
}
