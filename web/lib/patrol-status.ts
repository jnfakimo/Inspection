// 巡邏點的三色打卡狀態 —— 對應 V1 的 `system/patrolstatus.js` 之 compute()。
//
// V1 由 b1_integrated_marker_system.html 與 guardpatrol3d.html 共用，用來把巡邏點
// 圖釘依「當班是否已打卡」著色。這裡只移植 compute()；V1 另有的 computeMatrix()
// 服務的是稽核總覽頁，V2 的打卡矩陣已在 operations-workspace.tsx 自行實作。
//
// 兩組時間不可混用，這是這支邏輯最容易寫錯的地方：
// - **班別時段**（start_time／end_time）決定「現在是哪一班」，供畫面顯示。
// - **通報時段**（notify_start_time／notify_end_time；來自 patrol_shift_staff.workTimes）決定三色狀態何時由待打卡
//   翻成逾期。兩者皆支援昨天開始、今天結束的跨夜班。
// 而且通報結束只是「逾期的起點」，不是「不再接受打卡」——當班內遲到的打卡仍要
// 讓該點由紅轉綠，因此接受打卡的區間取兩者的聯集。

import type { SupabaseClient } from '@supabase/supabase-js';

export type PatrolState = 'ok' | 'pending' | 'overdue';

/**
 * 巡檢班別的「刪除」是軟刪除：`a06f2ce` 把名稱前綴成 `[已刪除] 原名`，資料列保留。
 * 讀 patrol_shifts 的地方共有四處（排班頁、打卡矩陣、首頁當班巡檢、本檔），
 * 導入時只有排班頁做了過濾，其餘三處會把前綴直接顯示給使用者。判斷集中在這裡，
 * 四處共用，避免再各寫一份字串比對。
 */
export const DELETED_SHIFT_PREFIX = '[已刪除]';
export const isDeletedShift = (name: unknown) => String(name ?? '').startsWith(DELETED_SHIFT_PREFIX);

export const PATROL_COLORS: Record<PatrolState, string> = {
  ok: '#00ff9d', pending: '#c77dff', overdue: '#ff5470',
};
export const PATROL_LABELS: Record<PatrolState, string> = {
  ok: '已打卡', pending: '待打卡', overdue: '逾期未打卡',
};

type Client = SupabaseClient<any, any, any>;
export type PatrolShift = {
  shift_id: string; name: string;
  start_time: string; end_time: string;
  notify_start_time: string; notify_end_time: string;
  sort_order: number | null;
};
type ShiftWithBase = PatrolShift & { base: Date };
type PatrolMarker = { marker_id: string; floor_id: string; label: string };

function timeToDate(dayBase: Date, value: unknown) {
  const [hour, minute, second] = String(value ?? '').split(':').map(Number);
  const date = new Date(dayBase);
  date.setHours(hour || 0, minute || 0, second || 0, 0);
  return date;
}

