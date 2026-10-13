import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { validateVideoInput, validateVideoObjectUrl, withVideoObjectUrl } from './video-compress.ts';

function makeFile(bytes: Uint8Array, name = 'clip.mp4', type = 'video/mp4') {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([copy], name, { type });
}

function validMp4Bytes() {
  return Uint8Array.from([
    0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
  ]);
}

test('validates MP4 bytes and replaces the supplied MIME with the detected media type', async () => {
  const result = await validateVideoInput(makeFile(validMp4Bytes(), 'phone.mov', 'video/quicktime'));
  assert.equal(result.type, 'video/mp4');
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), validMp4Bytes());
});

test('rejects HTML or SVG renamed and labeled as an MP4', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await assert.rejects(validateVideoInput(makeFile(svg, 'payload.mp4', 'video/mp4')), /內容格式無效/);
});

test('rejects unsupported, empty, oversized, and MIME-mismatched video inputs', async () => {
  const unknown = new Uint8Array(32).fill(0x41);
  await assert.rejects(validateVideoInput(makeFile(unknown)), /內容格式無效/);
  await assert.rejects(validateVideoInput(makeFile(validMp4Bytes(), 'clip.mp4', 'image/svg+xml')), /MIME 類型/);
  await assert.rejects(validateVideoInput(new File([], 'empty.mp4', { type: 'video/mp4' })), /大於 0/);

  const oversized = {
    name: 'large.mp4',
    type: 'video/mp4',
    size: 50 * 1024 * 1024 + 1,
    slice() { throw new Error('oversized input must be rejected before reading'); },
  } as unknown as File;
  await assert.rejects(validateVideoInput(oversized), /不得超過 50 MB/);
});

test('accepts a WebM EBML signature and canonicalizes its media type', async () => {
  const bytes = new Uint8Array(36);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  bytes.set(new TextEncoder().encode('webm'), 24);
  const result = await validateVideoInput(makeFile(bytes, 'clip.webm', 'video/webm'));
  assert.equal(result.type, 'video/webm');
});

test('accepts 192-byte M2TS packet alignment', async () => {
  const bytes = new Uint8Array(389);
  bytes[4] = 0x47;
  bytes[196] = 0x47;
  bytes[388] = 0x47;
  const result = await validateVideoInput(makeFile(bytes, 'clip.m2ts', 'video/mp2t'));
  assert.equal(result.type, 'video/mp2t');
});

test('only accepts same-origin blob URLs for video preview', () => {
  assert.equal(validateVideoObjectUrl('blob:https://app.example/uuid', 'https://app.example'), 'blob:https://app.example/uuid');
  for (const value of ['javascript:alert(1)', 'data:text/html,<script/>', 'https://evil.example/video.mp4', 'blob:https://evil.example/id']) {
    assert.throws(() => validateVideoObjectUrl(value, 'https://app.example'));
  }
});

test('revokes media object URLs after success, failure, and URL validation failure', async () => {
  const created = mock.method(URL, 'createObjectURL', () => 'blob:https://app.example/uuid');
  const revoked = mock.method(URL, 'revokeObjectURL', () => undefined);
  try {
    const ok = await withVideoObjectUrl(new Blob(['media']), 'https://app.example', async url => url);
    assert.equal(ok, 'blob:https://app.example/uuid');
    await assert.rejects(withVideoObjectUrl(new Blob(['media']), 'https://app.example', async () => { throw new Error('decode failed'); }), /decode failed/);
    assert.equal(revoked.mock.callCount(), 2);

    created.mock.mockImplementation(() => 'javascript:alert(1)');
    await assert.rejects(withVideoObjectUrl(new Blob(['media']), 'https://app.example', async () => 'unreachable'), /本站建立的 blob/);
    assert.equal(revoked.mock.callCount(), 3);
  } finally {
    created.mock.restore();
    revoked.mock.restore();
  }
});
