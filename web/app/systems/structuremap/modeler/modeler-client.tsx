'use client';

import Link from 'next/link';
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import type { Profile } from '@/types/app';
import './modeler.css';

type Point = [number, number];
type Polyline = Point[];
type BBox = { mnx: number; mny: number; mxx: number; mxy: number; w: number; h: number };
type DxfVertex = { x: number; y: number };
type DxfEntity = {
  type?: string;
  name?: string;
  vertices?: DxfVertex[];
  shape?: boolean;
  closed?: boolean;
  center?: DxfVertex;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  majorAxisEndPoint?: DxfVertex;
  axisRatio?: number;
  position?: DxfVertex;
  xScale?: number;
  yScale?: number;
  rotation?: number;
};
type DxfBlock = { position?: DxfVertex; entities?: DxfEntity[] };
type DxfDocument = { entities?: DxfEntity[]; blocks?: Record<string, DxfBlock> };
type FloorModel = { floor_id: string; name?: string | null; image_path?: string | null; bbox?: BBox | null; updated_at?: string | null };
type ModuleData = { rows: FloorModel[] };
type MessageTone = '' | 'ok' | 'err' | 'work';
type ParsedInfo = { fileName: string; groups: number; points: number; bbox: BBox; usingRef: boolean };

const TEXTURE_LONG_SIDE = 2400;
const MOBILE_TEXTURE_LONG_SIDE = 1024;

const FLOOR_OPTIONS = [
  ['B1', 'B1 地下一層'], ['1F', '1F 一樓'], ['2F', '2F 二樓'], ['3F', '3F 三樓'],
  ['4F', '4F 四樓'], ['5F', '5F 五樓'], ['__custom', '＋ 自訂樓層代號…'],
] as const;

function translateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/duplicate key value/i.test(message)) return '資料重複，請確認是否已存在';
  if (/null value in column/i.test(message)) return '必填欄位不可空白';
  if (/row-level security|permission denied|沒有.*權限|無操作權限/i.test(message)) return '無操作權限';
  if (/relation.*does not exist/i.test(message)) return '資料表不存在，請確認資料庫設定';
  if (/failed to fetch|networkerror|load failed|系統服務連線失敗/i.test(message)) return '網路連線失敗，請稍後再試';
  return '操作失敗，請稍後再試或聯絡系統管理員';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

