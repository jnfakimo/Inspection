'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { BrowserMultiFormatOneDReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Department = { dept_id: string; parent_id?: string | null; name: string; code?: string | null; level?: number | null };
type Person = { user_id: string; name: string; dept_id?: string | null; role?: string | null; rbac_role?: string | null; department?: string | null; department_root?: string | null; department_root_id?: string | null; department_level?: number | null };
type Step = { step_id: string; step_no: number; step_type: 'co_sign' | 'approval'; unit_id: string; unit_name: string; status: string; sent_by?: string | null; sent_at?: string | null; received_by?: string | null; received_at?: string | null; completed_by?: string | null; completed_at?: string | null; note?: string | null };
type Event = { event_id: string; step_id?: string | null; action: string; from_status?: string | null; to_status?: string | null; actor_id?: string | null; actor_name?: string | null; actor_role?: string | null; actor_dept_name?: string | null; target_unit_id?: string | null; note?: string | null; occurred_at: string };
type Document = { document_id: string; document_no: string; document_type?: string | null; subject: string; originator_id: string; originator_dept_id?: string | null; responsible_dept_id?: string | null; responsible_user_id?: string | null; originator_name?: string | null; originator_department?: string | null; originator_root_department?: string | null; originator_root_department_id?: string | null; status: string; current_step_id?: string | null; barcode_value?: string | null; created_at: string; updated_at: string; closed_at?: string | null; steps: Step[]; events: Event[] };
type OfficialData = { documents: Document[]; departments: Department[]; scope_root_departments?: Department[]; current_root_department?: Department | null; actor_supervisor_dept_id?: string | null; people: Person[] };

const DOCUMENT_PAGE_SIZE = 5;
const DOCUMENT_TYPE_LABELS: Record<string, string> = { official_document: '公文', purchase_order: '採購單', other: '其他' };

const STATUS_LABELS: Record<string, string> = {
  draft: '待送出', awaiting_co_sign: '待會辦收文', ready_for_next: '會辦完成／待選下一站', awaiting_approval: '待陳核簽收／核決', awaiting_originator: '待創文單位簽收', returned: '已退回待補正', closed: '已結案',
};
const STEP_STATUS_LABELS: Record<string, string> = { sent: '待收文', received: '已收文／待完成', completed: '已完成', returned: '已退回' };
const ACTION_LABELS: Record<string, string> = {
  create: '建立公文', barcode_generated: '產生文號', send_co_sign: '送出會辦', receive: '收文', co_sign_complete: '會辦完成', send_approval: '送出陳核', approval_receive: '陳核簽收', approve: '核決完成', return: '退回補正', resubmit: '補正重送', originator_receive: '創文單位簽收',
};
const ROLE_LABELS: Record<string, string> = { sysadmin: '系統管理員', admin: '系統管理員', dispatcher: '公文管理人員', duty: '收發人員', unit_supervisor: '單位主管', mgmt_supervisor: '管理部主管', reporter: '一般使用者', technician: '一般使用者' };
const statusLabel = (value: unknown) => STATUS_LABELS[String(value)] || '流程狀態';
const stepStatusLabel = (value: unknown) => STEP_STATUS_LABELS[String(value)] || '流程中';
const actionLabel = (value: unknown) => ACTION_LABELS[String(value)] || '流程事件';
const roleLabel = (value: unknown) => ROLE_LABELS[String(value)] || '系統角色';
const departmentLevelLabel = (value: unknown) => Number(value) >= 2 ? '課／組／隊' : '部／室';
const departmentParts = (person: Person) => {
  const parts = text(person.department).split(/\s*\/\s*/).filter(Boolean);
  const root = text(person.department_root) || parts[0] || '—';
  const child = parts.length > 1 ? parts.slice(1).join(' / ') : '—';
  return { root, child };
};
const fmtTime = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
};
const text = (value: unknown) => String(value ?? '').trim();
const departmentScope = (rows: Department[], rootId: unknown) => {
  const root = text(rootId);
  const scope = new Set<string>();
  if (!root) return scope;
  scope.add(root);
  let changed = true;
  while (changed) {
    changed = false;
    rows.forEach(row => {
      const deptId = text(row.dept_id);
      const parentId = text(row.parent_id);
      if (deptId && parentId && scope.has(parentId) && !scope.has(deptId)) {
        scope.add(deptId);
        changed = true;
      }
    });
  }
  return scope;
};
const officialDocumentsAccess = (profile: Profile) => {
  const allowedSystems = profile.allowed_systems || [];
  return allowedSystems.includes('*') || allowedSystems.includes('officialdocs');
};
const APPROVAL_UNIT_CODES = new Set(['BOARD', 'GM', 'VGM', 'SECRE']);
const APPROVAL_UNIT_NAMES = new Set(['董事長室', '總經理室', '副總經理', '副總經理室', '秘書室']);
const SECRETARY_UNIT_CODES = new Set(['SECRE']);
const SECRETARY_UNIT_NAMES = new Set(['秘書室']);
const DEPUTY_GM_UNIT_CODES = new Set(['VGM']);
const DEPUTY_GM_UNIT_NAMES = new Set(['副總經理', '副總經理室']);
const unitCapabilities = (department?: Department) => {
  const code = text(department?.code).toUpperCase();
  const name = text(department?.name).replace(/\s+/g, '');
  const isSecretary = code === 'SECRE' || name === '秘書室';
  const canApprove = APPROVAL_UNIT_CODES.has(code) || APPROVAL_UNIT_NAMES.has(name);
  return { canApprove, canCoSign: !canApprove || isSecretary };
};
const namedDepartment = (department: Department | null | undefined, codes: Set<string>, names: Set<string>) => {
  const code = text(department?.code).toUpperCase();
  const name = text(department?.name).replace(/\s+/g, '');
  return Boolean((code && codes.has(code)) || (name && names.has(name)));
};
const CODE39_PATTERNS: Record<string, string> = {
  '0': '101001101101', '1': '110100101011', '2': '101100101011', '3': '110110010101', '4': '101001101011',
  '5': '110100110101', '6': '101100110101', '7': '101001011011', '8': '110100101101', '9': '101100101101',
  'A': '110101001011', 'B': '101101001011', 'C': '110110100101', 'D': '101011001011', 'E': '110101100101',
  'F': '101101100101', 'G': '101010011011', 'H': '110101001101', 'I': '101101001101', 'J': '101011001101',
  'K': '110101010011', 'L': '101101010011', 'M': '110110101001', 'N': '101011010011', 'O': '110101101001',
  'P': '101101101001', 'Q': '101010110011', 'R': '110101011001', 'S': '101101011001', 'T': '101011011001',
  'U': '110010101011', 'V': '100110101011', 'W': '110011010101', 'X': '100101101011', 'Y': '110010110101',
  'Z': '100110110101', '-': '100101011011', '.': '110010101101', ' ': '100110101101', '$': '100100100101',
  '/': '100100101001', '+': '100101001001', '%': '101001001001', '*': '100101101101',
};

