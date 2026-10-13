// 影片上傳前在瀏覽器端壓縮：以 <video> 播放原檔、畫到縮小的 canvas，再用 MediaRecorder
// 以較低位元率重新錄製。刻意不用 ffmpeg.wasm——它有數十 MB，而且 CSP 不允許載入外部 wasm。
// 代價：壓縮時間約等於影片長度，而且壓縮期間分頁要保持在前景（背景分頁的繪製會被瀏覽器降速）。

const MAX_LONG_EDGE = 1280;
const VIDEO_BITRATE = 1_000_000;
const AUDIO_BITRATE = 96_000;
const MAX_VIDEO_INPUT_BYTES = 50 * 1024 * 1024;
const VIDEO_SIGNATURE_BYTES = 512;
// 優先 MP4（iPhone 可直接播放），不支援時退回 WebM。
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|avi|mkv|webm|wmv|3gp|mts|m2ts)$/i.test(file.name);
}

type VideoContainer = 'isobmff' | 'webm' | 'matroska' | 'avi' | 'asf' | 'mpeg-ts' | 'mpeg';

const VIDEO_MIME_BY_CONTAINER: Record<VideoContainer, string> = {
  isobmff: 'video/mp4',
  webm: 'video/webm',
  matroska: 'video/x-matroska',
  avi: 'video/x-msvideo',
  asf: 'video/x-ms-wmv',
  'mpeg-ts': 'video/mp2t',
  mpeg: 'video/mpeg',
};

const ALLOWED_DECLARED_MIME: Record<VideoContainer, ReadonlySet<string>> = {
  isobmff: new Set(['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp', 'video/3gpp2']),
  webm: new Set(['video/webm']),
  matroska: new Set(['video/x-matroska']),
  avi: new Set(['video/x-msvideo', 'video/avi']),
  asf: new Set(['video/x-ms-wmv', 'video/x-ms-asf', 'application/vnd.ms-asf']),
  'mpeg-ts': new Set(['video/mp2t', 'video/mpeg']),
  mpeg: new Set(['video/mpeg']),
};

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function sniffVideoContainer(bytes: Uint8Array, totalSize: number): VideoContainer | null {
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const atomSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (atomSize >= 8 && atomSize <= totalSize) return 'isobmff';
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    const header = ascii(bytes, 0, bytes.length).toLowerCase();
    if (header.includes('webm')) return 'webm';
    if (header.includes('matroska')) return 'matroska';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'AVI ') return 'avi';
  if (bytes.length >= 16 && [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c].every((value, index) => bytes[index] === value)) return 'asf';
  if (bytes.length >= 377 && bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) return 'mpeg-ts';
  if (bytes.length >= 389 && bytes[4] === 0x47 && bytes[196] === 0x47 && bytes[388] === 0x47) return 'mpeg-ts';
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && (bytes[3] === 0xba || bytes[3] === 0xb3)) return 'mpeg';
  return null;
}

/** Validate the container and normalize its MIME before handing it to a media decoder. */
export async function validateVideoInput(file: File): Promise<Blob> {
  if (!isVideoFile(file)) throw new Error('檔案不是支援的影片格式');
  if (file.size <= 0 || file.size > MAX_VIDEO_INPUT_BYTES) throw new Error('影片檔案必須大於 0 且不得超過 50 MB');

  const bytes = new Uint8Array(await file.slice(0, VIDEO_SIGNATURE_BYTES).arrayBuffer());
  const container = sniffVideoContainer(bytes, file.size);
  if (!container) throw new Error('影片檔案內容格式無效或不受支援');

  const declaredMime = file.type.split(';', 1)[0].trim().toLowerCase();
  if (declaredMime && !ALLOWED_DECLARED_MIME[container].has(declaredMime)) {
    throw new Error('影片 MIME 類型與檔案內容不一致');
  }

  return new Blob([file], { type: VIDEO_MIME_BY_CONTAINER[container] });
}

