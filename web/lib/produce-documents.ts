// 水果組／蔬菜組電子交接簿第二批單據（存貨交接明細、果菜報廢報告、運回放行單）的共用判斷與計算。
// 與 supabase/migrations/20261022090000_produce_handover_documents.sql 對應；階段與標籤有測試比對。
export type ProduceDocType = 'stock' | 'scrap';
export type ProduceDocStage = 'small_leader' | 'group_leader' | 'director';
export type ProduceDocStatus = 'draft' | 'submitted' | 'void';

export type StockLine = {
  purchase_no: string; supplier_code: string; product_name: string; grade: string;
  pieces: number | string; container: string; weight: number | string; location: string; reason: string;
};
export type ScrapLine = {
  receive_date: string; supplier_code: string; product_name: string; pieces: number | string;
  container: string; weight: number | string; scrap_date: string; reason: string;
};

export const STOCK_FORM_NO = 'HOL-2-09';
export const SCRAP_FORM_NO = 'HEM-2-11';
export const LINE_LIMIT = 60;

/** 簽核階段（也是顯示順序）。存貨交接：填表人員（送出）→ 小組長 → 組(副)長；報廢報告再加主(副)任。 */
export const PRODUCE_DOC_STAGES: Record<ProduceDocType, readonly ProduceDocStage[]> = {
  stock: ['small_leader', 'group_leader'],
  scrap: ['small_leader', 'group_leader', 'director'],
};
export const PRODUCE_DOC_STAGE_LABELS: Record<ProduceDocStage, string> = {
  small_leader: '小組長', group_leader: '組(副)長', director: '主(副)任',
};
export const PRODUCE_DOC_STATUS_LABELS: Record<ProduceDocStatus, string> = { draft: '草稿', submitted: '已送出', void: '已作廢' };

export const blankStockLine = (): StockLine => ({
  purchase_no: '', supplier_code: '', product_name: '', grade: '', pieces: '', container: '', weight: '', location: '', reason: '',
});
export const blankScrapLine = (date = ''): ScrapLine => ({
  receive_date: date, supplier_code: '', product_name: '', pieces: '', container: '', weight: '', scrap_date: date, reason: '',
});

