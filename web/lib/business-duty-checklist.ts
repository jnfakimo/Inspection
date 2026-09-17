export type DutyItem = {
  id: string;
  timeSlot: string;
  timeSlotLabel: string;
  shiftGroup: '01-09' | '09-17' | '17-01';
  title: string;
  createdAt?: string;
  createdBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type DutyState = {
  status: 'completed' | 'uncompleted';
  updatedAt?: string;
  updatedBy?: string;
};

export type DutyStates = Record<string, DutyState>;

export type DutyChecklistData = {
  items: DutyItem[];
  checks: DutyStates;
};

export const TIME_SLOT_DEFS = [
  { code: '00-08', label: '00:00 ～ 08:00', shiftName: '早班時段', shiftCode: '01-09' as const },
  { code: '01-09', label: '01:00 ～ 09:00', shiftName: '早班時段', shiftCode: '01-09' as const },
  { code: '02-10', label: '02:00 ～ 10:00', shiftName: '早班時段', shiftCode: '01-09' as const },
  { code: '03-11', label: '03:00 ～ 11:00', shiftName: '早班時段', shiftCode: '01-09' as const },
  { code: '08-17', label: '08:00 ～ 17:00', shiftName: '中班時段', shiftCode: '09-17' as const },
  { code: '09-17', label: '09:00 ～ 17:00', shiftName: '中班時段', shiftCode: '09-17' as const },
  { code: '17-01', label: '17:00 ～ 01:00', shiftName: '晚班時段', shiftCode: '17-01' as const },
] as const;

export function getTimeSlotLabel(slotCode: string): string {
  const found = TIME_SLOT_DEFS.find(s => s.code === slotCode);
  return found ? found.label : slotCode;
}

export function getTimeSlotShiftGroup(slotCode: string): '01-09' | '09-17' | '17-01' {
  const found = TIME_SLOT_DEFS.find(s => s.code === slotCode);
  return found ? found.shiftCode : (slotCode === '17-01' ? '17-01' : slotCode === '08-17' || slotCode === '09-17' ? '09-17' : '01-09');
}

export const DEFAULT_BUSINESS_DUTY_CHECKLIST: DutyItem[] = [
  // ── 00:00 ～ 08:00 ──
  {
    id: 'duty-00-08-1',
    timeSlot: '00-08',
    timeSlotLabel: '00:00 ～ 08:00',
    shiftGroup: '01-09',
    title: '蔬菜議價查驗與點件及臨時交辦事項。',
  },
  {
    id: 'duty-00-08-2',
    timeSlot: '00-08',
    timeSlotLabel: '00:00 ～ 08:00',
    shiftGroup: '01-09',
    title: '水果議價查驗與點件及臨時交辦事項。',
  },
  {
    id: 'duty-00-08-3',
    timeSlot: '00-08',
    timeSlotLabel: '00:00 ～ 08:00',
    shiftGroup: '01-09',
    title: '預備組（代班）蔬、果議價查驗與點件及臨時交辦事項。',
  },
  {
    id: 'duty-00-08-4',
    timeSlot: '00-08',
    timeSlotLabel: '00:00 ～ 08:00',
    shiftGroup: '01-09',
    title: '前門地磅、卸貨碼頭、拍賣場、零批場等蔬果查驗、點件。',
  },

  // ── 01:00 ～ 09:00 ──
  {
    id: 'duty-01-09-1',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '前門早班地磅進貨管理、門禁管制，支援議價蔬果查驗點件、芽菜檢驗及臨時交辦事項。（休市日負責清理擦拭入口停車設備及地面）。',
  },
  {
    id: 'duty-01-09-2',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '早班停車收費管理（休市日負責清理擦拭出口停車設備及地面）。',
  },
  {
    id: 'duty-01-09-3',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '預備組（代班）前門地磅進貨管理、門禁管制、停車收費管理及臨時交辦事項。',
  },
  {
    id: 'duty-01-09-4',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '摺疊籃回收整理業務及臨時交辦事項。（一）',
  },
  {
    id: 'duty-01-09-5',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '摺疊籃回收整理業務及臨時交辦事項。（二）',
  },
  {
    id: 'duty-01-09-6',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00 / 02:00 ～ 10:00',
    shiftGroup: '01-09',
    title: '預備組（代班）摺疊籃回收整理業務、冷藏庫倉儲業務及臨時交辦事項。',
  },

  // ── 02:00 ～ 10:00 ──
  {
    id: 'duty-02-10-1',
    timeSlot: '02-10',
    timeSlotLabel: '02:00 ～ 10:00',
    shiftGroup: '01-09',
    title: '冷藏庫倉儲業務、管理 B1 車輛巡查、環境維持及突發狀況之回報，08 至 09 執行取締零批場越線擺貨。',
  },

  // ── 03:00 ～ 11:00 ──
  {
    id: 'duty-03-11-1',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '蔬果零批場管理及臨時交辦事項。',
  },
  {
    id: 'duty-03-11-2',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '蔬果零批場管理及臨時交辦事項。',
  },
  {
    id: 'duty-03-11-3',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '預備組（代班）蔬果零批場管理、環境維持及突發狀況之回報。',
  },
  {
    id: 'duty-03-11-4',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '蔬果零批場通道暢通、取締越線擺貨、停車秩序管理、場內環境整潔、電動車輛充電管制及突發狀況回報。',
  },

  // ── 08:00 ～ 17:00 ──
  {
    id: 'duty-08-17-1',
    timeSlot: '08-17',
    timeSlotLabel: '08:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '負責零批場各走道之管理與清潔監督、公廁設備巡查維護及公物保管。',
  },
  {
    id: 'duty-08-17-2',
    timeSlot: '08-17',
    timeSlotLabel: '08:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '負責冷藏庫出入庫管理、溫度紀錄巡查、庫內通道清潔與維護作業。',
  },
  {
    id: 'duty-08-17-3',
    timeSlot: '08-17',
    timeSlotLabel: '08:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '前門地磅日班維護與進出管制支援作業。',
  },

  // ── 09:00 ～ 17:00 ──
  {
    id: 'duty-09-17-1',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '蔬、果零批場、冷藏庫、場區周邊等管理業務及臨時交辦事項。',
  },
  {
    id: 'duty-09-17-2',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '前門中班地磅進貨管理、門禁管制及臨時交辦事項。',
  },
  {
    id: 'duty-09-17-3',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '預備組（代班）前門地磅進貨管理、門禁管制、停車收費管理及臨時交辦事項。',
  },
  {
    id: 'duty-09-17-4',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '地下三樓中班停車收費管理。',
  },
  {
    id: 'duty-09-17-5',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '中班停車收費管理。',
  },
  {
    id: 'duty-09-17-6',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '預備組（代班）停車收費管理。',
  },

  // ── 17:00 ～ 01:00 ──
  {
    id: 'duty-17-01-1',
    timeSlot: '17-01',
    timeSlotLabel: '17:00 ～ 01:00',
    shiftGroup: '17-01',
    title: '前門晚班地磅進貨管理、門禁管制及臨時交辦事項。',
  },
  {
    id: 'duty-17-01-2',
    timeSlot: '17-01',
    timeSlotLabel: '17:00 ～ 01:00',
    shiftGroup: '17-01',
    title: '晚班停車收費管理。',
  },
  {
    id: 'duty-17-01-3',
    timeSlot: '17-01',
    timeSlotLabel: '17:00 ～ 01:00',
    shiftGroup: '17-01',
    title: '預備組（代班）前門地磅進貨管理、門禁管制、停車收費管理及臨時交辦事項。',
  },
];

const validState = (value: unknown): value is DutyState =>
  Boolean(value) && typeof value === 'object' &&
  (((value as DutyState).status === 'completed') || ((value as DutyState).status === 'uncompleted'));

export function sanitizeDutyItem(item: unknown): DutyItem | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Partial<DutyItem>;
  if (typeof row.id !== 'string' || !row.id.trim()) return null;
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 500) return null;
  const timeSlot = typeof row.timeSlot === 'string' && row.timeSlot.trim() ? row.timeSlot.trim() : '01-09';
  const timeSlotLabel = typeof row.timeSlotLabel === 'string' && row.timeSlotLabel.trim()
    ? row.timeSlotLabel.trim()
    : getTimeSlotLabel(timeSlot);
  const shiftGroup = row.shiftGroup === '01-09' || row.shiftGroup === '09-17' || row.shiftGroup === '17-01'
    ? row.shiftGroup
    : getTimeSlotShiftGroup(timeSlot);

  return {
    id: row.id.trim(),
    timeSlot,
    timeSlotLabel,
    shiftGroup,
    title: row.title.trim(),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
    createdBy: typeof row.createdBy === 'string' ? row.createdBy : undefined,
    deletedAt: typeof row.deletedAt === 'string' ? row.deletedAt : undefined,
    deletedBy: typeof row.deletedBy === 'string' ? row.deletedBy : undefined,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
    updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : undefined,
  };
}

