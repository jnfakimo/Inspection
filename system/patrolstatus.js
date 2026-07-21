// 駐衛警巡檢系統 — 共用的巡檢狀態計算模組
// 三色狀態：ok(已打卡) / pending(待打卡) / overdue(逾期未打卡)
window.PatrolStatus = (function () {
  const COLORS = { ok: '#00ff9d', pending: '#c77dff', overdue: '#ff5470' };
  const LABELS = { ok: '已打卡', pending: '待打卡', overdue: '逾期未打卡' };
  let baseDataPromise = null;
  let markerPromise = null;
  const overridePromises = new Map();

  function timeToDate(dayBase, t) {
    const [h, m, s] = String(t).split(':').map(Number);
    const d = new Date(dayBase);
    d.setHours(h, m, s || 0, 0);
    return d;
  }

  // 處理跨夜班別（end_time < start_time 代表結束於隔天）
  function shiftRange(shift, dayBase) {
    const start = timeToDate(dayBase, shift.start_time);
    let end = timeToDate(dayBase, shift.end_time);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);
    return { start, end };
  }

  // 打卡狀態統計專用：使用通報時段，不影響畫面顯示的上班時段。
  function notificationRange(shift, dayBase) {
    const start = timeToDate(dayBase, shift.notify_start_time || shift.start_time);
    let end = timeToDate(dayBase, shift.notify_end_time || shift.end_time);
    if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);
    return { start, end };
  }

  // The notification end is the deadline, not the last moment at which a
  // completed patrol may be recorded.  A late check-in during the duty shift
  // must still change the point from overdue to checked.
  function checkinRange(shift, dayBase) {
    const notice = notificationRange(shift, dayBase);
    const work = shiftRange(shift, dayBase);
    return {
      // A patrol completed before the notification window opens is still a
      // valid duty-shift check-in. Late check-ins remain valid until the later
      // of the duty end and notification end.
      start: work.start < notice.start ? work.start : notice.start,
      end: work.end > notice.end ? work.end : notice.end,
    };
  }

  function dateStrOf(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function getBaseData(db) {
    if (!baseDataPromise) {
      baseDataPromise = Promise.all([
        db.from('patrol_shift_template').select('*').order('sort_order'),
        db.from('system_settings').select('value').eq('key', 'patrol_shift_staff').maybeSingle(),
      ]).then(([templateResult, settingResult]) => ({
        templates: templateResult.data || [],
        setting: settingResult.data,
      }));
    }
    return baseDataPromise;
  }

  function getOverrides(db, dateStr) {
    if (!overridePromises.has(dateStr)) {
      overridePromises.set(dateStr, db.from('patrol_shifts').select('*').eq('shift_date', dateStr).then(r => r.data || []));
    }
    return overridePromises.get(dateStr);
  }

  function getMarkers(db) {
    if (!markerPromise) {
      markerPromise = db.from('plan_markers').select('marker_id,floor_id,label')
        .eq('kind', 'patrol').eq('status', 'active').order('floor_id').order('label')
        .then(r => r.data || []);
    }
    return markerPromise;
  }

  // 班別名稱/數量固定來自 patrol_shift_template；patrol_shifts 的時段專供逾時通報。
  // 巡檢表的班別判定與打卡統計改讀 patrol_shift_staff 內獨立設定的「上班時段」。
  async function getShiftsForDate(db, dateStr) {
    const [{ templates: tpl, setting }, overrides] = await Promise.all([getBaseData(db), getOverrides(db, dateStr)]);
    const ovMap = new Map((overrides || []).map(o => [o.name, o]));
    let workTimes = { templates: {}, dates: {} };
    try {
      const saved = JSON.parse(setting?.value || '{}').workTimes || {};
      workTimes = { templates: saved.templates || {}, dates: saved.dates || {} };
    } catch (_e) {}
    return (tpl || []).map(t => {
      const ov = ovMap.get(t.name);
      const templateWork = workTimes.templates[t.name] || {};
      const dateWork = (workTimes.dates[dateStr] || {})[t.name] || {};
      const notifyStart = ov ? ov.start_time : t.start_time;
      const notifyEnd = ov ? ov.end_time : t.end_time;
      return {
        shift_id: ov ? ov.shift_id : ('tpl:' + t.template_id),
        name: t.name,
        start_time: dateWork.start || templateWork.start || notifyStart,
        end_time: dateWork.end || templateWork.end || notifyEnd,
        notify_start_time: notifyStart,
        notify_end_time: notifyEnd,
        sort_order: t.sort_order,
      };
    });
  }

  // 當班顯示以「上班時段」判定；三色打卡狀態則以該班的「通報時段」計算。
  // 兩組時間皆支援昨天開始、今天結束的跨夜班。
  async function compute(db, dateStr) {
    const now = new Date();
    dateStr = dateStr || dateStrOf(now);
    const dayBase = new Date(dateStr + 'T00:00:00');
    const yBase = new Date(dayBase.getTime() - 24 * 3600 * 1000);
    const yStr = dateStrOf(yBase);

    const [shiftsToday, shiftsYesterday, { data: markers }] = await Promise.all([
      getShiftsForDate(db, dateStr),
      getShiftsForDate(db, yStr),
      getMarkers(db).then(data => ({ data })),
    ]);

    const allShifts = [
      ...(shiftsYesterday || []).map(s => ({ ...s, _base: yBase })),
      ...(shiftsToday || []).map(s => ({ ...s, _base: dayBase })),
    ];

    let relevant = null, relevantRange = null;
    for (const s of allShifts) {
      const r = shiftRange(s, s._base);
      if (now >= r.start && now <= r.end) { relevant = s; relevantRange = r; break; }
    }
    if (!relevant) {
      let bestEnd = null;
      for (const s of allShifts) {
        const r = shiftRange(s, s._base);
        if (r.end <= now && (!bestEnd || r.end > bestEnd)) { relevant = s; relevantRange = r; bestEnd = r.end; }
      }
    }

    const map = new Map();
    if (!relevant) return { map, shift: null, range: null };

    const statusRange = notificationRange(relevant, relevant._base);

    const acceptedRange = checkinRange(relevant, relevant._base);
    const { data: checkins } = await db.from('checkin_logs').select('target_id,checkin_at')
      .eq('target_type', 'marker')
      .gte('checkin_at', acceptedRange.start.toISOString())
      .lte('checkin_at', acceptedRange.end.toISOString());

    const checkedIds = new Set((checkins || []).map(c => c.target_id));
    (markers || []).forEach(m => {
      if (checkedIds.has(m.marker_id)) map.set(m.marker_id, 'ok');
      else if (now <= statusRange.end) map.set(m.marker_id, 'pending');
      else map.set(m.marker_id, 'overdue');
    });
    return { map, shift: relevant, range: relevantRange, statusRange, checkinRange: acceptedRange };
  }

  // 取得「指定日期」全部班別 × 全部巡檢點的完整矩陣。用於稽核總覽頁。
  async function computeMatrix(db, dateStr) {
    const now = new Date();
    dateStr = dateStr || dateStrOf(now);
    const dayBase = new Date(dateStr + 'T00:00:00');

    const [shifts, { data: markers }] = await Promise.all([
      getShiftsForDate(db, dateStr),
      getMarkers(db).then(data => ({ data })),
    ]);

    const ranges = (shifts || []).map(s => ({
      ...s,
      range: notificationRange(s, dayBase),
      checkinRange: checkinRange(s, dayBase),
    }));
    const matrix = new Map(); // key: shift_id|marker_id -> 'ok'|'pending'|'overdue'
    if (!ranges.length) return { shifts: ranges, markers: markers || [], matrix };

    const minStart = ranges.reduce((a, s) => (s.range.start < a ? s.range.start : a), ranges[0].range.start);
    const maxEnd = ranges.reduce((a, s) => (s.checkinRange.end > a ? s.checkinRange.end : a), ranges[0].checkinRange.end);

    const { data: checkins } = await db.from('checkin_logs').select('target_id,checkin_at')
      .eq('target_type', 'marker')
      .gte('checkin_at', minStart.toISOString())
      .lte('checkin_at', maxEnd.toISOString());

    ranges.forEach(s => {
      (markers || []).forEach(m => {
        const hit = (checkins || []).some(c => c.target_id === m.marker_id &&
          new Date(c.checkin_at) >= s.checkinRange.start && new Date(c.checkin_at) <= s.checkinRange.end);
        let state;
        if (hit) state = 'ok';
        else if (now <= s.range.end) state = 'pending';
        else state = 'overdue';
        matrix.set(s.shift_id + '|' + m.marker_id, state);
      });
    });
    return { shifts: ranges, markers: markers || [], matrix };
  }

  return { compute, computeMatrix, COLORS, LABELS, dateStrOf };
})();