/** 上班時段。end <= start 代表跨夜，結束時間落在隔天。 */
export function shiftRange(shift: PatrolShift, dayBase: Date) {
  const start = timeToDate(dayBase, shift.start_time);
  let end = timeToDate(dayBase, shift.end_time);
  if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

/** 通報時段。沒有另外設定時退回班別時段。 */
export function notificationRange(shift: PatrolShift, dayBase: Date) {
  const start = timeToDate(dayBase, shift.notify_start_time || shift.start_time);
  let end = timeToDate(dayBase, shift.notify_end_time || shift.end_time);
  if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

/** 接受打卡的區間：通報時段與上班時段的聯集，讓遲到的打卡仍能由紅轉綠。 */
export function checkinRange(shift: PatrolShift, dayBase: Date) {
  const notice = notificationRange(shift, dayBase);
  const work = shiftRange(shift, dayBase);
  return {
    start: work.start < notice.start ? work.start : notice.start,
    end: work.end > notice.end ? work.end : notice.end,
  };
}

export function dateStrOf(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 同一個工作階段內重複呼叫時共用結果；班別樣板與巡邏點清單都不常變動。
let baseDataPromise: Promise<{ templates: any[]; setting: any; timeoutRules: any }> | null = null;
let markerPromise: Promise<PatrolMarker[]> | null = null;
const overridePromises = new Map<string, Promise<any[]>>();

function getBaseData(client: Client) {
  if (!baseDataPromise) {
    baseDataPromise = Promise.all([
      // 已軟刪除的範本不得再產生通報時窗，過濾規則要與排班頁一致。
      client.from('patrol_shift_template').select('*').neq('status', 'inactive').order('sort_order'),
      client.from('system_settings').select('value').eq('key', 'patrol_shift_staff').maybeSingle(),
      client.from('system_settings').select('value').eq('key', 'patrol_timeout_rules').maybeSingle(),
    ]).then(([templateResult, settingResult, timeoutRuleResult]) => ({
      templates: templateResult.data || [], setting: settingResult.data, timeoutRules: timeoutRuleResult.data,
    }));
  }
  return baseDataPromise;
}

function getOverrides(client: Client, dateStr: string) {
  if (!overridePromises.has(dateStr)) {
    // Supabase 的查詢建構器回傳 PromiseLike，包一層才是完整的 Promise。
    overridePromises.set(dateStr, (async () => {
      const result = await client.from('patrol_shifts').select('*').eq('shift_date', dateStr);
      // 已軟刪除的班別不得覆寫樣板時段，否則通報時窗會沿用一個已經不存在的班。
      return (result.data || []).filter(row => !isDeletedShift(row.name));
    })());
  }
  return overridePromises.get(dateStr)!;
}

function getMarkers(client: Client) {
  if (!markerPromise) {
    markerPromise = (async () => {
      const result = await client.from('plan_markers').select('marker_id,floor_id,label')
        .eq('kind', 'patrol').eq('status', 'active').order('floor_id').order('label');
      return (result.data || []) as PatrolMarker[];
    })();
  }
  return markerPromise;
}

/**
 * 標記編輯頁在新增或停用巡邏點後必須呼叫，否則同一個工作階段內的異動永遠不會
 * 反映在狀態計算裡（V1 的 invalidateMarkers 就是為此存在）。
 */
export function invalidatePatrolMarkers() {
  markerPromise = null;
}

/**
 * 班別名稱與數量固定來自 patrol_shift_template；patrol_shifts 的時段是每日生效的班別時段。
 * 通報時段另由 system_settings 的 patrol_shift_staff.workTimes 提供，可依樣板或
 * 指定日期設定，沒有設定時才退回班別時段。
 */
export async function getPatrolShiftsForDate(client: Client, dateStr: string): Promise<PatrolShift[]> {
  const [{ templates, setting, timeoutRules }, overrides] = await Promise.all([
    getBaseData(client), getOverrides(client, dateStr),
  ]);
  const overrideByName = new Map((overrides || []).map(row => [row.name, row]));
  let workTimes: { templates: Record<string, any>; dates: Record<string, any> } = { templates: {}, dates: {} };
  try {
    const saved = JSON.parse(setting?.value || '{}').workTimes || {};
    workTimes = { templates: saved.templates || {}, dates: saved.dates || {} };
  } catch { /* 設定損壞時退回樣板時間，不讓整頁失敗 */ }
  let configuredRules: Array<{ label?: string; start?: string; end?: string }> = [];
  try {
    const saved = JSON.parse(timeoutRules?.value || '[]');
    if (Array.isArray(saved)) configuredRules = saved;
  } catch { /* 舊版或損壞的逾時設定不應阻斷排班顯示 */ }

  return (templates || []).map(template => {
    const override = overrideByName.get(template.name);
    const templateWork = workTimes.templates[template.name] || {};
    const dateWork = (workTimes.dates[dateStr] || {})[template.name] || {};
    const configured = configuredRules.find(rule => String(rule.label || '').trim().replace(/\s*巡邏\s*$/u, '') === String(template.name || '').trim().replace(/\s*巡邏\s*$/u, '')) || {};
    // patrol_shifts／patrol_shift_template 的時間是「班別時段」；
    // system_settings.patrol_shift_staff.workTimes 才是排班頁的「通報時段」。
    const shiftStart = override ? override.start_time : template.start_time;
    const shiftEnd = override ? override.end_time : template.end_time;
    const notifyStart = dateWork.start || templateWork.start || configured.start || shiftStart;
    const notifyEnd = dateWork.end || templateWork.end || configured.end || shiftEnd;
    return {
      shift_id: override ? override.shift_id : `tpl:${template.template_id}`,
      name: template.name,
      start_time: shiftStart,
      end_time: shiftEnd,
      notify_start_time: notifyStart,
      notify_end_time: notifyEnd,
      sort_order: template.sort_order,
    };
  });
}

export type PatrolComputeResult = {
  map: Map<string, PatrolState>;
  shift: PatrolShift | null;
  range: { start: Date; end: Date } | null;
};

/**
 * 回傳每個啟用中巡邏點的三色狀態。找不到當班班別時回傳空的 map（圖釘維持原色）。
 * 取班規則與 V1 相同：先找此刻進行中的班，沒有的話取最近一個已結束的班。
 */
export async function computePatrolStatus(client: Client, dateStr?: string): Promise<PatrolComputeResult> {
  const now = new Date();
  const day = dateStr || dateStrOf(now);
  const dayBase = new Date(`${day}T00:00:00`);
  const yesterdayBase = new Date(dayBase.getTime() - 24 * 3600 * 1000);

  const [shiftsToday, shiftsYesterday, markers] = await Promise.all([
    getPatrolShiftsForDate(client, day),
    getPatrolShiftsForDate(client, dateStrOf(yesterdayBase)),
    getMarkers(client),
  ]);

  const allShifts: ShiftWithBase[] = [
    ...shiftsYesterday.map(shift => ({ ...shift, base: yesterdayBase })),
    ...shiftsToday.map(shift => ({ ...shift, base: dayBase })),
  ];

  let relevant: ShiftWithBase | null = null;
  let relevantRange: { start: Date; end: Date } | null = null;
  for (const shift of allShifts) {
    const range = shiftRange(shift, shift.base);
    if (now >= range.start && now <= range.end) { relevant = shift; relevantRange = range; break; }
  }
  if (!relevant) {
    let bestEnd: Date | null = null;
    for (const shift of allShifts) {
      const range = shiftRange(shift, shift.base);
      if (range.end <= now && (!bestEnd || range.end > bestEnd)) {
        relevant = shift; relevantRange = range; bestEnd = range.end;
      }
    }
  }

  const map = new Map<string, PatrolState>();
  if (!relevant) return { map, shift: null, range: null };

  const statusRange = notificationRange(relevant, relevant.base);
  const accepted = checkinRange(relevant, relevant.base);
  const { data: checkins } = await client.from('checkin_logs').select('target_id,checkin_at')
    .eq('target_type', 'marker')
    .gte('checkin_at', accepted.start.toISOString())
    .lte('checkin_at', accepted.end.toISOString());

  const checkedIds = new Set((checkins || []).map(row => String(row.target_id)));
  markers.forEach(marker => {
    if (checkedIds.has(marker.marker_id)) map.set(marker.marker_id, 'ok');
    // 通報時段一開始，未打卡的點就算逾期；之後補打卡仍會翻回 ok。
    else if (now < statusRange.start) map.set(marker.marker_id, 'pending');
    else map.set(marker.marker_id, 'overdue');
  });
  return { map, shift: relevant, range: relevantRange };
}
