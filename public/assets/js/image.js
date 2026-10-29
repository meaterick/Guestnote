// 사진 줄이기. 올리기 전에 브라우저 안에서 크기와 화질을 낮춰서 용량 예산에 맞춰요.
// 결과는 보드에 바로 보이는 작은 사진(thumb)과, 눌렀을 때만 불러오는 큰 사진(full) 두 가지예요.

const WEBP = 'image/webp';
const JPEG = 'image/jpeg';
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

export async function compressImage(file, opts) {
  if (!file || !/^image\//.test(file.type || '')) {
    throw new ImageError('사진 파일만 올릴 수 있어요.');
  }
  if (file.size > opts.maxInputBytes) {
    const mb = Math.round(opts.maxInputBytes / 1024 / 1024);
    throw new ImageError(`사진이 너무 커요. ${mb}MB 이하의 사진을 골라 주세요.`);
  }

  const type = await encodeType();
  const img = await decode(file);
  try {
    const { width, height } = img;
    if (!width || !height) throw new ImageError('사진을 읽지 못했어요.');

    // 원본이 보드용 크기보다 작으면 큰 사진은 따로 만들지 않아요.
    const needsFull = Math.max(width, height) > opts.thumbSide;
    let full = null;
    let base = { source: img.source, width, height };
    if (needsFull) {
      const r = await encodeWithin(img.source, width, height, opts.fullSide, opts.fullBytes, type);
      full = { dataUrl: await blobToDataUrl(r.blob), bytes: r.blob.size, width: r.width, height: r.height, type: r.blob.type };
      base = { source: r.canvas, width: r.width, height: r.height };
    }
    const t = await encodeWithin(base.source, base.width, base.height, opts.thumbSide, opts.thumbBytes, type);
    const thumb = { dataUrl: await blobToDataUrl(t.blob), bytes: t.blob.size, width: t.width, height: t.height, type: t.blob.type };

    return {
      thumb,
      full,
      original: { bytes: file.size, width, height, animated: file.type === 'image/gif' },
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
  return typeof url === 'string' && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(url);
}