function barcodeDateLabel(textValue: string) {
  const value = String(textValue || '');
  return /^\d{11}$/.test(value) ? `${value.slice(0, 3)}/${value.slice(3, 5)}/${value.slice(5, 7)}` : '';
}

function makeBarcode(textValue: string) {
  const value = String(textValue || '').toUpperCase().replace(/[^0-9A-Z .\-$/+%]/g, '-').slice(0, 40);
  const encoded = `*${value}*`;
  const module = Math.min(3.8, 660 / (encoded.length * 13));
  let x = 24;
  const bars: string[] = [];
  encoded.split('').forEach(character => {
    const pattern = CODE39_PATTERNS[character] || CODE39_PATTERNS['-'];
    pattern.split('').forEach(bit => {
      if (bit === '1') bars.push(`<rect x="${x.toFixed(2)}" y="62" width="${module.toFixed(2)}" height="112" fill="#111827"/>`);
      x += module;
    });
    x += module;
  });
  const dateLabel = barcodeDateLabel(value);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 709 236"><rect width="709" height="236" fill="#ffffff"/><text x="354.5" y="43" text-anchor="middle" font-family="serif" font-size="34" fill="#111827">${dateLabel}</text>${bars.join('')}<text x="354.5" y="220" text-anchor="middle" font-family="serif" font-size="32" letter-spacing="3" fill="#111827">${value}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// 即時掃描與拍照辨識共用同一組格式設定：公文條碼是 Code 39，其餘一維格式一併開著備用。
function createOneDReader() {
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_93,
      BarcodeFormat.EAN_8,
      BarcodeFormat.EAN_13,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  return new BrowserMultiFormatOneDReader(hints, { delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 1000 });
}

// 有相機權限不代表真的有影像：等到 video 送出第一張影格（videoWidth > 0）才算開啟成功。
async function waitForFirstFrame(video: HTMLVideoElement, isActive: () => boolean, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isActive()) return false;
    if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2 && !video.paused) return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

