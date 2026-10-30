// 움직이는 GIF 읽기와 쓰기. 화면 없이 숫자만 다뤄요. (크기를 줄이는 일은 image.js가 캔버스로 해요)
//
// readGif   GIF 파일 → 장면(프레임) 목록
// gifFrames 장면을 차례로 겹쳐 그린 전체 화면(RGBA)을 하나씩 내줘요
// buildPalette / indexFrame  색을 255가지로 줄이고, 화면을 색 번호로 바꿔요
// diffFrames 앞 장면과 같은 곳은 투명하게 비워서 용량을 줄여요
// writeGif  장면 목록 → GIF 파일

const MAX_CODE = 4096;

export function isGif(bytes) {
  return bytes.length > 13 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
}

// 브라우저처럼 0.02초보다 짧은 장면은 0.1초로 봐요. (단위: 1/100초)
export const normalizeDelay = (d) => (d < 2 ? 10 : d);

// ---------- 읽기 ----------
function lzwDecode(minCodeSize, data, count) {
  const out = new Uint8Array(count);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const prefix = new Int16Array(MAX_CODE);
  const suffix = new Uint8Array(MAX_CODE);
  const stack = new Uint8Array(MAX_CODE + 1);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minCodeSize + 1;
  let mask = (1 << size) - 1;
  let next = clear + 2;
  let old = -1;
  let first = 0;
  let bits = 0;
  let datum = 0;
  let dp = 0;
  let op = 0;
  while (op < count) {
    while (bits < size) {
      if (dp >= data.length) return out; // 끝이 잘린 파일은 있는 만큼만 그려요
      datum |= data[dp++] << bits;
      bits += 8;
    }
    let code = datum & mask;
    datum >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCodeSize + 1;
      mask = (1 << size) - 1;
      next = clear + 2;
      old = -1;
      continue;
    }
    if (code === end) break;
    if (old === -1) {
      if (code >= clear) break; // 잘못된 데이터
      out[op++] = code;
      old = code;
      first = code;
      continue;
    }
    const current = code;
    let sp = 0;
    if (code >= next) {
      if (code > next) break; // 잘못된 데이터
      stack[sp++] = first;
      code = old;
    }
    while (code > clear) {
      stack[sp++] = suffix[code];
      code = prefix[code];
    }
    first = suffix[code];
    stack[sp++] = first;
    if (next < MAX_CODE) {
      prefix[next] = old;
      suffix[next] = first;
      next++;
      if ((next & mask) === 0 && next < MAX_CODE) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    old = current;
    while (sp > 0 && op < count) out[op++] = stack[--sp];
  }
  return out;
}

function deinterlace(indices, w, h) {
  const out = new Uint8Array(indices.length);
  let row = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
    for (let y = start; y < h; y += step) {
      out.set(indices.subarray(row * w, row * w + w), y * w);
      row++;
    }
  }
  return out;
}

