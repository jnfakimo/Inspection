// 影片上傳前在瀏覽器端壓縮：以 <video> 播放原檔、畫到縮小的 canvas，再用 MediaRecorder
// 以較低位元率重新錄製。刻意不用 ffmpeg.wasm——它有數十 MB，而且 CSP 不允許載入外部 wasm。
// 代價：壓縮時間約等於影片長度，而且壓縮期間分頁要保持在前景（背景分頁的繪製會被瀏覽器降速）。

const MAX_LONG_EDGE = 1280;
const VIDEO_BITRATE = 1_000_000;
const AUDIO_BITRATE = 96_000;
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
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  let audioContext: AudioContext | null = null;
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
    URL.revokeObjectURL(url);
    if (audioContext) void audioContext.close().catch(() => undefined);
  }
}