export function parseDutyChecklist(raw: unknown, defaults: DutyItem[] = DEFAULT_BUSINESS_DUTY_CHECKLIST): DutyChecklistData {
  let source: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw);
    } catch {
      source = {};
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    source = raw as Record<string, unknown>;
  }

  const modern = source.version === 2;
  const rawChecks = modern ? source.checks : source;
  const checks: DutyStates = {};
  if (rawChecks && typeof rawChecks === 'object' && !Array.isArray(rawChecks)) {
    for (const [id, value] of Object.entries(rawChecks)) {
      if (validState(value)) checks[id] = value;
    }
  }

  if (modern && Array.isArray(source.items)) {
    // If source.items is explicitly provided as a list
    const parsedItems = source.items
      .map(sanitizeDutyItem)
      .filter((item): item is DutyItem => Boolean(item));

    // Check if source.items only had custom items and there's a removed map (legacy v2 payload compatibility)
    const hasOnlyCustom = parsedItems.length > 0 && parsedItems.every(i => i.id.startsWith('custom-'));
    if (hasOnlyCustom) {
      const removed = source.removed && typeof source.removed === 'object' && !Array.isArray(source.removed)
        ? source.removed as Record<string, { deletedAt: string; deletedBy: string }> : {};
      const baseItems: DutyItem[] = defaults.map(item => ({ ...item, ...(removed[item.id] || {}) }));
      const items: DutyItem[] = baseItems.concat(parsedItems);
      return { items, checks };
    }

    if (parsedItems.length > 0) {
      return { items: parsedItems, checks };
    }
  }

  const removed = modern && source.removed && typeof source.removed === 'object' && !Array.isArray(source.removed)
    ? source.removed as Record<string, { deletedAt: string; deletedBy: string }> : {};
  const items: DutyItem[] = defaults.map(item => ({ ...item, ...(removed[item.id] || {}) }));
  return { items, checks };
}

export function serializeDutyChecklist(data: DutyChecklistData, defaults: DutyItem[] = DEFAULT_BUSINESS_DUTY_CHECKLIST): string {
  const defaultIds = new Set(defaults.map(item => item.id));
  const removed: Record<string, { deletedAt: string; deletedBy: string }> = {};
  for (const item of data.items) {
    if (defaultIds.has(item.id) && item.deletedAt) {
      removed[item.id] = { deletedAt: item.deletedAt, deletedBy: item.deletedBy || '' };
    }
  }
  const checks = Object.fromEntries(Object.entries(data.checks).filter(([, state]) =>
    Boolean(state) && (state.status === 'completed' || Boolean(state.updatedAt) || Boolean(state.updatedBy))));

  return JSON.stringify({
    version: 2,
    items: data.items,
    removed,
    checks,
  });
}