export function readGif(bytes) {
  if (!isGif(bytes)) throw new Error('GIF 파일이 아니에요.');
  let p = 6;
  const u8 = () => bytes[p++];
  const u16 = () => {
    const v = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    return v;
  };
  const palette = (n) => {
    const pal = bytes.subarray(p, p + n * 3);
    p += n * 3;
    return pal;
  };
  const skipBlocks = () => {
    for (let n = u8(); n && p < bytes.length; n = u8()) p += n;
  };
  const readBlocks = () => {
    let total = 0;
    let q = p;
    while (q < bytes.length && bytes[q]) {
      total += bytes[q];
      q += bytes[q] + 1;
    }
    const data = new Uint8Array(total);
    let k = 0;
    for (let n = u8(); n && p < bytes.length; n = u8()) {
      data.set(bytes.subarray(p, p + n), k);
      k += n;
      p += n;
    }
    return data.subarray(0, k);
  };

  const width = u16();
  const height = u16();
  const flags = u8();
  p += 2; // 배경색 번호, 화소 비율
  const globalPalette = flags & 0x80 ? palette(2 << (flags & 7)) : null;
  const frames = [];
  let control = null;
  while (p < bytes.length) {
    const block = u8();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = u8();
      if (label === 0xf9 && bytes[p] >= 4) {
        const size = u8();
        const packed = bytes[p];
        control = {
          disposal: (packed >> 2) & 7,
          delay: bytes[p + 1] | (bytes[p + 2] << 8),
          transparent: packed & 1 ? bytes[p + 3] : -1,
        };
        p += size;
      }
      skipBlocks();
      continue;
    }
    if (block !== 0x2c) break; // 알 수 없는 블록이면 여기까지 읽은 것만 써요
    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    const f = u8();
    const pal = f & 0x80 ? palette(2 << (f & 7)) : globalPalette;
    const minCodeSize = u8();
    const data = readBlocks();
    if (!pal || !w || !h || minCodeSize < 2 || minCodeSize > 11) {
      control = null;
      continue;
    }
    let indices = lzwDecode(minCodeSize, data, w * h);
    if (f & 0x40) indices = deinterlace(indices, w, h);
    frames.push({
      x, y, w, h, palette: pal, indices,
      delay: control?.delay ?? 0,
      disposal: control?.disposal ?? 0,
      transparent: control?.transparent ?? -1,
    });
    control = null;
  }
  return { width, height, frames };
}

// 장면을 차례로 겹쳐 그린 전체 화면을 하나씩 내줘요. 내준 배열은 다음 장면에서 다시 쓰니, 필요하면 복사해 두세요.
export function* gifFrames(gif) {
  const { width, height } = gif;
  const screen = new Uint8ClampedArray(width * height * 4);
  for (const f of gif.frames) {
    const saved = f.disposal === 3 ? screen.slice() : null;
    const pal = f.palette;
    for (let row = 0; row < f.h; row++) {
      const y = f.y + row;
      if (y >= height) break;
      for (let col = 0; col < f.w; col++) {
        const x = f.x + col;
        if (x >= width) break;
        const idx = f.indices[row * f.w + col];
        if (idx === f.transparent || idx * 3 + 2 >= pal.length) continue;
        const o = (y * width + x) * 4;
        screen[o] = pal[idx * 3];
        screen[o + 1] = pal[idx * 3 + 1];
        screen[o + 2] = pal[idx * 3 + 2];
        screen[o + 3] = 255;
      }
    }
    yield { rgba: screen, delay: normalizeDelay(f.delay) };
    if (f.disposal === 2) {
      for (let row = 0; row < f.h && f.y + row < height; row++) {
        const start = ((f.y + row) * width + f.x) * 4;
        screen.fill(0, start, start + Math.min(f.w, width - f.x) * 4);
      }
    } else if (saved) {
      screen.set(saved);
    }
  }
}

// ---------- 색 줄이기 ----------
// 색마다 빨강·초록·파랑을 5비트씩 묶은 번호(0~32767)로 세어서, 무게가 큰 상자부터 반씩 나눠요. (median cut)
const keyOf = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const channel = (key, c) => (c === 0 ? key >> 10 : c === 1 ? (key >> 5) & 31 : key & 31);