export function validateVideoObjectUrl(value: string, expectedOrigin: string) {
  let parsed: URL;
  let resource: URL;
  try {
    parsed = new URL(value);
    resource = new URL(value.slice('blob:'.length));
  } catch {
    throw new Error('影片預覽網址無效');
  }
  if (parsed.protocol !== 'blob:' || resource.origin !== expectedOrigin || !resource.pathname || resource.pathname === '/' || resource.search || resource.hash) {
    throw new Error('影片預覽網址必須是本站建立的 blob 網址');
  }
  return parsed.href;
}

export async function withVideoObjectUrl<T>(blob: Blob, expectedOrigin: string, useUrl: (url: string) => Promise<T>) {
  const url = URL.createObjectURL(blob);
  try {
    return await useUrl(validateVideoObjectUrl(url, expectedOrigin));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function recorderMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

export function canCompressVideo() {
  return typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function' && Boolean(recorderMime());
}

function waitFor(video: HTMLVideoElement, event: 'loadedmetadata' | 'loadeddata', message: string) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(message)); };
    const cleanup = () => { video.removeEventListener(event, done); video.removeEventListener('error', fail); };
    video.addEventListener(event, done);
    video.addEventListener('error', fail);
  });
}

export async function compressVideo(file: File, onProgress?: (ratio: number) => void): Promise<File> {
  const mime = recorderMime();
  if (!mime) throw new Error('此瀏覽器不支援影片壓縮');
  const mediaBlob = await validateVideoInput(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  let audioContext: AudioContext | null = null;
  return withVideoObjectUrl(mediaBlob, window.location.origin, async url => {
    try {
      const metadata = waitFor(video, 'loadedmetadata', '瀏覽器無法解碼這支影片，請先轉成 MP4 再上傳');
      video.src = url;
      await metadata;
      if (video.readyState < 2) await waitFor(video, 'loadeddata', '瀏覽器無法讀取這支影片的畫面');
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const scale = Math.min(1, MAX_LONG_EDGE / Math.max(video.videoWidth || 1, video.videoHeight || 1));
      const width = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
      const height = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const painter = canvas.getContext('2d');
      if (!painter) throw new Error('無法建立影片壓縮畫布');
      painter.drawImage(video, 0, 0, width, height);
      const stream = canvas.captureStream(30);
      // 聲音走 Web Audio：只接到錄製串流、不接喇叭，所以壓縮時不會發出聲音。
      try {
        const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtor) {
          audioContext = new AudioCtor();
          const source = audioContext.createMediaElementSource(video);
          const destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
          destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
        }
      } catch { /* 取不到聲音時只壓縮畫面 */ }

      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      const ended = new Promise<void>((resolve, reject) => {
        video.onended = () => resolve();
        video.onerror = () => reject(new Error('影片播放中斷，壓縮失敗'));
      });
      let frame = 0;
      const draw = () => {
        painter.drawImage(video, 0, 0, width, height);
        if (duration) onProgress?.(Math.min(0.99, video.currentTime / duration));
        if (!video.ended) frame = requestAnimationFrame(draw);
      };

      recorder.start(1000);
      if (audioContext?.state === 'suspended') await audioContext.resume().catch(() => undefined);
      try {
        await video.play();
      } catch {
        // 瀏覽器不允許有聲播放時改為靜音壓縮，至少保留畫面。
        video.muted = true;
        await video.play();
      }
      frame = requestAnimationFrame(draw);
      await ended;
      cancelAnimationFrame(frame);
      painter.drawImage(video, 0, 0, width, height);
      recorder.stop();
      await stopped;
      onProgress?.(1);

      const type = mime.split(';')[0];
      const base = file.name.replace(/\.[^.]+$/, '') || '影片';
      return new File(chunks, `${base}（壓縮）.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type });
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (audioContext) void audioContext.close().catch(() => undefined);
    }
  });
}