const num = (value: unknown) => {
  const parsed = Number(String(value ?? '').trim() || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 合計列：件數加總、重量加總（公斤，四捨五入到小數 2 位）。 */
export function sumLines(lines: ReadonlyArray<{ pieces?: unknown; weight?: unknown }>) {
  let pieces = 0;
  let weight = 0;
  for (const line of lines) { pieces += Math.trunc(num(line.pieces)); weight += num(line.weight); }
  return { pieces, weight: Math.round(weight * 100) / 100 };
}

/** 空白列：除預設日期外所有欄位都沒填（或數字為 0）。預設日期不算有填，避免只帶了日期的新列被當成缺品名。 */
export function isBlankLine(line: Record<string, unknown>) {
  return Object.entries(line).every(([key, value]) => {
    if (key === 'receive_date' || key === 'scrap_date') return true;
    const text = String(value ?? '').trim();
    return text === '' || (/^-?\d+(\.\d+)?$/.test(text) && Number(text) === 0);
  });
}

/** 送到資料庫前的整理：略過空白列（與資料庫 produce_normalize_lines 相同的判斷）。 */
export function compactLines<T extends Record<string, unknown>>(lines: ReadonlyArray<T>): T[] {
  return lines.filter(line => !isBlankLine(line));
}

/** 前端先檢查，與資料庫規則相同；回傳第一個問題，沒有問題回傳空字串。 */
export function lineProblem(lines: ReadonlyArray<Record<string, unknown>>) {
  const filled = compactLines(lines);
  if (filled.length > LINE_LIMIT) return `明細至多 ${LINE_LIMIT} 列`;
  for (const line of filled) {
    if (!String(line.product_name ?? '').trim()) return '每一列都必須填寫品名';
    for (const key of ['pieces', 'weight'] as const) {
      const raw = String(line[key] ?? '').trim();
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return '件數與重量必須是不小於 0 的數字';
      if (key === 'pieces' && !Number.isInteger(value)) return '件數必須是整數';
    }
  }
  return '';
}

/** 這一階目前不能簽核的原因；可以簽核時回傳空字串。後一階須在前一階之後。 */
export function docGateReason(type: ProduceDocType, stage: ProduceDocStage, signed: Iterable<string>, status: ProduceDocStatus) {
  if (status !== 'submitted') return status === 'void' ? '單據已作廢' : '單據尚未送出';
  const order = PRODUCE_DOC_STAGES[type];
  const index = order.indexOf(stage);
  if (index <= 0) return '';
  const done = new Set(signed);
  const previous = order[index - 1];
  return done.has(previous) ? '' : `請先由${PRODUCE_DOC_STAGE_LABELS[previous]}簽核，${PRODUCE_DOC_STAGE_LABELS[stage]}才能簽核。`;
}

/** 下一個待簽核的階段；全部簽完回傳 null。 */
export function nextDocStage(type: ProduceDocType, signed: Iterable<string>): ProduceDocStage | null {
  const done = new Set(signed);
  return PRODUCE_DOC_STAGES[type].find(stage => !done.has(stage)) || null;
}

export function docProgressLabel(type: ProduceDocType, status: ProduceDocStatus, signed: Iterable<string>) {
  if (status !== 'submitted') return PRODUCE_DOC_STATUS_LABELS[status];
  const done = new Set(signed);
  const total = PRODUCE_DOC_STAGES[type].length;
  const count = PRODUCE_DOC_STAGES[type].filter(stage => done.has(stage)).length;
  return count === total ? '簽核完成' : `簽核 ${count}/${total}`;
}

/** 存貨交接明細「一式三份」的聯別（紙本備註：自存或列入交代、送核算小組、呈閱後送業務部）。 */
export const STOCK_COPIES = [
  { no: '第一聯', name: '自存或列入交代（移交）' },
  { no: '第二聯', name: '送核算小組' },
  { no: '第三聯', name: '呈閱後送業務部' },
] as const;
/** 運回放行單三聯（紙本：存根白、拍賣員完帳黃、供應人存查藍）。 */
export const SLIP_COPIES = [
  { no: '第一聯', name: '存根（白）' },
  { no: '第二聯', name: '拍賣員完帳（黃）' },
  { no: '第三聯', name: '供應人存查（藍）' },
] as const;

/** 月/日顯示（紙本進貨日期、報廢日期欄只寫月與日）。 */
export function monthDay(value: unknown) {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return match ? `${Number(match[1])}/${Number(match[2])}` : '';
}

/** 民國年月日。 */
export function rocDateLabel(value: unknown) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return match ? `${Number(match[1]) - 1911} 年 ${Number(match[2])} 月 ${Number(match[3])} 日` : '';
}

/** datetime-local 的值（台灣時間 yyyy-MM-ddTHH:mm）轉成帶 +08:00 的 ISO 字串，避免瀏覽器時區位移。 */
export function taipeiLocalToIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+08:00` : '';
}

export function taipeiNowLocal(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce<Record<string, string>>((acc, part) => { if (part.type !== 'literal') acc[part.type] = part.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** 目前台灣時間，分鐘無條件捨去到 30 分鐘級距（與 LocalizedDateTimeInput 的時間下拉一致，預設值才選得到）。 */
export function taipeiNowHalfHour(now = new Date()) {
  const [date, time] = taipeiNowLocal(now).split('T');
  const [hour, minute] = time.split(':').map(Number);
  return `${date}T${String(hour).padStart(2, '0')}:${minute >= 30 ? '30' : '00'}`;
}

/** 放行單處理時間顯示：民國年月日時分。 */
export function slipTimeLabel(value: unknown) {
  if (!value) return '';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '';
  const local = taipeiNowLocal(parsed);
  const [date, time] = local.split('T');
  return `${rocDateLabel(date)} ${time}`;
}
