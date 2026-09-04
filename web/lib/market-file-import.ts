export type ImportTable = { headers: string[]; rows: string[][] };
export type ReportSummary = {
  file: string; date: string; market: string; category: string;
  details: number; items: number; quantity: number; note: string;
};
export type ParsedMarketFile = ImportTable & { report?: ReportSummary };

const REPORT_HEADERS = ['交易日期', '市場', '品類', '品項', '穩定品項鍵', '成交量', '推估成交額', '平均價', '上價', '中價', '下價', '來源檔案', '品質註記'];
const text = (value: unknown) => value == null ? '' : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
const header = (value: unknown) => text(value).replace(/[\s()（）/／]/g, '');
const round = (value: number, digits: number) => Number(value.toFixed(digits));

function reportDate(value: string) {
  const match = value.match(/(?:^|\D)(\d{3,4})[\/_-](\d{1,2})[\/_-](\d{1,2})(?!\d)/);
  if (!match) return '';
  const year = Number(match[1]) + (match[1].length === 3 ? 1911 : 0);
  const iso = `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error('報表交易日期無效。');
  return iso;
}

/** Normalize official daily reports to the same date/market/category/item grain as the historical import. */
export function normalizeMarketSheet(matrix: unknown[][], file: string): ParsedMarketFile {
  const cells = matrix.map(row => row.map(text));
  const report = cells.slice(0, 5).flat().some(cell => /農產.*交易行情查詢/.test(cell));
  if (!report) {
    const nonempty = cells.filter(row => row.some(Boolean));
    const headers = (nonempty.shift() || []).map((cell, index) => cell || `欄位${index + 1}`);
    if (new Set(headers).size !== headers.length) throw new Error('檔案欄位名稱重複，請先確認欄位。');
    return { headers, rows: nonempty.map(row => headers.map((_, index) => row[index] || '')) };
  }
  const headerIndex = cells.findIndex(row => row.some(cell => header(cell) === '品名代號') && row.some(cell => header(cell) === '品名'));
  if (headerIndex < 0) throw new Error('找不到交易行情欄位。');
  const column = (name: string) => cells[headerIndex].findIndex(cell => header(cell).startsWith(name));
  const codeCol = column('品名代號'), varietyCol = column('品種');
  // 「品名」不可命中「品名代號」。
  const nameCol = cells[headerIndex].findIndex(cell => header(cell) === '品名');
  if (nameCol < 0) throw new Error('找不到品名欄位。');
  const avgCol = column('平均價'), qtyCol = column('成交量');
  if (avgCol < 0 || qtyCol < 0) throw new Error('這份是拍賣價報表，缺少平均價或成交量；請下載「全場交易行情」再匯入。');
  const metadata = cells.slice(0, headerIndex + 2).flat().join(' ');
  const date = reportDate(metadata) || reportDate(file);
  const market = metadata.match(/第[一二]市場/)?.[0] || '';
  const category = metadata.match(/蔬菜|水果/)?.[0] || file.match(/蔬菜|水果/)?.[0] || '';
  const summary: ReportSummary = { file, date, market, category, details: 0, items: 0, quantity: 0, note: '' };
  type Detail = { code: string; item: string; variety: string; avg: number; qty: number; high: number | null; middle: number | null; low: number | null; flag: string };
  const details: Detail[] = [];
  const seen = new Map<string, string>();
  let duplicateCount = 0, zeroCount = 0;
  cells.slice(headerIndex + 1).forEach((row, offset) => {
    const code = row[codeCol] || '', item = row[nameCol] || '';
    if (!code && !item || /合計|總計/.test(code) || /合計|總計/.test(item)) return;
    const line = headerIndex + offset + 2;
    if (!code || !item) throw new Error(`第 ${line} 列缺少品名或品名代號。`);
    const numeric = (index: number, label: string, required = false): number | null => {
      const raw = (row[index] || '').replace(/,/g, '');
      if (!raw || /^[—–-]$/.test(raw)) {
        if (required) throw new Error(`第 ${line} 列缺少${label}。`);
        return null;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new Error(`第 ${line} 列${label}不是有效的非負數值。`);
      return value;
    };
    const avg = numeric(avgCol, '平均價', true)!, qty = numeric(qtyCol, '成交量', true)!;
    if (qty === 0) { zeroCount++; return; }
    let high = numeric(column('上價'), '上價'), middle = numeric(column('中價'), '中價'), low = numeric(column('下價'), '下價');
    let flag = '';
    if (high !== null && middle !== null && low !== null) {
      if (avg > 0 && high === 0 && middle === 0 && low === 0) { flag = '價格區間為零待查'; high = middle = low = null; }
      else if (high < middle || middle < low) flag = '高中低價位順序異常待查';
      else if (avg > high + .051 || avg < low - .051) flag = '平均價落在價格區間外待查';
    }
    const detail = { code, item, variety: row[varietyCol] || '', avg, qty, high, middle, low, flag };
    const key = JSON.stringify([code, item, detail.variety]);
    const signature = JSON.stringify(detail);
    if (seen.has(key)) {
      if (seen.get(key) !== signature) throw new Error(`第 ${line} 列的品項明細重複但數值不同，請確認原始報表。`);
      duplicateCount++; return;
    }
    seen.set(key, signature); details.push(detail);
  });
  if (!details.length) return { headers: REPORT_HEADERS, rows: [], report: { ...summary, note: '無交易明細，略過此檔案。' } };
  if (!date || !market || !category) throw new Error('報表缺少交易日期、市場或蔬果類別，無法自動匯入。');
  const groups = new Map<string, Detail[]>();
  for (const detail of details) groups.set(detail.item, [...(groups.get(detail.item) || []), detail]);
  const rows = [...groups].map(([item, group]) => {
    const quantity = group.reduce((sum, row) => sum + row.qty, 0);
    const amount = group.reduce((sum, row) => sum + round(row.avg * row.qty, 2), 0);
    const middleRows = group.filter(row => row.middle !== null);
    const middleQty = middleRows.reduce((sum, row) => sum + row.qty, 0);
    const highs = group.flatMap(row => row.high === null ? [] : [row.high]);
    const lows = group.flatMap(row => row.low === null ? [] : [row.low]);
    return [date, market, category, item, [...new Set(group.map(row => row.code))].sort().join('|'),
      text(round(quantity, 2)), text(round(amount, 2)), text(round(amount / quantity, 4)),
      highs.length ? text(Math.max(...highs)) : '', middleQty ? text(round(middleRows.reduce((sum, row) => sum + row.middle! * row.qty, 0) / middleQty, 4)) : '',
      lows.length ? text(Math.min(...lows)) : '', file, [...new Set(group.map(row => row.flag).filter(Boolean))].join('、')];
  });
  summary.details = details.length; summary.items = rows.length;
  summary.quantity = round(details.reduce((sum, row) => sum + row.qty, 0), 2);
  summary.note = [duplicateCount ? `略過 ${duplicateCount} 筆相同明細` : '', zeroCount ? `略過 ${zeroCount} 筆零成交量明細` : ''].filter(Boolean).join('；');
  return { headers: REPORT_HEADERS, rows, report: summary };
}

export async function parseMarketExcelFile(file: Pick<File, 'name' | 'arrayBuffer' | 'size'>): Promise<ParsedMarketFile> {
  if (file.size > 100 * 1024 * 1024) throw new Error('單一檔案不可超過 100 MB。');
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('檔案中找不到工作表。');
  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const rowValues = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(
      rowValues.map(val => {
        if (val == null) return '';
        if (typeof val === 'object' && val !== null) {
          if ('result' in val) return (val as any).result ?? '';
          if ('text' in val) return (val as any).text ?? '';
        }
        return val;
      })
    );
  });
  return normalizeMarketSheet(rows, file.name);
}

/** Identical downloads are ignored; conflicting exports of one scope must not be summed. */
export function combineMarketFiles(files: ParsedMarketFile[]) {
  const headers = [...new Set(files.flatMap(file => file.headers))];
  const rows: string[][] = [], reports: ReportSummary[] = [];
  const scopes = new Map<string, string>();
  for (const file of files) {
    if (file.report) {
      const report = { ...file.report };
      if (file.rows.length) {
        const key = JSON.stringify([report.date, report.market, report.category]);
        const signature = JSON.stringify(file.rows.map(row => row.filter((_, index) => file.headers[index] !== '來源檔案')).sort((a, b) => a.join('|').localeCompare(b.join('|'))));
        if (scopes.has(key)) {
          if (scopes.get(key) !== signature) throw new Error(`${report.date} ${report.market} ${report.category} 有不同版本，請只選擇要匯入的一份報表。`);
          reports.push({ ...report, items: 0, note: '內容重複，略過此檔案。' }); continue;
        }
        scopes.set(key, signature);
      }
      reports.push(report);
    }
    rows.push(...file.rows.map(row => headers.map(name => row[file.headers.indexOf(name)] || '')));
  }
  return { headers, rows, reports };
}