function Scanner({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [message, setMessage] = useState('正在啟動相機掃描…');
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [preferredDeviceId, setPreferredDeviceId] = useState('');
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);
  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let controls: IScannerControls | null = null;
    const start = async () => {
      setMessage(cameraAttempt ? '正在重新啟動相機掃描…' : '正在啟動相機掃描…');
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage('此瀏覽器不支援相機功能，請改用手動查詢。');
        return;
      }
      try {
        const reader = createOneDReader();
        const video = videoRef.current;
        if (!video) return;
        // 公文條碼是印在紙上的 Code 39，解析度直接決定每根窄條有幾個像素。
        // 1280 在手機上常常只夠勉強，改要 1920 讓細條不會糊在一起。
        const videoSettings = { width: { ideal: 1920 }, height: { ideal: 1080 } };
        if (preferredDeviceId) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { ...videoSettings, deviceId: { exact: preferredDeviceId } }, audio: false });
        } else {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { ...videoSettings, facingMode: { exact: 'environment' } }, audio: false });
          } catch (error) {
            const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
            if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError' && name !== 'NotFoundError') throw error;
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
            const rearPattern = /(back|rear|environment|後|背面)/i;
            const frontPattern = /(front|user|前)/i;
            const rearCamera = devices.find(device => rearPattern.test(device.label) && !frontPattern.test(device.label)) || devices.at(-1);
            const currentDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || '';
            if (rearCamera?.deviceId && rearCamera.deviceId !== currentDeviceId) {
              stream.getTracks().forEach(track => track.stop());
              stream = await navigator.mediaDevices.getUserMedia({ video: { ...videoSettings, deviceId: { exact: rearCamera.deviceId } }, audio: false });
            }
          }
        }
        if (!active) { stream.getTracks().forEach(track => track.stop()); return; }
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
        if (active) {
          setCameraDevices(devices);
          setActiveDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId || '');
        }
        // 近距離拍紙本條碼最怕失焦。連續對焦不是每個瀏覽器都支援（Safari 目前就不支援），
        // 支援的就開，不支援沿用系統預設對焦，兩種情況都不影響掃描。
        try {
          // focusMode 還沒進 TypeScript 的 MediaTrackConstraintSet，只能繞過型別。
          await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as unknown as MediaTrackConstraints);
        } catch (error) {
          console.info('[official-docs] continuous focus is not supported on this device', error);
        }
        video.setAttribute('webkit-playsinline', 'true');
        video.srcObject = stream;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        try { await video.play(); } catch (error) { console.warn('[official-docs] camera preview autoplay was blocked', error); }
        setMessage('請允許相機權限，並將公文文號置於掃描框內。');
        // 串流交給 ZXing 前先自己掛上並播放，這裡改用 decodeFromVideoElement：
        // decodeFromStream 會再指派一次同一個 srcObject，iOS 上重複指派會讓畫面停在載入中。
        controls = await reader.decodeFromVideoElement(
          video,
          (result, _error, scanControls) => {
            controlsRef.current = scanControls;
            if (!active || !result) return;
            const value = result.getText().trim();
            if (!value) return;
            active = false;
            scanControls.stop();
            onDetectedRef.current(value);
          },
        );
        controlsRef.current = controls;
        if (!active) { controls.stop(); return; }
        // 有權限不等於有畫面：iOS 主畫面捷徑與部分 App 內建瀏覽器會給出串流卻永遠不送影格。
        // 一定要等到真的有影格（videoWidth > 0）才敢說「鏡頭已開啟」，否則就是讓畫面對使用者說謊。
        const hasFrame = await waitForFirstFrame(video, () => active);
        if (!active) { controls.stop(); return; }
        if (hasFrame) { setMessage('鏡頭已開啟，請將公文文號置於掃描框內。'); return; }
        const track = stream.getVideoTracks()[0];
        console.warn('[official-docs] camera stream produced no video frame', {
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          paused: video.paused,
          trackReadyState: track?.readyState,
          trackMuted: track?.muted,
          standalone: typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        });
        setMessage('相機已授權但沒有影像。若你是從主畫面捷徑或 App 內建瀏覽器（LINE／Facebook）開啟，請改用 Safari 或 Chrome 直接開啟本頁；也可以點畫面或按「重新啟動相機」再試一次。');
      } catch (error) {
        if (!active) return;
        stream?.getTracks().forEach(track => track.stop());
        const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
        const fallback = name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? '相機權限被拒絕，請在瀏覽器網址列允許相機後重試。'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? '找不到可用相機，請確認裝置已連接。'
            : name === 'NotReadableError' || name === 'TrackStartError'
              ? '相機可能正被其他程式使用，請關閉其他相機程式後重試。'
              : '無法啟動相機掃描，請改用手動查詢。';
        console.error('[official-docs] ZXing camera scanner failed', error);
        setMessage(fallback);
      }
    };
    void start();
    return () => { active = false; controlsRef.current?.stop(); controls?.stop(); stream?.getTracks().forEach(track => track.stop()); controlsRef.current = null; };
  }, [cameraAttempt, preferredDeviceId]);
  const switchCamera = () => {
    if (cameraDevices.length < 2) return;
    const currentIndex = cameraDevices.findIndex(device => device.deviceId === activeDeviceId);
    const next = cameraDevices[(currentIndex + 1 + cameraDevices.length) % cameraDevices.length];
    if (next?.deviceId) setPreferredDeviceId(next.deviceId);
  };
  // 即時影像受限於對焦與手震，紙本條碼常常掃不到；改拍一張照片交給系統相機，
  // 拿到的是對焦完成的高解析靜態影像，辨識率比連續掃描高得多。
  const decodePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    setMessage('正在辨識照片…');
    const url = URL.createObjectURL(file);
    try {
      const result = await createOneDReader().decodeFromImageUrl(url);
      const value = result.getText().trim();
      if (value) { onDetectedRef.current(value); return; }
      setMessage('照片裡沒有讀到條碼，請靠近一點讓條碼填滿畫面，再拍一次。');
    } catch (error) {
      console.warn('[official-docs] photo barcode decode failed', error);
      setMessage('照片裡沒有讀到條碼，請靠近一點讓條碼填滿畫面、避開反光，再拍一次。');
    } finally {
      URL.revokeObjectURL(url);
      setPhotoBusy(false);
    }
  };
  return <div className="od-modal-backdrop" role="dialog" aria-modal="true" aria-label="掃描公文文號"><section className="od-scanner-modal"><header><div><small>查詢工具／文號</small><h2>掃描公文文號</h2></div><button type="button" className="od-icon-button" onClick={onClose} aria-label="關閉">×</button></header><div className="od-scanner-preview" onClick={() => { const video = videoRef.current; if (video?.paused) void video.play().catch(error => console.warn('[official-docs] camera preview play was blocked', error)); }}><video ref={videoRef} className="od-scanner-video" muted autoPlay playsInline /><span className="od-scanner-guide" aria-hidden="true" /></div><p className="od-help">{message}</p><div className="od-modal-actions"><input ref={photoInputRef} type="file" accept="image/*" capture="environment" hidden onChange={decodePhoto} /><button type="button" className="primary-btn" disabled={photoBusy} onClick={() => photoInputRef.current?.click()}>{photoBusy ? '辨識中…' : '拍照辨識'}</button>{cameraDevices.length > 1 && <button type="button" className="secondary-btn" onClick={switchCamera}>切換鏡頭</button>}<button type="button" className="secondary-btn" onClick={() => setCameraAttempt(value => value + 1)}>重新啟動相機</button><button type="button" className="secondary-btn" onClick={onClose}>關閉掃描</button></div></section></div>;
}

