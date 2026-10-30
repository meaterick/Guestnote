// GIF 읽기·쓰기 테스트 (브라우저 없이)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGif, readGif, gifFrames, buildPalette, indexFrame, diffFrames, writeGif, normalizeDelay } from '../public/assets/js/gif.js';

// 그라데이션 배경 위로 네모가 움직이는 장면들 (RGBA)
function movingBox(w, h, n, { alpha = false } = {}) {
  return Array.from({ length: n }, (_, f) => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const box = x >= 3 + f * 4 && x < 13 + f * 4 && y >= 4 && y < 14;
        rgba[o] = box ? 240 : (x * 9) % 256;
        rgba[o + 1] = box ? 30 : (y * 17) % 256;
        rgba[o + 2] = box ? 50 : ((x + y) * 5) % 256;
        rgba[o + 3] = alpha && !box ? 0 : 255;
      }
    }
    return rgba;
  });
}

function encode(frames, w, h, delays = frames.map(() => 7)) {
  const palette = buildPalette(frames);
  let lut;
  const indexed = frames.map((rgba, i) => {
    const r = indexFrame(rgba, palette, 255, lut);
    lut = r.lut;
    return { indices: r.indices, delay: delays[i] };
  });
  return { palette, indexed };
}

test('바뀐 곳만 남긴 움직이는 GIF를 다시 읽으면 장면이 그대로예요', () => {
  const w = 61;
  const h = 37;
  const frames = movingBox(w, h, 6);
  const { palette, indexed } = encode(frames, w, h, [5, 6, 7, 8, 9, 10]);
  const parts = diffFrames(indexed, w, h, 255);
  assert.ok(parts.slice(1).every((p) => p.w < w), '두 번째 장면부터는 바뀐 곳만 담아요');
  const bytes = writeGif({ width: w, height: h, palette, frames: parts });
  assert.equal(isGif(bytes), true);
  const gif = readGif(bytes);
  assert.equal(gif.frames.length, 6);
  let k = 0;
  for (const f of gifFrames(gif)) {
    assert.equal(f.delay, [5, 6, 7, 8, 9, 10][k]);
    for (let i = 0; i < w * h; i++) {
      const c = indexed[k].indices[i];
      assert.deepEqual([f.rgba[i * 4], f.rgba[i * 4 + 1], f.rgba[i * 4 + 2], f.rgba[i * 4 + 3]], [palette[c * 3], palette[c * 3 + 1], palette[c * 3 + 2], 255]);
    }
    k++;
  }
});

test('같은 장면이 이어지면 하나로 합치고 시간을 더해요', () => {
  const w = 20;
  const h = 10;
  const [a, b] = movingBox(w, h, 2);
  const { palette, indexed } = encode([a, a, b, b, b], w, h, [3, 4, 5, 6, 7]);
  const parts = diffFrames(indexed, w, h, 255);
  assert.deepEqual(parts.map((p) => p.delay), [7, 18]);
  assert.equal(readGif(writeGif({ width: w, height: h, palette, frames: parts })).frames.length, 2);
});

test('투명한 곳이 있는 장면은 화면을 비우고 다시 그려요', () => {
  const w = 30;
  const h = 20;
  const frames = movingBox(w, h, 3, { alpha: true });
  const { palette, indexed } = encode(frames, w, h);
  const parts = indexed.map((f) => ({ x: 0, y: 0, w, h, indices: f.indices, delay: f.delay, disposal: 2, transparent: 255 }));
  const gif = readGif(writeGif({ width: w, height: h, palette, frames: parts }));
  const seen = [...gifFrames(gif)].length;
  assert.equal(seen, 3);
  let k = 0;
  for (const f of gifFrames(gif)) {
    for (let i = 0; i < w * h; i++) assert.equal(f.rgba[i * 4 + 3], frames[k][i * 4 + 3] >= 128 ? 255 : 0);
    k++;
  }
});

test('사전이 여러 번 가득 차는 큰 장면도 압축했다가 그대로 풀어요', () => {
  const w = 300;
  const h = 200;
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 255;
  const indices = Uint8Array.from({ length: w * h }, rand);
  const palette = new Uint8Array(765).map((_, i) => (i * 37) % 256);
  const bytes = writeGif({ width: w, height: h, palette, frames: [{ x: 0, y: 0, w, h, indices, delay: 10, disposal: 1, transparent: -1 }] });
  const back = readGif(bytes).frames[0].indices;
  assert.deepEqual(back, indices);
});

test('줄을 건너뛰어 저장한(interlace) GIF도 읽어요', () => {
  const w = 9;
  const h = 19;
  const indices = Uint8Array.from({ length: w * h }, (_, i) => Math.floor(i / w) % 200);
  // 저장 순서: 0,8,16 → 4,12 → 2,6,10,14,18 → 홀수 줄
  const order = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) order.push(y);
  const stored = new Uint8Array(w * h);
  order.forEach((y, row) => stored.set(indices.subarray(y * w, y * w + w), row * w));
  const palette = new Uint8Array(765).map((_, i) => i % 256);
  const bytes = writeGif({ width: w, height: h, palette, frames: [{ x: 0, y: 0, w, h, indices: stored, delay: 10, disposal: 1, transparent: -1 }] });
  const at = bytes.indexOf(0x2c, 6 + 7 + 768 + 19);
  bytes[at + 9] |= 0x40; // 이미지 정보의 interlace 표시
  assert.deepEqual(readGif(bytes).frames[0].indices, indices);
});

test('색이 255가지 이하면 그대로 쓰고, 많으면 255가지로 줄여요', () => {
  const few = new Uint8ClampedArray(4 * 3);
  few.set([8, 16, 24, 255, 200, 100, 48, 255, 8, 16, 24, 255]);
  const pal = buildPalette([few]);
  assert.equal(pal.length / 3, 2);
  const { indices } = indexFrame(few, pal, 255);
  assert.equal(indices[0], indices[2]);
  assert.notEqual(indices[0], indices[1]);

  const many = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) many.set([(i * 13) % 256, (i * 7) % 256, (i * 29) % 256, 255], i * 4);
  assert.ok(buildPalette([many]).length / 3 <= 255);
});

test('끝이 잘린 GIF는 읽은 데까지만 쓰고, GIF가 아니면 알려 줘요', () => {
  const w = 40;
  const h = 30;
  const frames = movingBox(w, h, 4);
  const { palette, indexed } = encode(frames, w, h);
  const bytes = writeGif({ width: w, height: h, palette, frames: diffFrames(indexed, w, h, 255) });
  const cut = readGif(bytes.subarray(0, bytes.length - 40));
  assert.ok(cut.frames.length >= 1 && cut.frames.length <= 4);
  assert.throws(() => readGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])));
  assert.equal(normalizeDelay(0), 10);
  assert.equal(normalizeDelay(1), 10);
  assert.equal(normalizeDelay(4), 4);
});
