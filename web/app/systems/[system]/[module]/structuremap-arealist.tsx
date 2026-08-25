'use client';

// SYS-06 區域位置表 = V1 `arealist.html` 的移植。版型與功能對齊 V1：
// 統計卡 → 工具列 → 樓層分組摺疊清單（每層獨立分頁）→ 新增／編輯視窗 → QR 視窗。
//
// 與 V1 的行為差異只有兩處，都是 V2 環境使然，不是版面調整：
// 1. 匯入／匯出改用 ExcelJS 的動態 import（V1 走 CDN 的 exceljs + xlsx-io.js），
//    QR 改用 qrcode-generator（V1 走 CDN 的 qrcodejs）。兩者都與 SYS-03 巡邏點
//    QR 標籤、SYS-01 費用匯出採同一套做法，不再引入新的 CDN 相依。
// 2.「定位」仍跳往 V1 的整合標記系統——V2 的 markers 模組目前是資料表，
//    沒有 ?marker= 的圖面定位能力，改連 V2 會讓這個動作失去意義。
//
// 寫入統一走 app-api 的 area_save（後端驗證 sys_structuremap 權限、依欄位白名單清洗、
// 檢查空間是否被整合標記系統使用，並寫入稽核）；讀取仍直接走資料表。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@/app/admin-workspace.css';
import './v1-listpage.css';
import './structuremap-arealist.css';
import { AppShell } from '@/components/AppShell';
import { LEGACY_BASE, MARKET_ID } from '@/lib/config';
import { canonicalFloor, floorOrder } from '@/lib/floor';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { module: ModuleDefinition; profile: Profile };
type Space = { space_id: string; floor: string; space_name: string; sort_order: number | null };

const PAGE_SIZE = 10;

/** 與 V1 的 translateError 逐條對齊，訊息文字不變。 */
function translateError(error: unknown) {
  const message = error instanceof Error ? error.message
    : (typeof error === 'object' && error !== null && 'message' in error)
      ? String((error as Record<string, unknown>).message) : String(error || '');
  if (!message) return '未知錯誤';
  if (message.includes('duplicate key value')) return '資料重複，請確認是否已存在';
  if (message.includes('null value in column')) return '必填欄位不可空白';
  if (message.includes('violates foreign key constraint')) return '關聯資料錯誤，無法刪除';
  if (/violates row-level security|permission denied/.test(message)) return '無操作權限';
  if (message.includes('JWT expired')) return '登入已過期，請重新整理頁面';
  if (message.includes('relation') && message.includes('does not exist')) return '資料表不存在，請確認資料庫設定';
  if (message.includes('value too long')) return '輸入值過長';
  if (message.includes('invalid input syntax')) return '輸入格式不正確';
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return '網路連線失敗，請稍後再試';
  return '操作失敗，請稍後再試或聯絡系統管理員';
}

/** V1 的 fmtTime：只顯示到分，不含年份。 */
function fmtTime(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function normSpaceName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}
function importKey(floor: unknown, name: unknown) {
  return `${canonicalFloor(floor)}||${normSpaceName(name).toLocaleLowerCase('zh-TW')}`;
}
function importSample(list: { line: number; floor: string; name: string }[]) {
  const sample = list.slice(0, 8).map(item => `第 ${item.line} 列：${item.floor} / ${item.name}`).join('\n');
  return sample + (list.length > 8 ? `\n…等 ${list.length} 筆` : '');
}
/** 用本地日期組時間戳；toISOString 會轉成 UTC，台灣早上八點前會退一天。 */
function todayStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 兩個外部能力都以動態 import 載入，維持與 SYS-03 巡邏點 QR、SYS-01 費用匯出一致。
async function qrDataUrl(text: string) {
  const qrcode = (await import('qrcode-generator')).default;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(5, 8);
}
async function downloadAoa(fileName: string, sheetName: string, aoa: (string | number)[][]) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '臺北農產公司';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName);
  aoa.forEach(row => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach(column => { column.width = 22; });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function readFileAoa(file: File) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const aoa: string[][] = [];
  // ExcelJS 的 row.values 是 1-based 且第 0 格固定為 undefined，切掉才對得上欄位索引。
  sheet.eachRow({ includeEmpty: true }, row => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    aoa.push(values.map(cell => {
      if (cell == null) return '';
      if (typeof cell === 'object' && 'text' in cell) return String((cell as { text: unknown }).text ?? '');
      if (typeof cell === 'object' && 'result' in cell) return String((cell as { result: unknown }).result ?? '');
      return String(cell);
    }));
  });
  return aoa;
}