function insertTransform(entity: DxfEntity) {
  const ox = entity.position?.x || 0;
  const oy = entity.position?.y || 0;
  const sx = entity.xScale || 1;
  const sy = entity.yScale || 1;
  const rotation = (entity.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return ([x, y]: Point): Point => {
    const scaledX = x * sx;
    const scaledY = y * sy;
    return [ox + scaledX * cos - scaledY * sin, oy + scaledX * sin + scaledY * cos];
  };
}

function sampleArc(cx: number, cy: number, radius: number, start: number, end: number): Polyline {
  const points: Polyline = [];
  const count = Math.max(8, Math.ceil((end - start) / (Math.PI / 24)));
  for (let index = 0; index <= count; index += 1) {
    const angle = start + (end - start) * index / count;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function entityPolylines(entity: DxfEntity): Polyline[] {
  const type = entity.type;
  if (type === 'LINE' && (entity.vertices?.length || 0) >= 2) {
    const [start, end] = entity.vertices!;
    return [[[start.x, start.y], [end.x, end.y]]];
  }
  if ((type === 'LWPOLYLINE' || type === 'POLYLINE') && entity.vertices?.length) {
    const points: Polyline = entity.vertices.map(vertex => [vertex.x, vertex.y]);
    if (entity.shape || entity.closed) points.push(points[0]);
    return [points];
  }
  if (type === 'CIRCLE' && entity.center && Number.isFinite(entity.radius)) {
    return [sampleArc(entity.center.x, entity.center.y, entity.radius!, 0, Math.PI * 2)];
  }
  if (type === 'ARC' && entity.center && Number.isFinite(entity.radius)) {
    let start = entity.startAngle || 0;
    let end = entity.endAngle || 0;
    if (Math.abs(start) > Math.PI * 2.01 || Math.abs(end) > Math.PI * 2.01) {
      start *= Math.PI / 180;
      end *= Math.PI / 180;
    }
    if (end < start) end += Math.PI * 2;
    return [sampleArc(entity.center.x, entity.center.y, entity.radius!, start, end)];
  }
  if (type === 'ELLIPSE' && entity.center) {
    const cx = entity.center.x;
    const cy = entity.center.y;
    const mx = entity.majorAxisEndPoint?.x || 0;
    const my = entity.majorAxisEndPoint?.y || 0;
    const major = Math.hypot(mx, my);
    const ratio = entity.axisRatio || 1;
    const rotation = Math.atan2(my, mx);
    const start = entity.startAngle || 0;
    const end = entity.endAngle ?? Math.PI * 2;
    const points: Polyline = [];
    for (let index = 0; index <= 64; index += 1) {
      const angle = start + (end - start) * index / 64;
      const x = major * Math.cos(angle);
      const y = major * ratio * Math.sin(angle);
      points.push([cx + x * Math.cos(rotation) - y * Math.sin(rotation), cy + x * Math.sin(rotation) + y * Math.cos(rotation)]);
    }
    return [points];
  }
  return [];
}

function collectEntities(
  entities: DxfEntity[], blocks: Record<string, DxfBlock>, transform: (point: Point) => Point,
  output: Polyline[], depth = 0,
) {
  if (depth > 6) return;
  for (const entity of entities) {
    if (entity.type === 'INSERT' && entity.name && blocks[entity.name]) {
      const block = blocks[entity.name];
      const applyInsert = insertTransform(entity);
      const bx = block.position?.x || 0;
      const by = block.position?.y || 0;
      collectEntities(block.entities || [], blocks, point => transform(applyInsert([point[0] - bx, point[1] - by])), output, depth + 1);
    } else {
      entityPolylines(entity).forEach(polyline => {
        if (polyline.length > 1) output.push(polyline.map(transform));
      });
    }
  }
}

function computeBBox(polylines: Polyline[]): BBox {
  let mnx = Number.POSITIVE_INFINITY;
  let mny = Number.POSITIVE_INFINITY;
  let mxx = Number.NEGATIVE_INFINITY;
  let mxy = Number.NEGATIVE_INFINITY;
  polylines.forEach(polyline => polyline.forEach(([x, y]) => {
    mnx = Math.min(mnx, x); mny = Math.min(mny, y); mxx = Math.max(mxx, x); mxy = Math.max(mxy, y);
  }));
  return { mnx, mny, mxx, mxy, w: mxx - mnx, h: mxy - mny };
}

function renderNeon(canvas: HTMLCanvasElement, polylines: Polyline[], bbox: BBox) {
  const padding = 40;
  const aspectRatio = bbox.w / bbox.h;
  let width: number;
  let height: number;
  if (aspectRatio >= 1) { width = TEXTURE_LONG_SIDE; height = Math.round(TEXTURE_LONG_SIDE / aspectRatio); }
  else { height = TEXTURE_LONG_SIDE; width = Math.round(TEXTURE_LONG_SIDE * aspectRatio); }
  canvas.width = width + padding * 2;
  canvas.height = height + padding * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(width / bbox.w, height / bbox.h);
  const pointX = (x: number) => padding + (x - bbox.mnx) * scale;
  const pointY = (y: number) => padding + (bbox.mxy - y) * scale;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  for (const pass of [{ width: 1.2, blur: 4, alpha: .5 }, { width: 0.6, blur: 1.5, alpha: .85 }, { width: 0.4, blur: 0, alpha: 1 }]) {
    context.strokeStyle = `rgba(94,234,255,${pass.alpha})`;
    context.lineWidth = pass.width;
    context.shadowColor = '#5eeaff';
    context.shadowBlur = pass.blur;
    polylines.forEach(polyline => {
      context.beginPath();
      polyline.forEach(([x, y], index) => index ? context.lineTo(pointX(x), pointY(y)) : context.moveTo(pointX(x), pointY(y)));
      context.stroke();
    });
  }
  context.shadowBlur = 0;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encode failed')), 'image/png'));
}

function makeMobileBlob(canvas: HTMLCanvasElement, maxSide: number) {
  return new Promise<Blob | null>(resolve => {
    try {
      const scale = maxSide / Math.max(canvas.width, canvas.height);
      if (scale >= 1) { resolve(null); return; }
      const mobileCanvas = document.createElement('canvas');
      mobileCanvas.width = Math.max(1, Math.round(canvas.width * scale));
      mobileCanvas.height = Math.max(1, Math.round(canvas.height * scale));
      const context = mobileCanvas.getContext('2d');
      if (!context) { resolve(null); return; }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(canvas, 0, 0, mobileCanvas.width, mobileCanvas.height);
      mobileCanvas.toBlob(blob => resolve(blob), 'image/png');
    } catch { resolve(null); }
  });
}

export function ModelerClient({ profile }: { profile: Profile }) {
  const [floorChoice, setFloorChoice] = useState('1F');
  const [customFloor, setCustomFloor] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: MessageTone }>({ text: '', tone: '' });
  const [parsedInfo, setParsedInfo] = useState<ParsedInfo | null>(null);
  const [savedModels, setSavedModels] = useState<FloorModel[] | null>(null);
  const [savedError, setSavedError] = useState(false);
  const [refBBox, setRefBBox] = useState<BBox | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastBlobRef = useRef<Blob | null>(null);
  const lastBBoxRef = useRef<BBox | null>(null);

  const currentFloor = useCallback(() => floorChoice === '__custom' ? (customFloor.trim().toUpperCase() || 'NEW') : floorChoice, [customFloor, floorChoice]);

  const loadModels = useCallback(async () => {
    try {
      const result = await invokeAppApi<ModuleData>('module_data', { system: 'structuremap', module: 'models' });
      const rows = [...(result.rows || [])].sort((a, b) => String(a.floor_id).localeCompare(String(b.floor_id), 'zh-TW'));
      setSavedModels(rows);
      setRefBBox(rows.find(row => row.floor_id === 'B1')?.bbox || null);
      setSavedError(false);
    } catch {
      setSavedModels([]);
      setSavedError(true);
    }
  }, []);

  useEffect(() => { void loadModels(); }, [loadModels]);

  async function handleFile(file: File) {
    if (!/\.dxf$/i.test(file.name)) { setMessage({ text: '請選擇 .dxf 檔', tone: 'err' }); return; }
    setMessage({ text: '解析 DXF…', tone: 'work' });
    try {
      const parserModule = await import('dxf-parser');
      const parser = new parserModule.default();
      const document = parser.parseSync(await file.text()) as unknown as DxfDocument | null;
      if (!document) throw new Error('DXF parse failed');
      const polylines: Polyline[] = [];
      collectEntities(document.entities || [], document.blocks || {}, point => point, polylines);
      if (!polylines.length) { setMessage({ text: '找不到可繪製的幾何（線/弧/聚合線）', tone: 'err' }); return; }
      const bbox = computeBBox(polylines);
      if (!Number.isFinite(bbox.w) || !Number.isFinite(bbox.h) || bbox.w <= 0 || bbox.h <= 0) throw new Error('Invalid drawing bounds');
      const usingRef = Boolean(refBBox && currentFloor() !== 'B1');
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas unavailable');
      renderNeon(canvas, polylines, usingRef ? refBBox! : bbox);
      lastBBoxRef.current = bbox;
      lastBlobRef.current = await canvasBlob(canvas);
      setParsedInfo({
        fileName: file.name,
        groups: polylines.length,
        points: polylines.reduce((sum, polyline) => sum + polyline.length, 0),
        bbox,
        usingRef,
      });
      setMessage({ text: '解析完成，可按「更新模型」', tone: 'ok' });
    } catch (error) {
      lastBlobRef.current = null;
      lastBBoxRef.current = null;
      setMessage({ text: `解析失敗：${translateError(error)}`, tone: 'err' });
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  async function saveModel() {
    const originalBlob = lastBlobRef.current;
    const bbox = lastBBoxRef.current;
    const canvas = canvasRef.current;
    if (!originalBlob || !bbox || !canvas) { setMessage({ text: '請先上傳 DXF', tone: 'err' }); return; }
    const floor = currentFloor();
    if (!floor) { setMessage({ text: '請選擇樓層', tone: 'err' }); return; }
    setSaving(true);
    setMessage({ text: '上傳中…', tone: 'work' });
    try {
      const path = `${floor}.png`;
      const storage = getSupabase().storage.from('floorplans');
      const upload = await storage.upload(path, originalBlob, { upsert: true, contentType: 'image/png' });
      if (upload.error) throw upload.error;
      let mobileNote = '';
      try {
        const mobileBlob = await makeMobileBlob(canvas, MOBILE_TEXTURE_LONG_SIDE);
        if (mobileBlob) {
          const mobileUpload = await storage.upload(`mobile/${path}`, mobileBlob, { upsert: true, contentType: 'image/png' });
          if (mobileUpload.error) throw mobileUpload.error;
          mobileNote = `，手機版 ${Math.round(mobileBlob.size / 1024)}KB`;
        }
      } catch (error) {
        console.warn('mobile texture upload failed, viewers will fall back to the full-size image', error);
        mobileNote = '（手機版縮圖上傳失敗，手機將載入原圖）';
      }
      const optionLabel = FLOOR_OPTIONS.find(option => option[0] === floorChoice)?.[1] || floor;
      await invokeAppApi('save_floor_model', {
        floor_id: floor,
        name: floorChoice === '__custom' ? floor : optionLabel,
        image_path: path,
        bbox,
      });
      if (floor === 'B1') setRefBBox(bbox);
      setMessage({ text: `✓ 已更新 ${floor} 模型，平面圖與 3D 已同步${mobileNote}`, tone: 'ok' });
      await loadModels();
    } catch (error) {
      console.error('Save Model Error:', error);
      setMessage({ text: `儲存失敗：${translateError(error)}（請確認已建立 floor_models 表與 floorplans 儲存桶）`, tone: 'err' });
    } finally { setSaving(false); }
  }

  const canOpen = profile.allowed_systems.includes('*') || profile.allowed_systems.includes('structuremap');
  if (!canOpen) return <AppShell profile={profile} title="3D建模系統"><p className="modeler-denied">目前角色沒有設備圖臺權限</p></AppShell>;

  return <AppShell profile={profile} title="3D建模系統">
    <div className="modeler-page">
      <nav className="modeler-local-nav" aria-label="3D建模相關功能">
        <div className="modeler-nav-heading">
          <h1>3D建模系統</h1>
          <p>上傳 DXF → 更新樓層平面圖 + 3D 立體模型</p>
        </div>
        <div className="modeler-nav-links">
          <Link href="/systems/structuremap/modeler/">3D建模系統</Link>
          <Link href="/systems/structuremap/areas/">區域位置表</Link>
          <Link href="/systems/structuremap/markers/">整合標記系統</Link>
          <Link href="/systems/structuremap/models/">← 返回上一層</Link>
        </div>
      </nav>

      <div className="modeler-layout">
        <section className="modeler-card modeler-controls">
          <h2>上傳設定</h2>
          <label htmlFor="modeler-floor">選擇樓層</label>
          <select id="modeler-floor" value={floorChoice} onChange={event => setFloorChoice(event.target.value)}>
            {FLOOR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {floorChoice === '__custom' && <input
            type="text" value={customFloor} onChange={event => setCustomFloor(event.target.value)}
            placeholder="自訂樓層代號（如 R1 / B2）" aria-label="自訂樓層代號"
          />}

          <label>DXF 檔案（單位 mm）</label>
          <div
            className={`modeler-drop${dragging ? ' over' : ''}`}
            role="button" tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click(); }}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            點此選擇或拖曳 DXF 檔<br /><span>.dxf</span>
            <input ref={fileInputRef} type="file" accept=".dxf" onChange={onFileChange} hidden />
          </div>

          {parsedInfo && <div className="modeler-stat modeler-file-stat">
            檔名：<b>{parsedInfo.fileName}</b><br />
            線段群組：<b>{parsedInfo.groups}</b>　頂點：<b>{parsedInfo.points}</b><br />
            範圍：<b>{Math.round(parsedInfo.bbox.w)}</b> × <b>{Math.round(parsedInfo.bbox.h)}</b> mm
            {parsedInfo.usingRef && <><br /><span>已依標準框（B1）繪製，非本檔案原始比例</span></>}
          </div>}
          <button className="modeler-button modeler-button-primary" disabled={!lastBlobRef.current || saving} onClick={() => void saveModel()}>▲ 更新模型</button>
          <div className={`modeler-message ${message.tone}`} role="status">{message.text}</div>

          <h2 className="modeler-saved-title">已建立的樓層模型</h2>
          <div className="modeler-saved-list">
            {savedModels === null && <div className="modeler-stat">載入中…</div>}
            {savedError && <div className="modeler-stat modeler-saved-error">尚未建立 floor_models 表<br /><small>請先執行 system/sql/floor_models.sql</small></div>}
            {!savedError && savedModels?.length === 0 && <div className="modeler-stat">尚無樓層模型</div>}
            {!savedError && savedModels?.map(model => <div className="modeler-saved-item" key={model.floor_id}>
              <span className="modeler-dot" /><span className="modeler-floor-id">{model.floor_id}</span>
              <span>{model.name || ''}</span><time>{formatDateTime(model.updated_at)}</time>
            </div>)}
          </div>

          <div className="modeler-links">
            <Link href="/systems/structuremap/floor3d/">開啟 3D 立體模型</Link>
            <Link href="/systems/structuremap/floor2d/">開啟平面圖</Link>
          </div>
          <div className="modeler-hint">
            ※ DXF 在瀏覽器即時解析渲染，更新後 3D 模型與平面圖會自動載入新版本。<br />
            ※ 建議各樓層使用<b>相同座標系</b>的 DXF，立體疊合才會對齊。<br />
            ※ 標準繪圖框：<b>{refBBox ? `${Math.round(refBBox.w)} × ${Math.round(refBBox.h)} mm（來自 B1）` : '尚未設定（將以 B1 為準）'}</b>
          </div>
        </section>

        <section className="modeler-card modeler-preview-card" aria-label="DXF 預覽">
          <div className="modeler-preview">
            {!parsedInfo && <div className="modeler-placeholder">選擇樓層並上傳 DXF<br />即可在此預覽霓虹平面圖</div>}
            <canvas ref={canvasRef} className={parsedInfo ? 'visible' : ''} />
          </div>
        </section>
      </div>
    </div>
  </AppShell>;
}
