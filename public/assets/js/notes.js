// 보드에 붙는 글(노트) 한 장을 그려요.
import { h } from './ui.js';
import { isSafeImageUrl } from './image.js';

// 글 모양: 글자(보드에 바로 쓴 글씨, 기본)와 메모장(유리 메모지)
export const STYLES = {
  text: { label: '글자' },
  memo: { label: '메모장' },
};

// hue는 OKLCH 색상각이에요. 'clear'는 색 없이 맑은 유리(글자는 기본 잉크색)예요.
export const TINTS = [
  { id: 'clear', label: '기본', hue: null },
  { id: 'sky', label: '하늘', hue: 235 },
  { id: 'lilac', label: '라일락', hue: 305 },
  { id: 'rose', label: '장미', hue: 355 },
  { id: 'peach', label: '복숭아', hue: 55 },
  { id: 'lemon', label: '레몬', hue: 98 },
  { id: 'mint', label: '민트', hue: 168 },
];

export const LIMITS = { author: 20, text: 500, draw: 30000 };

// 글꼴. scale은 같은 크기에서도 글꼴마다 달라 보이는 글자 크기를 맞추는 값이에요.
export const FONTS = [
  { id: 'pen', label: '손글씨', family: "'Nanum Pen Script', cursive", scale: 1 },
  { id: 'brush', label: '붓글씨', family: "'Nanum Brush Script', cursive", scale: 1 },
  { id: 'dodum', label: '돋움', family: "'Gowun Dodum', sans-serif", scale: 0.62 },
  { id: 'batang', label: '바탕', family: "'Gowun Batang', serif", scale: 0.62 },
  { id: 'jua', label: '동글', family: "'Jua', sans-serif", scale: 0.7 },
];
export const fontOf = (id) => FONTS.find((f) => f.id === id) ?? FONTS[0];

// 글자·사진·그림 크기 (1 = 기본). 보안 규칙의 목록과 같아요.
export const SIZES = [0.6, 0.8, 1, 1.3, 1.7, 2.2];
export const sizeOf = (v) => (SIZES.includes(v) ? v : 1);

// 손그림: 선의 좌표를 'x y x y …' 로 적고 선 사이는 ';' 로 나눠요. 좌표는 DRAW 크기 안의 정수예요.
// 사진처럼 무겁지 않고, 크게 키워도 선명해요.
export const DRAW = { w: 600, h: 450, stroke: 6 };

export function parseDraw(text) {
  if (typeof text !== 'string' || !/^[0-9 ;]+$/.test(text)) return [];
  return text.split(';').map((part) => {
    const n = part.trim().split(/\s+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < n.length; i += 2) {
      if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) pts.push([Math.min(n[i], DRAW.w), Math.min(n[i + 1], DRAW.h)]);
    }
    return pts;
  }).filter((pts) => pts.length);
}

export const encodeDraw = (strokes) => strokes.filter((s) => s.length).map((s) => s.map(([x, y]) => `${x} ${y}`).join(' ')).join(';');

// 한 점만 찍은 선도 보이게 아주 짧은 선으로 그려요.
export const pathOf = (pts) => (pts.length === 1
  ? `M${pts[0][0]} ${pts[0][1]}l0.01 0`
  : `M${pts.map(([x, y]) => `${x} ${y}`).join('L')}`);

const SVG = 'http://www.w3.org/2000/svg';
export function drawingSvg(strokes) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${DRAW.w} ${DRAW.h}`);
  svg.setAttribute('class', 'note__ink');
  svg.setAttribute('aria-hidden', 'true');
  for (const pts of strokes) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', pathOf(pts));
    svg.append(path);
  }
  return svg;
}

// 작성자 이름: 닉네임을 정했으면 닉네임, 아니면 '익명'이에요. (보안 규칙의 authorName()과 같아요)
export const accountAuthor = (name = '') => ((name || '').trim() || '익명').slice(0, LIMITS.author);

export function photoRatio(note) {
  const r = note.imgW && note.imgH ? note.imgW / note.imgH : 4 / 3;
  return Math.min(2, Math.max(0.62, r));
}

function content(note, photo) {
  const parts = [];
  if (isSafeImageUrl(photo)) {
    const fig = h('figure', { class: 'note__photo' },
      h('img', { src: photo, alt: '', decoding: 'async', draggable: 'false' }));
    fig.style.aspectRatio = String(photoRatio(note));
    parts.push(fig);
  }
  const strokes = parseDraw(note.draw);
  if (strokes.length) parts.push(h('figure', { class: 'note__drawing' }, drawingSvg(strokes)));
  if (note.text) parts.push(h('p', { class: 'note__text', text: note.text }));
  parts.push(h('footer', { class: 'note__foot' },
    h('span', { class: 'note__sign', text: note.author })));
  return parts;
}

const painted = new WeakMap();

// ctx.photo(note): 움직이는 GIF를 다 불러왔으면 그 주소 (아직이면 작은 사진을 보여 줘요)
export function paintNote(el, note, ctx) {
  const photo = ctx.photo?.(note) || note.img;
  // 내용이 그대로면 다시 그리지 않아요. (사진이 깜빡이지 않게)
  const sig = [note.author, note.text, photo, note.imgW, note.imgH, note.draw];
  const prev = painted.get(el);
  if (!prev || prev.some((v, i) => v !== sig[i])) {
    painted.set(el, sig);
    el.replaceChildren(...content(note, photo));
  }
  // 옮기는 중 같은 다른 상태 표시는 건드리지 않게 하나씩 바꿔요.
  const style = STYLES[note.type] ? note.type : 'text';
  const hasPhoto = isSafeImageUrl(note.img);
  el.classList.toggle('note--text', style === 'text');
  el.classList.toggle('note--memo', style === 'memo');
  el.classList.toggle('has-photo', hasPhoto);
  el.classList.toggle('has-drawing', !!note.draw);
  applyLook(el, note);
  el.dataset.tint = TINTS.some((t) => t.id === note.color) ? note.color : 'clear';
  el.classList.toggle('is-mine', note.ownerId === ctx.uid);
  el.classList.toggle('is-movable', ctx.canMove(note));
  el.style.setProperty('--rot', `${Number(note.rot) || 0}deg`);
  const what = hasPhoto ? (note.text ? '사진과 글' : '사진') : note.draw ? (note.text ? '그림과 글' : '그림') : '글';
  const excerpt = note.text ? `: ${note.text.slice(0, 80)}` : '';
  el.setAttribute('aria-label', `${note.author}님의 ${what}${excerpt}`);
}

// 글꼴과 크기는 CSS 변수로 넘겨요. (--s: 크기, --fs: 글꼴 보정, --ff: 글꼴)
export function applyLook(el, { font, size } = {}) {
  const f = fontOf(font);
  el.style.setProperty('--s', String(sizeOf(size)));
  el.style.setProperty('--fs', String(f.scale));
  el.style.setProperty('--ff', f.family);
  el.dataset.font = f.id;
}

export function createNoteElement(note) {
  return h('article', { class: 'note', tabindex: '0', role: 'button', dataset: { id: note.id } });
}
