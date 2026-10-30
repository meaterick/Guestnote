// 사진 줄이기. 올리기 전에 브라우저 안에서 크기와 화질을 낮춰서 용량 예산에 맞춰요.
// 결과는 보드에 바로 보이는 작은 사진(thumb)과, 눌렀을 때만 불러오는 큰 사진(full) 두 가지예요.
// 움직이는 GIF는 첫 장면을 작은 사진으로 쓰고, 줄인 GIF를 큰 사진 자리에 둬요. (보드에서 불러와 움직여요)
import { isGif, readGif, gifFrames, buildPalette, indexFrame, diffFrames, writeGif } from './gif.js';

const WEBP = 'image/webp';
const JPEG = 'image/jpeg';
const GIF = 'image/gif';
// 움직이는 GIF: 장면은 많아야 100개(넘으면 건너뛰며 골라요), 줄여도 긴 변 120px까지만
const GIF_MAX_FRAMES = 100;
const GIF_MIN_SIDE = 120;
// 한 번에 그릴 캔버스의 긴 변 상한. iOS Safari의 캔버스 면적 제한을 넘지 않게 해요.
const SAFE_SIDE = 4096;

export class ImageError extends Error {}

let webpSupport;
async function encodeType() {
  if (webpSupport === undefined) {
    const c = makeCanvas(2, 2);
    const blob = await toBlob(c, WEBP, 0.8).catch(() => null);
    webpSupport = blob?.type === WEBP;
  }
  return webpSupport ? WEBP : JPEG;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageError('사진을 변환하지 못했어요.'))), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new ImageError('사진을 읽지 못했어요.'));
    r.readAsDataURL(blob);
  });
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      // 아래의 <img> 방식으로 다시 시도해요.
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageError('이 형식의 사진은 열 수 없어요. JPG나 PNG로 바꿔서 올려 주세요.');
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

// 큰 폭으로 줄일 때는 절반씩 나눠 줄여야 계단 현상이 적어요.
function drawScaled(source, sw, sh, tw, th, opaque) {
  let cur = source;
  let cw = sw;
  let ch = sh;
  while (cw / 2 >= tw && ch / 2 >= th) {
    const k = Math.max(cw, ch) > SAFE_SIDE * 2 ? SAFE_SIDE / Math.max(cw, ch) : 0.5;
    const step = makeCanvas(cw * k, ch * k);
    const g = step.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, step.width, step.height);
    cur = step;
    cw = step.width;
    ch = step.height;
  }
  const out = makeCanvas(tw, th);
  const g = out.getContext('2d');
  if (opaque) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, out.width, out.height);
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

function fitWithin(w, h, side) {
  const k = Math.min(1, side / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// 예산 안에 들 때까지 화질을 낮추고, 그래도 크면 크기를 줄여요.
async function encodeWithin(source, sw, sh, side, budget, type) {
  let [w, h] = fitWithin(sw, sh, side);
  let quality = 0.86;
  for (let attempt = 0; attempt < 12; attempt++) {
    const canvas = drawScaled(source, sw, sh, w, h, type === JPEG);
    const blob = await toBlob(canvas, type, quality);
    if (blob.size <= budget) {
      return { canvas, blob, width: canvas.width, height: canvas.height };
    }
    const ratio = budget / blob.size;
    if (quality > 0.62 && ratio > 0.55) {
      quality = Math.max(0.6, quality - 0.1);
    } else {
      const k = Math.max(0.5, Math.sqrt(ratio) * 0.92);
      w = Math.max(16, Math.round(w * k));
      h = Math.max(16, Math.round(h * k));
    }
  }
  throw new ImageError('사진을 충분히 줄이지 못했어요. 다른 사진을 골라 주세요.');
}

// 오래 걸리는 반복 중간중간에 화면이 멈추지 않게 숨을 돌려요.
const breathe = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function resizeRgba(rgba, w, h, tw, th, src, dst) {
  src.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  const g = dst.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, tw, th);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h, 0, 0, tw, th);
  return g.getImageData(0, 0, tw, th).data;
}

// 장면을 step개마다 하나씩 골라요. 건너뛴 장면의 시간은 고른 장면에 더해서 전체 길이는 그대로예요.
function pickEvery(frames, step) {
  if (step <= 1) return frames;
  const out = [];
  frames.forEach((f, i) => {
    if (i % step === 0) out.push({ rgba: f.rgba, delay: f.delay });
    else out[out.length - 1].delay += f.delay;
  });
  return out;
}

async function encodeAnimated(frames, w, h) {
  const palette = buildPalette(frames.map((f) => f.rgba));
  const clearIndex = 255;
  let lut;
  let seeThrough = false;
  const indexed = [];
  for (const [i, f] of frames.entries()) {
    const r = indexFrame(f.rgba, palette, clearIndex, lut);
    lut = r.lut;
    seeThrough ||= r.indices.includes(clearIndex);
    indexed.push({ indices: r.indices, delay: f.delay });
    if (i % 10 === 9) await breathe();
  }
  // 투명한 곳이 있으면 장면마다 화면을 비우고 새로 그려요. 없으면 바뀐 곳만 남겨서 용량을 크게 줄여요.
  const out = seeThrough
    ? indexed.map((f) => ({ x: 0, y: 0, w, h, indices: f.indices, delay: f.delay, disposal: 2, transparent: clearIndex }))
    : diffFrames(indexed, w, h, clearIndex);
  return writeGif({ width: w, height: h, palette, frames: out });
}