export function AreaListModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Space[]>([]);
  const [usedSpaces, setUsedSpaces] = useState<Map<string, Set<string>>>(new Map());
  const [spaceMarker, setSpaceMarker] = useState<Map<string, string>>(new Map());
  const [lastCheckin, setLastCheckin] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(true);

  const [floorFilter, setFloorFilter] = useState('');
  const [useFilter, setUseFilter] = useState('');
  const [query, setQuery] = useState('');

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const collapsedReadyRef = useRef(false);
  const [floorPages, setFloorPages] = useState<Map<string, number>>(new Map());

  const [editor, setEditor] = useState<{ id: string | null; floor: string; name: string; message: string } | null>(null);
  const [qr, setQr] = useState<{ name: string; floor: string; dataUrl: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setLoadError('');
    const client = getSupabase();
    const [spaceResult, markerResult, checkinResult] = await Promise.all([
      client.from('floor_spaces').select('space_id,floor,space_name,sort_order')
        .eq('market_id', MARKET_ID).eq('status', 'active')
        .order('floor_order').order('sort_order').order('space_name'),
      client.from('plan_markers').select('marker_id,space_id,floor_id,status')
        .not('space_id', 'is', null).eq('status', 'active'),
      client.from('checkin_logs').select('target_id,checkin_at')
        .eq('target_type', 'space').order('checkin_at', { ascending: false }).limit(1000),
    ]);
    if (spaceResult.error) {
      setLoadError('無法讀取資料。請先於 Supabase 執行 sql/floor_spaces.sql 建表。');
      notify(`讀取失敗：${translateError(spaceResult.error)}`, true);
      setBusy(false);
      return;
    }
    const spaces = (spaceResult.data || []).map(row => ({
      ...(row as Space), floor: canonicalFloor(row.floor),
    })) as Space[];
    const used = new Map<string, Set<string>>();
    const markers = new Map<string, string>();
    if (!markerResult.error) {
      (markerResult.data || []).forEach(marker => {
        const id = String(marker.space_id || '');
        if (!id) return;
        if (!used.has(id)) used.set(id, new Set());
        if (marker.floor_id) used.get(id)!.add(canonicalFloor(marker.floor_id));
        if (!markers.has(id)) markers.set(id, String(marker.marker_id));
      });
    }
    const checkins = new Map<string, string>();
    // 已依 checkin_at 遞減排序，同一空間的第一筆即最近一次。
    (checkinResult.data || []).forEach(row => {
      const id = String(row.target_id || '');
      if (id && !checkins.has(id)) checkins.set(id, String(row.checkin_at));
    });
    setRows(spaces);
    setUsedSpaces(used);
    setSpaceMarker(markers);
    setLastCheckin(checkins);
    if (!collapsedReadyRef.current) {
      setCollapsed(new Set(spaces.map(row => row.floor)));
      collapsedReadyRef.current = true;
    }
    setBusy(false);
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const isSpaceUsed = useCallback((id: string) => usedSpaces.has(id), [usedSpaces]);
  const spaceUseText = useCallback((id: string) => (isSpaceUsed(id) ? '使用' : '未使用'), [isSpaceUsed]);

  const floorsSorted = useMemo(
    () => [...new Set(rows.map(row => row.floor))].sort((a, b) => floorOrder(a) - floorOrder(b)),
    [rows]);

  const filterActive = Boolean(floorFilter || useFilter || query.trim());
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(row =>
      (!floorFilter || row.floor === floorFilter)
      && (useFilter !== 'used' || isSpaceUsed(row.space_id))
      && (useFilter !== 'unused' || !isSpaceUsed(row.space_id))
      && (!q || (row.space_name || '').toLowerCase().includes(q)));
  }, [rows, floorFilter, useFilter, query, isSpaceUsed]);

  const grouped = useMemo(() => {
    const map = new Map<string, Space[]>();
    filtered.forEach(row => {
      if (!map.has(row.floor)) map.set(row.floor, []);
      map.get(row.floor)!.push(row);
    });
    return [...map.entries()]
      .sort((a, b) => floorOrder(a[0]) - floorOrder(b[0]))
      .map(([floor, items]) => [floor, items.slice().sort((a, b) =>
        (Number(a.sort_order || 0) - Number(b.sort_order || 0))
        || String(a.space_name).localeCompare(String(b.space_name), 'zh-Hant'))] as const);
  }, [filtered]);

  // 篩選條件改變時把每層的頁碼歸零，行為與 V1 的 resetPaging 相同。
  useEffect(() => { setFloorPages(new Map()); }, [floorFilter, useFilter, query]);

  const setFloorPage = (floor: string, page: number) =>
    setFloorPages(prev => new Map(prev).set(floor, Math.max(1, page)));
  const toggleFloor = (floor: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(floor)) next.delete(floor); else next.add(floor);
    return next;
  });

  /* ──────────────── 新增／編輯／停用 ──────────────── */

  const saveSpace = async () => {
    if (!editor) return;
    const floor = canonicalFloor(editor.floor);
    const name = editor.name.trim();
    if (!floor) { setEditor({ ...editor, message: '請輸入樓層' }); return; }
    if (!name) { setEditor({ ...editor, message: '請輸入空間名稱' }); return; }
    const payload = { market_id: MARKET_ID, floor, floor_order: floorOrder(floor), space_name: name };
    try {
      await invokeAppApi('area_save', editor.id
        ? { kind: 'save', space_id: editor.id, payload }
        : { kind: 'save', payload });
    } catch (error) {
      setEditor({ ...editor, message: translateError(error) });
      return;
    }
    const wasEdit = Boolean(editor.id);
    setEditor(null);
    notify(wasEdit ? '已更新' : '已新增');
    await load();
  };

  /** 查詢某空間是否已於整合標記系統被標記；查詢失敗必須中止操作，不可視為「未被標記」。 */
  const markedFloorsOf = async (spaceId: string) => {
    const { data, error } = await getSupabase().from('plan_markers')
      .select('floor_id').eq('space_id', spaceId).eq('status', 'active');
    if (error) throw error;
    return [...new Set((data || []).map(row => canonicalFloor(row.floor_id)))];
  };

  const delSpace = async (space: Space) => {
    let floors: string[];
    try { floors = await markedFloorsOf(space.space_id); }
    catch (error) { notify(`無法確認此空間是否使用中，請稍後再試：${translateError(error)}`, true); return; }
    if (floors.length) {
      window.alert(`無法停用「${space.floor} · ${space.space_name}」\n\n此空間已於「整合標記系統」使用中（樓層：${floors.join('、')}）。\n請先停用該標記後再操作。`);
      return;
    }
    if (!window.confirm(`確定停用「${space.floor} · ${space.space_name}」？歷史資料會永久保留。`)) return;
    try {
      await invokeAppApi('area_save', { kind: 'deactivate', space_id: space.space_id });
    } catch (error) { notify(`停用失敗：${translateError(error)}`, true); return; }
    notify('已停用，歷史資料仍保留');
    await load();
  };

  const clearAll = async () => {
    if (!rows.length) { notify('目前沒有資料'); return; }
    const { data, error } = await getSupabase().from('plan_markers')
      .select('space_id,floor_id').not('space_id', 'is', null).eq('status', 'active');
    if (error) { notify(`無法確認空間使用狀態，請稍後再試：${translateError(error)}`, true); return; }
    const refFloors = new Map<string, Set<string>>();
    (data || []).forEach(marker => {
      const id = String(marker.space_id);
      if (!refFloors.has(id)) refFloors.set(id, new Set());
      refFloors.get(id)!.add(canonicalFloor(marker.floor_id));
    });
    const removable = rows.filter(row => !refFloors.has(row.space_id));
    const kept = rows.filter(row => refFloors.has(row.space_id));
    if (!removable.length) {
      window.alert('所有空間都已於「整合標記系統」使用中，無法停用。\n請先停用相關標記後再操作。');
      return;
    }
    let message = `將停用 ${removable.length} 筆空間，歷史資料仍會永久保留。`;
    if (kept.length) {
      const sample = kept.slice(0, 8)
        .map(row => `・${row.floor} · ${row.space_name}（${[...refFloors.get(row.space_id)!].join('、')}）`).join('\n');
      message += `\n\n以下 ${kept.length} 筆因已被整合標記系統標記，將被保留：\n${sample}${kept.length > 8 ? '\n…等' : ''}`;
    }
    if (!window.confirm(`${message}\n\n確定停用？所有歷史資料仍會保留。`)) return;
    try {
      const result = await invokeAppApi<{ removable: string[]; usedCount: number }>('area_save', { kind: 'deactivate_many', space_ids: removable.map(row => row.space_id) });
      notify(`已停用 ${result.removable.length} 筆${result.usedCount ? `，保留啟用 ${result.usedCount} 筆（已被標記）` : ''}`);
    } catch (error) { notify(`停用失敗：${translateError(error)}`, true); }
    await load();
  };

  /* ──────────────── QR／定位 ──────────────── */

  const openQr = async (space: Space) => {
    const url = `${location.origin}${LEGACY_BASE}/patrolcheckin.html?space=${encodeURIComponent(space.space_id)}`;
    try {
      setQr({ name: space.space_name, floor: space.floor, dataUrl: await qrDataUrl(url) });
    } catch (error) { notify(`QR 產生失敗：${translateError(error)}`, true); }
  };

  const locateSpace = (space: Space) => {
    const markerId = spaceMarker.get(space.space_id);
    if (!markerId) {
      window.alert('此空間尚未於平面圖標記，請先至「整合標記系統」新增標記後再定位。');
      return;
    }
    location.href = `${LEGACY_BASE}/b1_integrated_marker_system.html?marker=${encodeURIComponent(markerId)}`;
  };

  /* ──────────────── 匯出／範本／匯入 ──────────────── */

  const exportData = async () => {
    const body = floorsSorted.flatMap(floor => rows.filter(row => row.floor === floor)
      .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0))
        || String(a.space_name).localeCompare(String(b.space_name), 'zh-Hant'))
      .map(row => [row.floor, row.space_name, spaceUseText(row.space_id)]));
    try {
      await downloadAoa(`區域位置表_${todayStamp()}.xlsx`, '區域位置表',
        [['樓層', '空間名稱', '空間是否使用'], ...body]);
      notify('已匯出 XLSX');
    } catch (error) { notify(`匯出失敗：${translateError(error)}`, true); }
  };

  const downloadTemplate = async () => {
    try {
      await downloadAoa('區域位置表_匯入範本.xlsx', '區域位置表',
        [['樓層', '空間名稱'], ['B1', '配電室'], ['1F', '蔬菜零批場 A區'], ['2F', '辦公室']]);
    } catch (error) { notify(`範本下載失敗：${translateError(error)}`, true); }
  };

  const importAoa = async (aoa: string[][]) => {
    if (!aoa.length) { notify('檔案無資料', true); return; }
    // 判斷是否有標題列（首列含「樓層」／「空間」字樣）；沒有就當第 1、2 欄。
    const head = aoa[0].map(cell => String(cell || '').trim().replace(/^﻿/, ''));
    let floorCol = head.findIndex(cell => /樓層|floor/i.test(cell));
    let nameCol = head.findIndex(cell => /空間|名稱|space|name/i.test(cell));
    let start = 1;
    if (floorCol < 0 || nameCol < 0) { floorCol = 0; nameCol = 1; start = 0; }

    const seen = new Set<string>();
    const parsed: { line: number; floor: string; name: string; key: string }[] = [];
    const fileDup: { line: number; floor: string; name: string; key: string }[] = [];
    let invalidCount = 0;
    for (let index = start; index < aoa.length; index += 1) {
      const row = aoa[index] || [];
      // 整列皆空的列直接略過，不計入無效筆數（xlsx 常有結尾空白列）。
      if (!row.some(cell => String(cell ?? '').trim())) continue;
      const floor = canonicalFloor(row[floorCol]);
      const name = normSpaceName(row[nameCol]);
      if (!floor || !name) { invalidCount += 1; continue; }
      const key = importKey(floor, name);
      const item = { line: index + 1, floor, name, key };
      if (seen.has(key)) { fileDup.push(item); continue; }
      seen.add(key);
      parsed.push(item);
    }
    if (!parsed.length) { notify('未讀取到有效資料列', true); return; }

    const { data: latest, error } = await getSupabase().from('floor_spaces')
      .select('floor,space_name').eq('market_id', MARKET_ID);
    if (error) { notify(`匯入前檢查失敗：${translateError(error)}`, true); return; }
    const existing = new Set((latest || []).map(row => importKey(row.floor, row.space_name)));
    const existed = parsed.filter(item => existing.has(item.key));
    const payload = parsed.filter(item => !existing.has(item.key)).map(item => ({
      market_id: MARKET_ID, floor: item.floor, floor_order: floorOrder(item.floor), space_name: item.name,
    }));

    const summary = [
      '匯入前檢查結果', '',
      `檔案有效資料：${parsed.length + fileDup.length} 筆`,
      `檢查後不重複資料：${parsed.length} 筆`,
      `資料庫已存在（同樓層＋同空間名稱，不匯入）：${existed.length} 筆`,
      `檔案內重複（不匯入）：${fileDup.length} 筆`,
      `欄位空白或無效（不匯入）：${invalidCount} 筆`,
      `本次可新增：${payload.length} 筆`,
    ];
    if (existed.length) summary.push('', '已存在範例：', importSample(existed));
    if (fileDup.length) summary.push('', '檔案內重複範例：', importSample(fileDup));
    if (!payload.length) {
      window.alert([...summary, '', '沒有可新增資料，已停止匯入。'].join('\n'));
      notify('沒有可新增資料，已停止匯入', true);
      return;
    }
    summary.push('', `確認沒有問題後，才會匯入 ${payload.length} 筆新資料。`, '是否繼續？');
    if (!window.confirm(summary.join('\n'))) { notify('已取消匯入'); return; }

    // 已預先排除重複，用 insert 即可；分批送出避免單次請求過大。
    const chunkSize = 50;
    let inserted = 0;
    for (let index = 0; index < payload.length; index += chunkSize) {
      const chunk = payload.slice(index, index + chunkSize);
      try {
        await invokeAppApi('area_save', { kind: 'import', rows: chunk });
      } catch (error) {
        notify(`匯入失敗（已匯入 ${inserted} 筆後中斷）：${translateError(error)}`, true);
        await load();
        return;
      }
      inserted += chunk.length;
    }
    notify(`已匯入 ${payload.length} 筆，略過重複 ${existed.length + fileDup.length} 筆`);
    await load();
  };

  const onImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { await importAoa(await readFileAoa(file)); }
    catch (error) { notify(`匯入失敗：${translateError(error) || '請確認是 .xlsx 格式'}`, true); }
  };

  /* ──────────────── 畫面 ──────────────── */

  const useOptions = <>
    <option value="">全部使用狀態</option>
    <option value="used">已使用</option>
    <option value="unused">未使用</option>
  </>;

  return <AppShell profile={profile} title={module.title}>
    <div className="v1list-page arealist-page">
      <nav className="v1list-local-nav" aria-label="設備圖臺相關功能">
        <div className="v1list-nav-heading">
          <h1>區域位置表</h1>
          <p>各樓層平面空間名稱</p>
        </div>
        <div className="v1list-nav-links">
          <a href={`${LEGACY_BASE}/modeler.html?v=2`}>3D建模系統</a>
          <a href={`${LEGACY_BASE}/arealist.html`}>區域位置表</a>
          <a href={`${LEGACY_BASE}/b1_integrated_marker_system.html`}>整合標記系統</a>
          <a href={`${LEGACY_BASE}/admin.html`}>後台</a>
        </div>
      </nav>

      <p className="v1list-hint">
        每一列為單一「平面空間名稱」，以「樓層」區分。此表是整合標記系統的空間主檔來源，
        停用後歷史資料仍永久保留。
      </p>

      <div className="v1list-stats">
        <div className="v1list-stat">
          <div className="n">{new Set(rows.map(row => row.floor)).size}</div>
          <div className="l">樓層數</div>
        </div>
        <div className="v1list-stat">
          <div className="n">{rows.length}</div>
          <div className="l">空間總數</div>
        </div>
      </div>

      <div className="v1list-toolbar">
        <select value={floorFilter} onChange={event => setFloorFilter(event.target.value)} aria-label="樓層篩選">
          <option value="">全部樓層</option>
          {floorsSorted.map(floor => <option key={floor} value={floor}>{floor}</option>)}
        </select>
        <select value={useFilter} onChange={event => setUseFilter(event.target.value)} aria-label="使用狀態篩選">
          {useOptions}
        </select>
        <input value={query} onChange={event => setQuery(event.target.value)}
          placeholder="搜尋空間名稱…" aria-label="搜尋空間名稱" />
        <span className="v1list-space" />
        <button className="arealist-btn add"
          onClick={() => setEditor({ id: null, floor: floorFilter, name: '', message: '' })}>＋ 新增空間</button>
        <label className="arealist-btn blue">
          ⭳ 匯入XLSX
          <input type="file" accept=".xlsx" hidden onChange={event => void onImportFile(event)} />
        </label>
        <button className="arealist-btn green" onClick={() => void exportData()}>⭱ 匯出XLSX</button>
        <button className="arealist-btn" onClick={() => void downloadTemplate()}>範本</button>
        <button className="arealist-btn" onClick={() => void clearAll()}>全部停用</button>
      </div>

      {loadError && <div className="v1list-empty">{loadError}</div>}
      {!loadError && busy && !rows.length && <div className="v1list-empty">載入中…</div>}
      {!loadError && !busy && !filtered.length && <div className="v1list-empty">尚無資料，請「新增空間」或「匯入」。</div>}

      {!loadError && grouped.map(([floor, items]) => {
        const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        const page = Math.min(Math.max(floorPages.get(floor) || 1, 1), totalPages);
        const start = (page - 1) * PAGE_SIZE;
        const pageItems = items.slice(start, start + PAGE_SIZE);
        // 有任何篩選條件時一律展開，與 V1 相同——否則會搜尋到被摺疊起來的結果。
        const isCollapsed = !filterActive && collapsed.has(floor);
        return <section className="v1list-floor" key={floor}>
          <button type="button" className={`v1list-floor-head${isCollapsed ? ' collapsed' : ''}`}
            onClick={() => toggleFloor(floor)} aria-expanded={!isCollapsed}>
            <span className="caret">▼</span>
            <span className="fname">{floor}</span>
            <span className="fcount">{items.length} 個空間</span>
          </button>
          {!isCollapsed && <div className="v1list-floor-body">
            <div className="arealist-row-head">
              <span className="h-name">
                <span>空間名稱</span>
                <input className="name-filter" value={query} placeholder="篩選空間名稱…"
                  onChange={event => setQuery(event.target.value)} aria-label={`篩選 ${floor} 的空間名稱`} />
              </span>
              <span className="h-use">
                <span>空間是否使用</span>
                <select className="use-filter" value={useFilter}
                  onChange={event => setUseFilter(event.target.value)}
                  aria-label={`篩選 ${floor} 的使用狀態`}>{useOptions}</select>
              </span>
              <span className="h-act" />
            </div>
            {pageItems.map(space => {
              const checkin = lastCheckin.get(space.space_id);
              return <div className="v1list-row" key={space.space_id}>
                <span className="dot" />
                <span className="sname">
                  {space.space_name}
                  {checkin && <small>· 上次簽到 {fmtTime(checkin)}</small>}
                </span>
                <span className="use-col">
                  <span className={`use-pill${isSpaceUsed(space.space_id) ? ' used' : ''}`}>
                    {spaceUseText(space.space_id)}
                  </span>
                </span>
                <span className="acts">
                  <button className="mini" onClick={() => void openQr(space)}>QR</button>
                  <button className="mini" onClick={() => locateSpace(space)}>定位</button>
                  <button className="mini" onClick={() => setEditor({ id: space.space_id, floor: space.floor, name: space.space_name, message: '' })}>編輯</button>
                  <button className="mini del" onClick={() => void delSpace(space)}>停用</button>
                </span>
              </div>;
            })}
            <div className="arealist-pager">
              <span className="page-info">
                每頁 {PAGE_SIZE} 筆，目前 {items.length ? start + 1 : 0}-{Math.min(start + PAGE_SIZE, items.length)} 筆，共 {items.length} 筆，第 {page}/{totalPages} 頁
              </span>
              <button className="page-btn" disabled={page <= 1} onClick={() => setFloorPage(floor, page - 1)}>上一頁</button>
              <button className="page-btn" disabled={page >= totalPages} onClick={() => setFloorPage(floor, page + 1)}>下一頁</button>
            </div>
          </div>}
        </section>;
      })}

      {editor && <div className="v1list-modal-bg" role="dialog" aria-modal="true"
        aria-label={editor.id ? '編輯空間' : '新增空間'}>
        <div className="v1list-modal">
          <div className="v1list-modal-head">
            <span className="mt">{editor.id ? '編輯空間' : '新增空間'}</span>
            <button className="x" onClick={() => setEditor(null)} aria-label="關閉">✕</button>
          </div>
          <div className="arealist-modal-body">
            <div className="field">
              <label htmlFor="arealist-floor">樓層</label>
              <input id="arealist-floor" value={editor.floor} placeholder="如 B1 / 1F / RF"
                onChange={event => setEditor({ ...editor, floor: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="arealist-name">空間名稱</label>
              <input id="arealist-name" value={editor.name} placeholder="如 配電室"
                onChange={event => setEditor({ ...editor, name: event.target.value })} />
            </div>
            {editor.message && <div className="arealist-msg err">{editor.message}</div>}
            <button className="arealist-primary" onClick={() => void saveSpace()}>儲存</button>
          </div>
        </div>
      </div>}

      {qr && <div className="v1list-modal-bg" role="dialog" aria-modal="true" aria-label="空間 QR code">
        <div className="v1list-modal qr">
          <div className="v1list-modal-head">
            <span className="mt">空間 QR code</span>
            <button className="x" onClick={() => setQr(null)} aria-label="關閉">✕</button>
          </div>
          <div className="v1list-qr-body">
            <div className="qname">{qr.name}</div>
            <div className="qfloor">{qr.floor}</div>
            <div className="qbox"><img src={qr.dataUrl} alt={`${qr.floor} ${qr.name} 的簽到 QR code`} /></div>
            <button className="arealist-primary" onClick={() => window.print()}>🖶 列印</button>
          </div>
        </div>
      </div>}

      <div className={`arealist-toast${toast ? ' show' : ''}${toast?.error ? ' err' : ''}`} role="status">
        {toast?.text}
      </div>
    </div>
  </AppShell>;
}