function QrModal({ document, onClose }: { document: Document; onClose: () => void }) {
  const [image, setImage] = useState('');
  useEffect(() => { let active = true; if (document.barcode_value) { const value = makeBarcode(document.barcode_value); if (active) setImage(value); } return () => { active = false; }; }, [document.barcode_value]);
  const print = () => window.print();
  const download = () => {
    if (!image) return;
    const source = new Image();
    source.onload = () => {
      const canvas = window.document.createElement('canvas');
      canvas.width = 709; canvas.height = 236;
      canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
      const link = window.document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${document.document_no}-公文文號.png`;
      link.click();
    };
    source.src = image;
  };
  return <div className="od-modal-backdrop" role="dialog" aria-modal="true" aria-label="公文文號"><section className="od-qr-modal"><header><div><small>文號查詢</small><h2>{document.document_no}</h2></div><button type="button" className="od-icon-button" onClick={onClose} aria-label="關閉">×</button></header><p className="od-qr-subject">{document.subject}</p>{image ? <img className="od-barcode-image" src={image} alt={`公文 ${document.document_no} 文號查詢`} /> : <p className="od-help">文號產生中…</p>}<code className="od-barcode-value">{document.barcode_value || '—'}</code><div className="od-modal-actions"><button type="button" className="secondary-btn" onClick={download} disabled={!image}>下載圖片</button><button type="button" className="primary-btn" onClick={print}>列印文號</button><button type="button" className="secondary-btn" onClick={onClose}>關閉</button></div></section></div>;
}

export function OfficialDocsWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => <OfficialDocsPage profile={profile} system={system} module={module} />}</AuthGate>;
}

function OfficialDocsPage({ profile, system, module }: { profile: Profile; system: SystemDefinition; module: ModuleDefinition }) {
  const [data, setData] = useState<OfficialData | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [lookup, setLookup] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [scanner, setScanner] = useState(false);
  const [qrDocument, setQrDocument] = useState<Document | null>(null);
  const [form, setForm] = useState({ document_no: '', document_type: 'official_document', subject: '', root_department_id: '', responsible_dept_id: '', responsible_user_id: '' });
  const [targetUnit, setTargetUnit] = useState('');
  const [documentPage, setDocumentPage] = useState(1);
  const selected = data?.documents.find(document => document.document_id === selectedId) || data?.documents[0] || null;
  // 公文頁本身已由 SYS-09 存取權限保護；具此權限的人員可以建立公文，
  // 並在自己所屬或已參與的流程範圍內選擇下一個第一階部／室。
  const canManage = officialDocumentsAccess(profile);
  const canViewPeople = false;
  const [peopleNameFilter, setPeopleNameFilter] = useState('');
  const [peopleRootFilter, setPeopleRootFilter] = useState('');
  const [peopleChildFilter, setPeopleChildFilter] = useState('');
  const [peopleRoleFilter, setPeopleRoleFilter] = useState('');
  const [peoplePage, setPeoplePage] = useState(1);
  const peopleRows: Person[] = [];
  const pagedPeople: Person[] = [];
  const peoplePageCount = 1;
  const peopleNameOptions: string[] = [];
  const peopleRootOptions: string[] = [];
  const peopleChildOptions: string[] = [];
  const peopleRoleOptions: string[] = [];

  const load = useCallback(async (search = '') => {
    setLoading(true);
    try {
      const result = await invokeAppApi<OfficialData>('official_documents', { lookup: search });
      setData(result);
      setDocumentPage(1);
      setSelectedId(current => result.documents.some(document => document.document_id === current) ? current : result.documents[0]?.document_id || '');
      setNote('');
    } catch (error) { setNote(error instanceof Error ? error.message : '公文資料載入失敗'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(''); }, [load]);

  const departmentOptions = useMemo(() => {
    const rows = [...(data?.departments || []), ...(data?.scope_root_departments || []), ...(data?.current_root_department ? [data.current_root_department] : [])];
    const seen = new Set<string>();
    return rows.filter(department => {
      if (department.parent_id || seen.has(department.dept_id)) return false;
      seen.add(department.dept_id);
      return true;
    }).map(department => ({ value: department.dept_id, label: department.code ? `${department.name}（${department.code}）` : department.name, ...unitCapabilities(department) }));
  }, [data?.current_root_department, data?.departments, data?.scope_root_departments]);
  const selectedTarget = departmentOptions.find(option => option.value === targetUnit);
  const rootDepartments = useMemo(() => data?.current_root_department ? [data.current_root_department] : (data?.scope_root_departments || []).filter(department => !department.parent_id), [data?.current_root_department, data?.scope_root_departments]);
  const childDepartments = useMemo(() => (data?.departments || []).filter(department => department.parent_id === form.root_department_id), [data?.departments, form.root_department_id]);
  const responsiblePeople = useMemo(() => (data?.people || []).filter(person => person.dept_id === form.responsible_dept_id), [data?.people, form.responsible_dept_id]);
  // 已完成會辦的公文仍要留在清單，讓流程參與者直接看到下一站選單。
  const visibleDocuments = useMemo(() => data?.documents || [], [data?.documents]);
  const documentPageCount = Math.max(1, Math.ceil(visibleDocuments.length / DOCUMENT_PAGE_SIZE));
  const pagedDocuments = useMemo(() => visibleDocuments.slice((documentPage - 1) * DOCUMENT_PAGE_SIZE, documentPage * DOCUMENT_PAGE_SIZE), [visibleDocuments, documentPage]);
  useEffect(() => { if (documentPage > documentPageCount) setDocumentPage(documentPageCount); }, [documentPage, documentPageCount]);
  useEffect(() => {
    const rootId = data?.current_root_department?.dept_id || rootDepartments[0]?.dept_id || '';
    setForm(current => current.root_department_id ? current : { ...current, root_department_id: rootId });
  }, [data?.current_root_department?.dept_id, rootDepartments]);
  const perform = async (documentAction: string, payload: Record<string, unknown> = {}) => {
    if (!selected) return;
    setSaving(true); setNote('');
    try {
      await invokeAppApi('official_document_action', { document_id: selected.document_id, document_action: documentAction, target_unit_id: payload.target_unit_id || undefined, note: payload.note || undefined, idempotency_key: `${selected.document_id}:${documentAction}:${crypto.randomUUID()}` });
      setNote(`${actionLabel(documentAction)}已完成`);
      await load(lookup);
    } catch (error) { setNote(error instanceof Error ? error.message : '流程操作失敗'); }
    finally { setSaving(false); }
  };
  const openBarcode = async () => {
    if (!selected) return;
    if (selected.barcode_value) { setQrDocument(selected); return; }
    setSaving(true); setNote('');
    try {
      const result = await invokeAppApi<{ barcode_value?: string }>('official_document_action', { document_id: selected.document_id, document_action: 'barcode_generate', idempotency_key: `${selected.document_id}:barcode_generate:${crypto.randomUUID()}` });
      const barcodeValue = text(result.barcode_value) || selected.document_no;
      setQrDocument({ ...selected, barcode_value: barcodeValue });
      setNote('文號已產生，可直接列印或下載');
      await load(lookup);
    } catch (error) { setNote(error instanceof Error ? error.message : '文號產生失敗'); }
    finally { setSaving(false); }
  };
  const createDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.subject.trim()) { setNote('請填寫公文主旨'); return; }
    if (!form.responsible_dept_id || !form.responsible_user_id) { setNote('請選擇課／組／隊與承辦人員'); return; }
    setSaving(true); setNote('');
    try {
      const result = await invokeAppApi<{ document_id: string }>('official_document_create', form);
      const usedManualNumber = Boolean(form.document_no.trim());
      setForm(current => ({ ...current, document_no: '', subject: '', responsible_dept_id: '', responsible_user_id: '' }));
      setNote(usedManualNumber ? '文件已依輸入文號建立，請選擇下一個會辦或陳核部／室送出' : '文件已建立並自動取號，請選擇下一個會辦或陳核部／室送出');
      await load('');
      setSelectedId(result.document_id);
    } catch (error) { setNote(error instanceof Error ? error.message : '公文建立失敗'); }
    finally { setSaving(false); }
  };
  const onScanned = useCallback((value: string) => { setScanner(false); setLookup(value); void load(value); }, [load]);
  const currentStep = selected?.steps.find(step => step.step_id === selected.current_step_id) || null;
  const currentUnit = String(profile.dept_id || '');
  // 流程節點記錄第一階部／室，但使用者可能掛在其下的課／組／隊；
  // 合併目前可見的根單位與子單位資料後，沿部門樹判斷是否為收文範圍。
  const visibleDepartmentRows = [
    ...(data?.departments || []),
    ...(data?.scope_root_departments || []),
    ...(data?.current_root_department ? [data.current_root_department] : []),
  ];
  const sameUnit = Boolean(currentStep && currentUnit && departmentScope(visibleDepartmentRows, currentStep.unit_id).has(currentUnit));
  const rootDepartment = (deptId: unknown) => {
    let current = text(deptId);
    const seen = new Set<string>();
    let row: Department | null = null;
    while (current && !seen.has(current)) {
      seen.add(current);
      row = visibleDepartmentRows.find(item => item.dept_id === current) || null;
      const parent = text(row?.parent_id);
      if (!parent) return row;
      current = parent;
    }
    return row;
  };
  const delegatedApprovalReceiver = Boolean(
    currentStep?.step_type === 'approval'
    && namedDepartment(rootDepartment(currentUnit), SECRETARY_UNIT_CODES, SECRETARY_UNIT_NAMES)
    && namedDepartment(rootDepartment(currentStep.unit_id), DEPUTY_GM_UNIT_CODES, DEPUTY_GM_UNIT_NAMES)
    && data?.actor_supervisor_dept_id
    && departmentScope(visibleDepartmentRows, currentStep.unit_id).has(data.actor_supervisor_dept_id),
  );
  const canReceiveCurrentStep = sameUnit || delegatedApprovalReceiver;
  const inOriginatorUnit = Boolean(selected?.originator_root_department_id && data?.current_root_department?.dept_id
    && selected.originator_root_department_id === data.current_root_department.dept_id);
  const latestEvent = selected?.events[selected.events.length - 1];
  const currentRootName = text(data?.current_root_department?.name) || '尚未設定';
  const currentStatusText = selected?.status === 'awaiting_originator'
    ? `${selected.originator_root_department || '創文單位'}｜待創文單位簽收`
    : currentStep ? `${currentStep.unit_name}｜${stepStatusLabel(currentStep.status)}` : '尚未送出';
  const coSignCount = (data?.documents || []).filter(document => document.status === 'awaiting_co_sign' || document.steps.some(step => step.step_type === 'co_sign' && step.status === 'sent')).length;
  const unitSentCount = (data?.documents || []).filter(document => text(document.originator_root_department) === currentRootName).length;

  return <AppShell profile={profile} title={system.title}>
    <div className="od-page">
      <header className="od-header"><div><span className="eyebrow">{system.code} · {module.title}</span><h2>{module.title}作業</h2><p>以部／室為單位傳送公文，依序完成會辦、陳核、核決與創文單位簽收；所有動作保留不可刪除的時間軸。</p><div className="od-header-scope"><small>目前可查詢的部／室</small><strong>{(data?.scope_root_departments || []).map(department => department.name).join('、') || '尚未載入'}</strong></div></div><div className="od-header-summary" aria-label="登入者單位與公文動態資訊"><div className="od-header-stat od-header-unit-stat"><small>登入者部／室</small><strong>{currentRootName}</strong></div><div className="od-header-stat"><small>目前會辦公文</small><strong>{coSignCount}</strong></div><div className="od-header-stat"><small>本單位送出公文數</small><strong>{unitSentCount}</strong></div><div className="od-header-stat"><small>可查詢公文</small><strong>{data?.documents.length ?? 0}</strong></div></div></header>
      {note && <p className="notice" role="status">{note}</p>}
      <section className="od-search-panel od-step-section od-step-section-1 panel"><div className="od-section-title"><div><span className="od-step-no">01</span><h2>文號／主旨查詢</h2></div><small>掃描後顯示該份公文的最新動態與完整時間軸，不會直接收文或簽收</small></div><div className="od-search-row"><label className="od-search-input">搜尋文號或主旨<input value={lookup} onChange={event => setLookup(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(); }} placeholder="輸入文號或主旨" /></label><button type="button" className="secondary-btn" onClick={() => void load()} disabled={loading}>查詢</button><button type="button" className="secondary-btn od-scan-button" onClick={() => setScanner(true)}>開啟相機／掃描器</button><button type="button" className="secondary-btn" onClick={() => { setLookup(''); void load(''); }}>清除</button></div><p className="od-help">可使用裝置相機或文號掃描器讀取；沒有文號時也可輸入公文主旨查詢。</p></section>
      <div className="od-layout">
<section className="panel od-list-panel"><div className="od-section-title"><div><span className="od-step-no">02</span><h2>公文清單</h2></div><button type="button" className="secondary-btn compact" onClick={() => void load()} disabled={loading}>重新載入</button></div>{loading ? <div className="loading-panel">資料載入中…</div> : !visibleDocuments.length ? <p className="empty">目前沒有可處理或查詢的公文。</p> : <><div className="od-document-list">{pagedDocuments.map(document => <button type="button" key={document.document_id} className={`od-document-item${selected?.document_id === document.document_id ? ' is-selected' : ''}`} onClick={() => { setSelectedId(document.document_id); setTargetUnit(''); }}><span className="od-document-main"><strong>{document.document_no}</strong><span>{document.subject}</span></span><span className={`od-status od-status-${document.status}`}>{statusLabel(document.status)}</span><small>{fmtTime(document.updated_at)}</small></button>)}</div><div className="od-pagination" aria-label="公文清單分頁"><span>第 {documentPage}／{documentPageCount} 頁，共 {visibleDocuments.length} 筆</span><div><button type="button" className="secondary-btn compact" onClick={() => setDocumentPage(page => Math.max(1, page - 1))} disabled={documentPage <= 1}>上一頁</button><button type="button" className="secondary-btn compact" onClick={() => setDocumentPage(page => Math.min(documentPageCount, page + 1))} disabled={documentPage >= documentPageCount}>下一頁</button></div></div></>}</section>
        <section className="panel od-detail-panel">{selected ? <><div className="od-detail-head"><div><span className="eyebrow">{selected.document_no}</span><h2>{selected.subject}</h2><p>原申請人：{selected.originator_name || '—'} {selected.originator_department ? selected.originator_department.replace(/\s*\/\s*/g, '／') : selected.originator_root_department || '—'}　｜　最新動態：<b>{statusLabel(selected.status)}</b></p></div><div className="od-detail-actions"><button type="button" className="secondary-btn compact" onClick={() => void openBarcode()} disabled={saving}>{selected.barcode_value ? '查看／列印文號' : '產生文號'}</button></div></div><div className="od-flow-strip">{['建立', '依序會辦', '陳核簽收', '核決', '創文單位簽收'].map((label, index) => { const progress = selected.status === 'closed' ? 4 : selected.status === 'awaiting_originator' ? 3 : selected.status === 'awaiting_approval' ? 2 : selected.steps.length ? 1 : 0; return <span key={label} className={'od-flow-step-' + (index + 1) + (index <= progress ? ' is-done' : '')}><i>{index + 1}</i>{label}</span>; })}</div>{canManage && (selected.status === 'draft' || selected.status === 'ready_for_next') && <div className="od-route-box"><div><b>{selected.status === 'draft' ? '送出第一個流程' : '選擇下一個流程'}</b><small>下拉選單只列第一階部／室；選定後可送出會辦或陳核。</small></div><label>目標部／室<select value={targetUnit} onChange={event => setTargetUnit(event.target.value)}><option value="">請選擇部／室</option>{departmentOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div className="od-route-actions">{(!targetUnit || selectedTarget?.canCoSign) && <button type="button" className="primary-btn compact" disabled={saving || !targetUnit} onClick={() => void perform('send_co_sign', { target_unit_id: targetUnit })}>送出會辦</button>}{(!targetUnit || selectedTarget?.canApprove) && <button type="button" className="secondary-btn compact" disabled={saving || !targetUnit || (selected.status === 'ready_for_next' && currentStep?.status !== 'completed')} onClick={() => void perform('send_approval', { target_unit_id: targetUnit })}>送出陳核</button>}</div></div>}{currentStep && <div className="od-current-step"><div><small>目前狀態 {currentStep.step_no} · {currentStep.step_type === 'co_sign' ? '會辦' : '陳核'}</small><strong>{currentStep.unit_name}</strong><span>{stepStatusLabel(currentStep.status)}　送出：{fmtTime(currentStep.sent_at)}</span></div><div className="od-current-actions">{currentStep.status === 'sent' && !canReceiveCurrentStep && <span className="od-action-hint">目前由「{currentStep.unit_name}」人員收文</span>}{canReceiveCurrentStep && currentStep.status === 'sent' && <button type="button" className="primary-btn compact" disabled={saving} onClick={() => void perform(currentStep.step_type === 'approval' ? 'approval_receive' : 'receive')}>{currentStep.step_type === 'approval' ? '簽收' : '收文（完成會辦）'}</button>}{sameUnit && currentStep.step_type === 'approval' && currentStep.status === 'received' && <><button type="button" className="primary-btn compact" disabled={saving} onClick={() => void perform('approve')}>核決完成</button><button type="button" className="danger-btn compact" disabled={saving} onClick={() => void perform('return', { note: window.prompt('請輸入退回原因（可留白）') || '' })}>退回補正</button></>}</div></div>}{selected.status === 'returned' && selected.originator_id === profile.user_id && <div className="od-return-box"><b>原申請人補正</b><span>退回歷程已保留；補正完成後可重新送出，會建立新的送出事件。</span><button type="button" className="primary-btn compact" disabled={saving} onClick={() => void perform('resubmit')}>補正後重新送出</button></div>}{selected.status === 'awaiting_originator' && inOriginatorUnit && <div className="od-return-box"><b>核決完成，回到創文單位</b><span>請由創文部／室任一位人員簽收；簽收後公文才會結案。</span><button type="button" className="primary-btn compact" disabled={saving} onClick={() => void perform('originator_receive')}>創文單位簽收</button></div>}<div className="od-meta-grid"><div><small>公文編號</small><b>{selected.document_no}</b></div><div><small>建立時間</small><b>{fmtTime(selected.created_at)}</b></div><div><small>目前狀態</small><b>{currentStatusText}</b></div><div><small>文號</small><b className="od-code">{selected.barcode_value || '尚未產生'}</b></div></div><div className="od-subsection"><div className="od-subsection-title"><h3>流程節點</h3><small>每個部／室的收文／完成均獨立記錄</small></div><div className="od-step-table responsive-table"><table><thead><tr><th>順序</th><th>部／室</th><th>類型</th><th>狀態</th><th>送出時間</th><th>完成時間</th></tr></thead><tbody>{selected.steps.map(step => <tr key={step.step_id}><td>{step.step_no}</td><td>{step.unit_name}</td><td>{step.step_type === 'co_sign' ? '會辦' : '陳核'}</td><td>{stepStatusLabel(step.status)}</td><td>{fmtTime(step.sent_at)}</td><td>{fmtTime(step.completed_at || step.received_at)}</td></tr>)}</tbody></table>{!selected.steps.length && <p className="empty">尚未選擇流程節點。</p>}</div></div><div className="od-subsection"><div className="od-subsection-title"><h3>不可刪除的時間軸</h3><small>伺服器時間，畫面以 Asia/Taipei 顯示</small></div><ol className="od-timeline">{selected.events.map(event => <li key={event.event_id}><time>{fmtTime(event.occurred_at)}</time><div><b>{actionLabel(event.action)}</b><span>{event.actor_dept_name || '未設定部／室'}／{event.actor_name || '—'}（{roleLabel(event.actor_role)}）</span>{event.note && <small>{event.note}</small>}</div></li>)}</ol>{!selected.events.length && <p className="empty">尚未有流程事件。</p>}</div>{latestEvent && <p className="od-last-event">最近事件：{actionLabel(latestEvent.action)} · {fmtTime(latestEvent.occurred_at)}</p>}</> : <p className="empty">請先從左側選擇公文。</p>}</section>
      </div>
      {canManage ? <section className="panel od-create-panel od-step-section od-step-section-3"><div className="od-section-title"><div><span className="od-step-no">03</span><h2>建立公文／採購單／其他</h2></div><small>可輸入既有文號；留白則依民國年三碼＋月日＋四碼流水號自動取號</small></div><form className="od-create-form" onSubmit={createDocument}><label>文號（選填）<input value={form.document_no} onChange={event => setForm(current => ({ ...current, document_no: event.target.value }))} maxLength={100} placeholder="未填則自動產生文號" /></label><label>文件類別<select value={form.document_type} onChange={event => setForm(current => ({ ...current, document_type: event.target.value }))}>{Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>部／室<select disabled value={form.root_department_id} onChange={event => setForm(current => ({ ...current, root_department_id: event.target.value, responsible_dept_id: '', responsible_user_id: '' }))}>{rootDepartments.map(department => <option key={department.dept_id} value={department.dept_id}>{department.name}</option>)}</select></label><label>課／組／隊<select value={form.responsible_dept_id} onChange={event => setForm(current => ({ ...current, responsible_dept_id: event.target.value, responsible_user_id: '' }))} required><option value="">請選擇課／組／隊</option>{childDepartments.map(department => <option key={department.dept_id} value={department.dept_id}>{department.name}</option>)}</select></label><label>承辦人員<select value={form.responsible_user_id} onChange={event => setForm(current => ({ ...current, responsible_user_id: event.target.value }))} required disabled={!form.responsible_dept_id}><option value="">請選擇人員</option>{responsiblePeople.map(person => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}</select></label><label className="od-subject-field">主旨<input value={form.subject} onChange={event => setForm(current => ({ ...current, subject: event.target.value }))} maxLength={300} required placeholder={`請輸入${DOCUMENT_TYPE_LABELS[form.document_type]}主旨`} /></label><button type="submit" className="primary-btn od-create-submit" disabled={saving}>{form.document_no.trim() ? '依輸入文號建立' : '建立並自動取號'}</button></form><p className="od-help">有填文號時會使用輸入值並同步作為查詢依據；未填時才會自動取號，同日已使用的自動號碼會跳至下一號。</p></section> : <section className="panel od-create-panel od-create-restricted od-step-section od-step-section-3"><div className="od-section-title"><div><span className="od-step-no">03</span><h2>建立公文／採購單／其他</h2></div></div><p className="od-help">目前帳號未開通公文傳送（SYS-09）權限，請洽後台管理員開通。</p></section>}
      {canViewPeople && <section className="panel od-people-panel"><div className="od-section-title"><div><span className="od-step-no">04</span><h2>單位人員資料</h2></div><small>可依姓名、部／室、課／組／隊與角色篩選；每頁 10 筆</small></div>{data?.people.length ? <><div className="od-people-filters" aria-label="人員資料篩選"><label className="od-filter-field">姓名<input list="od-person-name-options" value={peopleNameFilter} onChange={event => setPeopleNameFilter(event.target.value)} placeholder="全部姓名" /><datalist id="od-person-name-options">{peopleNameOptions.map(option => <option key={option} value={option} />)}</datalist></label><label className="od-filter-field">部／室<input list="od-person-root-options" value={peopleRootFilter} onChange={event => setPeopleRootFilter(event.target.value)} placeholder="全部部／室" /><datalist id="od-person-root-options">{peopleRootOptions.map(option => <option key={option} value={option} />)}</datalist></label><label className="od-filter-field">課／組／隊<input list="od-person-child-options" value={peopleChildFilter} onChange={event => setPeopleChildFilter(event.target.value)} placeholder="全部課／組／隊" /><datalist id="od-person-child-options">{peopleChildOptions.map(option => <option key={option} value={option} />)}</datalist></label><label className="od-filter-field">角色<input list="od-person-role-options" value={peopleRoleFilter} onChange={event => setPeopleRoleFilter(event.target.value)} placeholder="全部角色" /><datalist id="od-person-role-options">{peopleRoleOptions.map(option => <option key={option} value={option} />)}</datalist></label><button type="button" className="secondary-btn compact od-filter-clear" onClick={() => { setPeopleNameFilter(''); setPeopleRootFilter(''); setPeopleChildFilter(''); setPeopleRoleFilter(''); }}>清除篩選</button></div>{peopleRows.length ? <><div className="od-people-table responsive-table"><table><thead><tr><th>姓名</th><th>部／室</th><th>課／組／隊</th><th>角色</th></tr></thead><tbody>{pagedPeople.map(person => { const parts = departmentParts(person); return <tr key={person.user_id}><td>{person.name}</td><td>{parts.root}</td><td>{parts.child}</td><td><span>{roleLabel(person.rbac_role || person.role)}</span><small className="od-person-level">{departmentLevelLabel(person.department_level)}</small></td></tr>; })}</tbody></table></div><div className="od-pagination" aria-label="單位人員資料分頁"><span>第 {peoplePage}／{peoplePageCount} 頁，共 {peopleRows.length} 筆</span><div><button type="button" className="secondary-btn compact" onClick={() => setPeoplePage(page => Math.max(1, page - 1))} disabled={peoplePage <= 1}>上一頁</button><button type="button" className="secondary-btn compact" onClick={() => setPeoplePage(page => Math.min(peoplePageCount, page + 1))} disabled={peoplePage >= peoplePageCount}>下一頁</button></div></div></> : <p className="empty">沒有符合篩選條件的人員資料。</p>}</> : <p className="empty">目前單位沒有可顯示的人員資料。</p>}</section>}
    </div>
    {scanner && <Scanner onDetected={onScanned} onClose={() => setScanner(false)} />}
    {qrDocument && <QrModal document={qrDocument} onClose={() => setQrDocument(null)} />}
  </AppShell>;
}
