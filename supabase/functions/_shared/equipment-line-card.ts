type Equipment = {
  equipment_id: string;
  asset_code?: string | null;
  qr_code?: string | null;
  name: string;
  floor?: string | null;
  location?: string | null;
  status?: string | null;
};
type Point = {
  point_name: string; last_value: unknown; unit?: string | null;
  last_quality?: string | null; last_seen_at?: string | null;
  sampling_seconds?: number | null; status?: string | null;
};
type Repair = {
  req_no?: string | null; fault_desc?: string | null;
  status?: string | null; created_at?: string | null;
};
type Alert = { title?: string | null; severity?: string | null; occurred_at?: string | null };

// Control characters are deliberately removed before building LINE text.
const clean = (value: unknown, max = 100) =>
  // deno-lint-ignore no-control-regex
  String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max);

const localTime = (value: string | null | undefined): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return '時間未提供';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
};

export function monitorPointText(point: Point, now: Date): string {
  const observed = point.last_seen_at ? Date.parse(point.last_seen_at) : NaN;
  const interval = Number.isFinite(point.sampling_seconds) && Number(point.sampling_seconds) > 0
    ? Math.min(24 * 3600, Math.max(300, Number(point.sampling_seconds) * 3)) : 900;
  const age = now.getTime() - observed;
  const fresh = point.status === 'active' && Number.isFinite(observed)
    && age >= -120_000 && age <= interval * 1000;
  const quality = clean(point.last_quality, 30).toLowerCase();
  const trustworthy = ['good', 'ok', 'normal'].includes(quality);
  const raw = point.last_value;
  const value = typeof raw === 'number' && Number.isFinite(raw)
    ? String(raw) : typeof raw === 'boolean' || typeof raw === 'string' ? clean(raw, 50) : '';
  const label = fresh && trustworthy && value
    ? `${value}${point.unit ? ` ${clean(point.unit, 12)}` : ''}`
    : !Number.isFinite(observed) ? '未提供讀值'
      : !fresh ? '讀值已過期或點位未啟用'
        : '讀值品質未確認';
  return `${clean(point.point_name, 50) || '未命名點位'}：${label}（${localTime(point.last_seen_at)}）`;
}

function row(label: string, value: string) {
  return {
    type: 'box', layout: 'vertical', margin: 'md',
    contents: [
      { type: 'text', text: label, size: 'xs', color: '#64748B' },
      { type: 'text', text: value, size: 'sm', wrap: true, color: '#172B4D' },
    ],
  };
}

/** A bounded LINE Flex card; all values come from the live database query. */
export function equipmentFlexMessage(input: {
  equipment: Equipment;
  points: Point[] | null;
  repairs: Repair[] | null;
  alerts?: Alert[] | null;
  now: Date;
  url: string;
}) {
  const { equipment, points, repairs, alerts = null, now, url } = input;
  const code = clean(equipment.asset_code || equipment.qr_code || equipment.equipment_id, 80);
  const status = ({ active: '啟用', inactive: '停用', retired: '除役' } as Record<string, string>)[String(equipment.status)] || clean(equipment.status, 30) || '未提供';
  const pointSummary = points === null ? '無監測資料查閱權限'
    : points.length ? points.slice(0, 5).map(point => monitorPointText(point, now)).join('\n')
      : '未接入監測點位';
  const repairSummary = repairs === null ? '無報修查閱權限'
    : repairs.length ? repairs.slice(0, 3).map(repair =>
      `${clean(repair.req_no, 32) || '未編號'}｜${clean(repair.status, 30) || '狀態未提供'}｜${localTime(repair.created_at)}\n${clean(repair.fault_desc, 90) || '故障說明未提供'}`
    ).join('\n') : '目前沒有關聯報修紀錄';
  const alertSummary = alerts === null ? '無監測事件查閱權限'
    : alerts.length ? alerts.slice(0, 3).map(alert =>
      `${clean(alert.severity, 20) || '等級未提供'}｜${clean(alert.title, 90) || '未命名事件'}｜${localTime(alert.occurred_at)}`
    ).join('\n') : '目前沒有未結監控事件（不代表設備運轉正常）';
  return {
    type: 'flex',
    altText: `設備查詢：${clean(equipment.name, 70)}（${code}），資產狀態${status}`,
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#0878A8',
        contents: [{ type: 'text', text: '中央巡檢系統｜設備查詢', color: '#FFFFFF', weight: 'bold', size: 'md' }] },
      body: { type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: clean(equipment.name, 100) || '未命名設備', weight: 'bold', size: 'lg', wrap: true },
          row('設備編號', code),
          row('位置', [clean(equipment.floor, 30), clean(equipment.location, 80)].filter(Boolean).join(' ') || '未提供'),
          row('資產狀態', status),
          { type: 'separator', margin: 'lg' },
          row('監測點位（最後回報時間）', pointSummary),
          row('未結監控事件', alertSummary),
          { type: 'separator', margin: 'lg' },
          row('最近報修', repairSummary),
        ] },
      footer: { type: 'box', layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: '#0878A8',
          action: { type: 'uri', label: '開啟中央巡檢系統', uri: url } }] },
    },
  };
}

export async function sendEquipmentLineReply(input: {
  token: string; replyToken: string; message: unknown; fetcher?: typeof fetch;
}): Promise<void> {
  const response = await (input.fetcher || fetch)('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken: input.replyToken, messages: [input.message] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('LINE reply failed');
}