export function buildPalette(frames, maxColors = 255) {
  const hist = new Uint32Array(32768);
  const pixels = frames.reduce((n, f) => n + f.length / 4, 0);
  const step = Math.max(1, Math.floor(pixels / 1_500_000));
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4, k++) {
      if (k % step || f[i + 3] < 128) continue;
      hist[keyOf(f[i], f[i + 1], f[i + 2])]++;
    }
  }
  const keys = [];
  for (let i = 0; i < 32768; i++) if (hist[i]) keys.push(i);

  const boxOf = (list) => {
    const min = [31, 31, 31];
    const max = [0, 0, 0];
    let count = 0;
    for (const key of list) {
      count += hist[key];
      for (let c = 0; c < 3; c++) {
        const v = channel(key, c);
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const wide = ranges.indexOf(Math.max(...ranges));
    return { list, count, wide, range: ranges[wide] };
  };

  const boxes = keys.length ? [boxOf(keys)] : [];
  while (boxes.length < maxColors) {
    let pick = -1;
    let score = 0;
    boxes.forEach((b, i) => {
      if (b.list.length > 1 && b.range > 0 && b.count * b.range > score) {
        score = b.count * b.range;
        pick = i;
      }
    });
    if (pick < 0) break;
    const { list, wide, count } = boxes[pick];
    list.sort((a, b) => channel(a, wide) - channel(b, wide));
    let acc = 0;
    let cut = 1;
    for (; cut < list.length - 1; cut++) {
      acc += hist[list[cut - 1]];
      if (acc * 2 >= count) break;
    }
    boxes.splice(pick, 1, boxOf(list.slice(0, cut)), boxOf(list.slice(cut)));
  }

  const palette = new Uint8Array(Math.max(1, boxes.length) * 3);
  boxes.forEach((b, i) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const key of b.list) {
      const n = hist[key];
      r += ((channel(key, 0) << 3) | 4) * n;
      g += ((channel(key, 1) << 3) | 4) * n;
      bl += ((channel(key, 2) << 3) | 4) * n;
    }
    palette[i * 3] = Math.round(r / b.count);
    palette[i * 3 + 1] = Math.round(g / b.count);
    palette[i * 3 + 2] = Math.round(bl / b.count);
  });
  return palette;
}

// 화면(RGBA)을 색 번호로 바꿔요. 반쯤 넘게 투명한 점은 transparent 번호가 돼요.
// lut는 같은 팔레트를 쓰는 동안 계속 넘겨 주면 가장 가까운 색을 다시 찾지 않아요.
export function indexFrame(rgba, palette, transparent, lut = new Int16Array(32768).fill(-1)) {
  const n = palette.length / 3;
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    if (rgba[i + 3] < 128) {
      out[j] = transparent;
      continue;
    }
    const key = keyOf(rgba[i], rgba[i + 1], rgba[i + 2]);
    let idx = lut[key];
    if (idx < 0) {
      const r = (channel(key, 0) << 3) | 4;
      const g = (channel(key, 1) << 3) | 4;
      const b = (channel(key, 2) << 3) | 4;
      let best = Infinity;
      for (let c = 0; c < n; c++) {
        const dr = r - palette[c * 3];
        const dg = g - palette[c * 3 + 1];
        const db = b - palette[c * 3 + 2];
        const dist = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (dist < best) {
          best = dist;
          idx = c;
        }
      }
      lut[key] = idx;
    }
    out[j] = idx;
  }
  return { indices: out, lut };
}

// 앞 장면과 같은 점은 투명하게 비우고, 바뀐 곳을 감싸는 네모만 남겨요. 같은 장면이 이어지면 하나로 합쳐요.
// frames: [{ indices(전체 화면 색 번호), delay }]
export function diffFrames(frames, width, height, transparent) {
  const out = [];
  let shown = null;
  for (const f of frames) {
    if (!shown) {
      out.push({ x: 0, y: 0, w: width, h: height, indices: f.indices, delay: f.delay, disposal: 1, transparent: -1 });
      shown = f.indices;
      continue;
    }
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (f.indices[row + x] !== shown[row + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    if (x1 < 0) {
      out[out.length - 1].delay += f.delay;
      continue;
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const part = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y0 + y) * width + x0 + x;
        part[y * w + x] = f.indices[i] === shown[i] ? transparent : f.indices[i];
      }
    }
    out.push({ x: x0, y: y0, w, h, indices: part, delay: f.delay, disposal: 1, transparent });
    shown = f.indices;
  }
  return out;
}

// ---------- 쓰기 ----------
class ByteWriter {
  constructor(size = 1 << 16) {
    this.buf = new Uint8Array(size);
    this.len = 0;
  }