// 움직이는 GIF를 보드에 맞게 줄여요. 이미 작으면 그대로 두고, 아니면 크기와 장면 수를 줄여 새 GIF로 만들어요.
// 장면이 하나뿐이면 null (보통 사진처럼 다뤄요)
async function shrinkGif(bytes, opts) {
  const gif = readGif(bytes);
  const n = gif.frames.length;
  const { width: w, height: h } = gif;
  if (n < 2) return null;
  if (!w || !h || w * h > 4_000_000 || w * h * n > 300_000_000) {
    throw new ImageError('GIF가 너무 크거나 길어서 움직이게 올릴 수 없어요.');
  }
  if (bytes.length <= opts.gifBytes && Math.max(w, h) <= opts.gifKeepSide) {
    return { bytes, width: w, height: h, frames: n, kept: true };
  }

  // 장면을 차례로 겹쳐 그린 화면을 가장 큰 크기로 줄여 둬요.
  const [bw, bh] = fitWithin(w, h, opts.gifSide);
  const every = Math.ceil(n / GIF_MAX_FRAMES);
  const src = makeCanvas(w, h);
  const dst = makeCanvas(bw, bh);
  const base = [];
  let i = 0;
  for (const f of gifFrames(gif)) {
    if (i % every === 0) base.push({ rgba: resizeRgba(f.rgba, w, h, bw, bh, src, dst), delay: f.delay });
    else base[base.length - 1].delay += f.delay;
    if (++i % 8 === 0) await breathe();
  }

  // 예산에 들 때까지: 장면이 아주 많으면 먼저 반으로 줄이고, 그다음 크기를 줄이고, 더 못 줄이면 장면을 더 건너뛰어요.
  const small = makeCanvas(bw, bh);
  let side = Math.max(bw, bh);
  let step = 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const [cw, ch] = fitWithin(w, h, side);
    let frames = base;
    if (cw !== bw || ch !== bh) {
      small.width = cw;
      small.height = ch;
      frames = [];
      for (const f of base) frames.push({ rgba: resizeRgba(f.rgba, bw, bh, cw, ch, dst, small), delay: f.delay });
      await breathe();
    }
    const picked = pickEvery(frames, step);
    const out = await encodeAnimated(picked, cw, ch);
    if (out.length <= opts.gifBytes) return { bytes: out, width: cw, height: ch, frames: picked.length, kept: false };
    const ratio = opts.gifBytes / out.length;
    const nextSide = Math.max(GIF_MIN_SIDE, Math.floor(side * Math.max(0.6, Math.sqrt(ratio) * 0.95)));
    if (step === 1 && picked.length > 30 && ratio < 0.6) step = 2;
    else if (nextSide < side) side = nextSide;
    else if (picked.length > 6) step += 1;
    else break;
  }
  throw new ImageError('움직이는 GIF를 충분히 줄이지 못했어요.');
}

export async function compressImage(file, opts) {
  if (!file || !/^image\//.test(file.type || '')) {
    throw new ImageError('사진 파일만 올릴 수 있어요.');
  }
  if (file.size > opts.maxInputBytes) {
    const mb = Math.round(opts.maxInputBytes / 1024 / 1024);
    throw new ImageError(`사진이 너무 커요. ${mb}MB 이하의 사진을 골라 주세요.`);
  }

  const type = await encodeType();
  let anim = null;
  let animIssue = '';
  if (file.type === GIF) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isGif(bytes)) {
      try {
        anim = await shrinkGif(bytes, opts);
      } catch (err) {
        if (!(err instanceof ImageError)) console.warn(err);
        animIssue = err instanceof ImageError ? err.message : '움직이는 GIF로 만들지 못했어요.';
      }
    }
  }
  const img = await decode(file);
  try {
    const { width, height } = img;
    if (!width || !height) throw new ImageError('사진을 읽지 못했어요.');

    if (anim) {
      const t = await encodeWithin(img.source, width, height, opts.thumbSide, opts.thumbBytes, type);
      const blob = new Blob([anim.bytes], { type: GIF });
      return {
        anim: true,
        thumb: { blob: t.blob, dataUrl: await blobToDataUrl(t.blob), bytes: t.blob.size, width: t.width, height: t.height, type: t.blob.type },
        full: { blob, dataUrl: await blobToDataUrl(blob), bytes: blob.size, width: anim.width, height: anim.height, type: GIF },
        original: { bytes: file.size, width, height, frames: anim.frames, kept: anim.kept },
      };
    }

    // 원본이 보드용 크기보다 작으면 큰 사진은 따로 만들지 않아요.
    const needsFull = Math.max(width, height) > opts.thumbSide;
    let full = null;
    let base = { source: img.source, width, height };
    if (needsFull) {
      const r = await encodeWithin(img.source, width, height, opts.fullSide, opts.fullBytes, type);
      full = { blob: r.blob, dataUrl: await blobToDataUrl(r.blob), bytes: r.blob.size, width: r.width, height: r.height, type: r.blob.type };
      base = { source: r.canvas, width: r.width, height: r.height };
    }
    const t = await encodeWithin(base.source, base.width, base.height, opts.thumbSide, opts.thumbBytes, type);
    const thumb = { blob: t.blob, dataUrl: await blobToDataUrl(t.blob), bytes: t.blob.size, width: t.width, height: t.height, type: t.blob.type };

    return {
      anim: false,
      thumb,
      full,
      original: { bytes: file.size, width, height, animIssue },
    };
  } finally {
    img.release();
  }
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export function isSafeImageUrl(url) {
  return typeof url === 'string' && /^data:image\/(webp|jpeg|png|gif);base64,[A-Za-z0-9+/]+=*$/.test(url);
}
