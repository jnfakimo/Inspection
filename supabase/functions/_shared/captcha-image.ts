// PNG 僅含像素與必要區塊，沒有數字字串、SVG path 或答案 metadata。
const GLYPHS = [
  ['01110','11011','11011','11011','11011','11011','01110'],
  ['00100','01100','00100','00100','00100','00100','01110'],
  ['01110','11011','00011','00110','01100','11000','11111'],
  ['11110','00011','00011','01110','00011','00011','11110'],
  ['00011','00111','01111','11011','11111','00011','00011'],
  ['11111','11000','11000','11110','00011','11011','01110'],
  ['01110','11000','11000','11110','11011','11011','01110'],
  ['11111','00011','00110','00110','01100','01100','01100'],
  ['01110','11011','11011','01110','11011','11011','01110'],
  ['01110','11011','11011','01111','00011','00011','01110'],
];
export const CAPTCHA_WIDTH = 220;
export const CAPTCHA_HEIGHT = 70;
function u32(n: number) { return Uint8Array.of(n >>> 24, n >>> 16, n >>> 8, n); }
function join(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Uint8Array) {
  const body = join(new TextEncoder().encode(name), data);
  return join(u32(data.length), body, u32(crc32(body)));
}
function png(pixels: Uint8Array) {
  const row = CAPTCHA_WIDTH + 1;
  const raw = new Uint8Array(row * CAPTCHA_HEIGHT);
  for (let y = 0; y < CAPTCHA_HEIGHT; y++) raw.set(pixels.subarray(y * CAPTCHA_WIDTH, (y + 1) * CAPTCHA_WIDTH), y * row + 1);
  // 單個 stored DEFLATE block，資料小於 65535 bytes；不需額外 native/網路相依。
  const n = raw.length;
  const block = Uint8Array.of(1, n & 255, n >>> 8, (~n) & 255, ((~n) >>> 8) & 255);
  let a = 1, b = 0;
  for (const byte of raw) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  const zlib = join(Uint8Array.of(0x78, 0x01), block, raw, u32((b << 16) | a));
  const header = join(u32(CAPTCHA_WIDTH), u32(CAPTCHA_HEIGHT), Uint8Array.of(8, 0, 0, 0, 0));
  return join(Uint8Array.of(137,80,78,71,13,10,26,10), chunk('IHDR', header), chunk('IDAT', zlib), chunk('IEND', new Uint8Array()));
}
export function captchaImage(code: string): string {
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid CAPTCHA code');
  const random = crypto.getRandomValues(new Uint8Array(2048));
  let cursor = 0;
  const rand = () => random[cursor++ % random.length] / 256;
  const pixels = new Uint8Array(CAPTCHA_WIDTH * CAPTCHA_HEIGHT).fill(248);
  const dot = (x: number, y: number, value: number) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && x < CAPTCHA_WIDTH && y >= 0 && y < CAPTCHA_HEIGHT) pixels[y * CAPTCHA_WIDTH + x] = value;
  };
  for (let i = 0; i < 600; i++) dot(rand() * CAPTCHA_WIDTH, rand() * CAPTCHA_HEIGHT, 175 + Math.floor(rand() * 60));
  for (let i = 0; i < 5; i++) {
    const y = rand() * CAPTCHA_HEIGHT, phase = rand() * 6;
    for (let x = 0; x < CAPTCHA_WIDTH; x++) dot(x, y + 6 * Math.sin(x / 21 + phase), 190);
  }
  for (let index = 0; index < 6; index++) {
    const glyph = GLYPHS[Number(code[index])], scale = 3.7 + rand() * 0.5;
    const angle = (rand() - 0.5) * 0.32, cos = Math.cos(angle), sin = Math.sin(angle);
    const originX = 12 + index * 34 + rand() * 3, originY = 17 + rand() * 7;
    const phase = rand() * 6, ink = 20 + Math.floor(rand() * 30);
    for (let y = 0; y < Math.ceil(7 * scale); y++) for (let x = 0; x < Math.ceil(5 * scale); x++) {
      if (glyph[Math.min(6, Math.floor(y / scale))][Math.min(4, Math.floor(x / scale))] !== '1') continue;
      const dx = x - 10, dy = y - 14;
      dot(originX + 10 + dx * cos - dy * sin + 1.2 * Math.sin(y / 6 + phase), originY + 14 + dx * sin + dy * cos, ink);
    }
  }
  return 'data:image/png;base64,' + btoa(String.fromCharCode(...png(pixels)));
}
