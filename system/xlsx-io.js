// 共用 XLSX 匯入／匯出工具 —— 全站統一以 ExcelJS 處理 .xlsx。
//
// 取代原本各頁分別呼叫的 SheetJS（xlsx.full.min.js）。改用單一函式庫的原因：
//
// 1. SheetJS 的 CSV 解析會把儲存格當數值推斷，`0912345678` 這類前導零的電話號碼
//    會被讀成 912345678；且 CSV 沒有編碼標記，非 BOM 的 UTF-8 與 Big5 檔案的中文
//    表頭會整排變成亂碼，最後以「找不到欄位」這種與真因無關的訊息失敗。CSV 本身
//    不帶型別與編碼資訊，這些問題無法在解析端穩定修好，因此匯入改為只收 .xlsx。
// 2. 匯出原本就已陸續改用 ExcelJS（需要樣式與凍結窗格），保留 SheetJS 只為了讀
//    .xls/.csv。全面改用 .xlsx 之後，SheetJS 已無用途，可整包移除以縮小攻擊面。
//
// ExcelJS 不支援 .xls（BIFF），這是刻意的取捨：.xls 已停止作為交換格式使用，
// 使用者以 Excel 另存為 .xlsx 即可。
(function () {
  'use strict';

  // ExcelJS 的儲存格值有多種型態：純值、公式物件、超連結物件、RichText 物件、
  // 錯誤物件。一律攤平成單純的 JS 值（字串／數字／布林／Date／null）。
  function cellValue(raw) {
    if (raw == null) return null;
    if (raw instanceof Date) return raw;
    if (typeof raw !== 'object') return raw;
    if (Array.isArray(raw.richText)) return raw.richText.map(function (t) { return t.text || ''; }).join('');
    if (raw.text != null) return raw.text;                 // 超連結
    if ('result' in raw) return cellValue(raw.result);     // 公式／共用公式
    if (raw.error) return '';                              // #REF! 等
    return String(raw);
  }

  function cellText(raw) {
    var v = cellValue(raw);
    if (v == null) return '';
    if (v instanceof Date) return formatDate(v);
    return String(v);
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // 一律輸出本地時間的 YYYY-MM-DD，不經 toISOString（那會轉成 UTC 而在台灣退一天）。
  function formatDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Excel 序號日期（1900 曆制）轉 Date；ExcelJS 通常已還原成 Date，此處供保險用。
  function excelSerialToDate(n) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    var ms = Math.round((n - 25569) * 86400 * 1000);
    var d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  function lastColumn(ws) {
    var n = ws.columnCount || 0;
    ws.eachRow({ includeEmpty: true }, function (row) {
      if (row.cellCount > n) n = row.cellCount;
    });
    return n;
  }

  // 對應原本 SheetJS 的 sheet_to_json(ws,{header:1})：回傳字串陣列的陣列。
  function sheetToAoa(ws) {
    if (!ws) return [];
    var cols = lastColumn(ws), aoa = [], maxRow = ws.rowCount || 0;
    for (var r = 1; r <= maxRow; r++) {
      var row = ws.getRow(r), line = [];
      for (var c = 1; c <= cols; c++) line.push(cellText(row.getCell(c).value));
      aoa.push(line);
    }
    return aoa;
  }

  // 對應原本 SheetJS 的 sheet_to_json(ws,{defval:'',raw:true})：以第一列為表頭，
  // 回傳物件陣列。保留 Date 與數字型別，供呼叫端自行轉換。
  function sheetToObjects(ws) {
    if (!ws) return [];
    var cols = lastColumn(ws), maxRow = ws.rowCount || 0;
    if (maxRow < 2) return [];
    var headRow = ws.getRow(1), headers = [];
    for (var c = 1; c <= cols; c++) headers.push(cellText(headRow.getCell(c).value).trim());
    var out = [];
    for (var r = 2; r <= maxRow; r++) {
      var row = ws.getRow(r), obj = {}, any = false;
      for (var i = 0; i < cols; i++) {
        var key = headers[i];
        if (!key) continue;
        var v = cellValue(row.getCell(i + 1).value);
        if (v == null || v === '') { obj[key] = ''; continue; }
        obj[key] = v; any = true;
      }
      if (any) out.push(obj);
    }
    return out;
  }

  function assertExcelJS() {
    if (typeof ExcelJS === 'undefined') throw new Error('Excel 元件尚未載入，請重新整理後再試');
    return ExcelJS;
  }

  async function loadWorkbook(arrayBuffer) {
    var wb = new (assertExcelJS().Workbook)();
    try {
      await wb.xlsx.load(arrayBuffer);
    } catch (e) {
      // .xlsx 是 zip 容器，餵進 .xls/.csv 時底層 JSZip 會丟英文的
      // 「Can't find end of central directory」，對使用者毫無意義，換成可行動的說明。
      throw new Error('這個檔案不是 .xlsx 格式，請用 Excel 開啟後另存新檔為「Excel 活頁簿 (*.xlsx)」再匯入');
    }
    return wb;
  }

  // 讀取上傳的檔案並取第一張工作表的 AOA。
  async function readFileAoa(file) {
    var wb = await loadWorkbook(await file.arrayBuffer());
    return sheetToAoa(wb.worksheets[0]);
  }

  function newWorkbook() { return new (assertExcelJS().Workbook)(); }

  // 以 AOA 建立工作表，並依表頭長度給合理欄寬（沿用原本 SheetJS 版的寬度公式）。
  function addAoaSheet(wb, name, aoa, opts) {
    var o = opts || {};
    var ws = wb.addWorksheet(name);
    (aoa || []).forEach(function (row) { ws.addRow(row); });
    var head = (aoa && aoa[0]) || [];
    if (head.length) {
      ws.columns.forEach(function (col, i) {
        var label = String(head[i] == null ? '' : head[i]);
        col.width = Math.max(12, Math.min(28, label.length * 2 + 4));
      });
      if (o.bold !== false) ws.getRow(1).font = { bold: true };
      if (o.autoFilter && aoa.length > 1) {
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };
      }
    }
    return ws;
  }

  async function download(wb, filename) {
    var buffer = await wb.xlsx.writeBuffer();
    var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // 以 AOA 直接匯出單張工作表的捷徑。
  async function downloadAoa(filename, sheetName, aoa, opts) {
    var wb = newWorkbook();
    addAoaSheet(wb, sheetName, aoa, opts);
    await download(wb, filename);
  }

  window.XlsxIO = {
    cellValue: cellValue,
    cellText: cellText,
    formatDate: formatDate,
    excelSerialToDate: excelSerialToDate,
    sheetToAoa: sheetToAoa,
    sheetToObjects: sheetToObjects,
    loadWorkbook: loadWorkbook,
    readFileAoa: readFileAoa,
    newWorkbook: newWorkbook,
    addAoaSheet: addAoaSheet,
    download: download,
    downloadAoa: downloadAoa
  };
})();