  reserve(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(b) {
    this.reserve(1);
    this.buf[this.len++] = b;
  }

  u16(v) {
    this.byte(v & 0xff);
    this.byte((v >> 8) & 0xff);
  }

  bytes(arr) {
    this.reserve(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  }

  text(s) {
    for (const ch of s) this.byte(ch.charCodeAt(0));
  }

  result() {
    return this.buf.slice(0, this.len);
  }
}

// GIF 압축(LZW). 사전은 해시표에 담아요. (Jef Poskanzer, Kevin Weiner의 GIF 인코더와 같은 방식)
const HSIZE = 5003;
function lzwEncode(pixels, minCodeSize, w) {
  const htab = new Int32Array(HSIZE).fill(-1);
  const codetab = new Int32Array(HSIZE);
  const clear = 1 << minCodeSize;
  const eof = clear + 1;
  let size = minCodeSize + 1;
  let maxcode = (1 << size) - 1;
  let free = clear + 2;
  let clearing = false;
  let accum = 0;
  let bits = 0;
  const block = new Uint8Array(255);
  let blen = 0;
  const flush = () => {
    if (!blen) return;
    w.byte(blen);
    w.bytes(block.subarray(0, blen));
    blen = 0;
  };
  const put = (code) => {
    accum |= code << bits;
    bits += size;
    while (bits >= 8) {
      block[blen++] = accum & 0xff;
      if (blen === 255) flush();
      accum >>>= 8;
      bits -= 8;
    }
    if (free > maxcode || clearing) {
      if (clearing) {
        size = minCodeSize + 1;
        clearing = false;
      } else {
        size++;
      }
      maxcode = size === 12 ? MAX_CODE : (1 << size) - 1;
    }
  };

  w.byte(minCodeSize);
  put(clear);
  let ent = pixels[0];
  outer: for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i];
    const fcode = (c << 12) + ent;
    let h = (c << 4) ^ ent;
    if (htab[h] === fcode) {
      ent = codetab[h];
      continue;
    }
    if (htab[h] >= 0) {
      const disp = h === 0 ? 1 : HSIZE - h;
      do {
        h -= disp;
        if (h < 0) h += HSIZE;
        if (htab[h] === fcode) {
          ent = codetab[h];
          continue outer;
        }
      } while (htab[h] >= 0);
    }
    put(ent);
    ent = c;
    if (free < MAX_CODE) {
      codetab[h] = free++;
      htab[h] = fcode;
    } else {
      htab.fill(-1);
      free = clear + 2;
      clearing = true;
      put(clear);
    }
  }
  put(ent);
  put(eof);
  if (bits > 0) {
    block[blen++] = accum & 0xff;
    if (blen === 255) flush();
  }
  flush();
  w.byte(0);
}

// palette: 색 255가지까지(256번째 자리는 투명용으로 비워 둬요), frames: [{ x, y, w, h, indices, delay, disposal, transparent }]
export function writeGif({ width, height, palette, frames, loop = 0 }) {
  const w = new ByteWriter(Math.min(width * height * frames.length, 1 << 22) + 1024);
  w.text('GIF89a');
  w.u16(width);
  w.u16(height);
  w.byte(0xf7); // 전체 팔레트 256색
  w.byte(0);
  w.byte(0);
  const table = new Uint8Array(768);
  table.set(palette.subarray(0, 768));
  w.bytes(table);
  // 계속 되풀이 (NETSCAPE2.0)
  w.byte(0x21); w.byte(0xff); w.byte(11);
  w.text('NETSCAPE2.0');
  w.byte(3); w.byte(1); w.u16(loop); w.byte(0);
  for (const f of frames) {
    w.byte(0x21); w.byte(0xf9); w.byte(4);
    w.byte(((f.disposal & 7) << 2) | (f.transparent >= 0 ? 1 : 0));
    w.u16(Math.min(65535, Math.max(0, Math.round(f.delay))));
    w.byte(f.transparent >= 0 ? f.transparent : 0);
    w.byte(0);
    w.byte(0x2c);
    w.u16(f.x); w.u16(f.y); w.u16(f.w); w.u16(f.h);
    w.byte(0);
    lzwEncode(f.indices, 8, w);
  }
  w.byte(0x3b);
  return w.result();
}
