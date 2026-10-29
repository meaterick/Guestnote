// 보드에 붙는 글(노트) 한 장을 그려요.
import { h } from './ui.js';
import { formatTime } from './dates.js';
import { isSafeImageUrl } from './image.js';

export const TYPES = {
  guest: { label: '방명록', width: 256, placeholder: '다녀간 흔적을 남겨 주세요.' },
  memo: { label: '메모', width: 224, placeholder: '떠오르는 대로 자유롭게 적어 보세요.' },
  photo: { label: '사진', width: 264, placeholder: '사진에 대한 한마디를 남겨 주세요. (선택)' },
};

// hue는 OKLCH 색상각이에요. 'clear'는 색 없이 맑은 유리예요.
export const TINTS = [
  { id: 'clear', label: '맑은 유리', hue: null },
  { id: 'sky', label: '하늘', hue: 235 },
  { id: 'lilac', label: '라일락', hue: 305 },
  { id: 'rose', label: '장미', hue: 355 },
  { id: 'peach', label: '복숭아', hue: 55 },
  { id: 'lemon', label: '레몬', hue: 98 },
  { id: 'mint', label: '민트', hue: 168 },
];

export const LIMITS = { author: 20, text: 500 };

export function noteWidth(type) {
  return (TYPES[type] ?? TYPES.guest).width;
}

// 아직 그려지지 않은 글의 높이를 대강 짐작해요. (빈자리 찾기용)
export function estimateHeight(type, hasImage, text = '') {
  const w = noteWidth(type);
  const perLine = type === 'memo' ? 13 : 17;
  const lineH = type === 'memo' ? 28 : 24;
  const lines = Math.min(type === 'photo' ? 3 : 9, Math.ceil((text.length || 1) / perLine) + (text.match(/\n/g)?.length ?? 0));
  return 64 + (text ? lines * lineH : 0) + (hasImage ? Math.round((w - 24) * 0.75) + 10 : 0);
}

function photoRatio(note) {
  const r = note.imgW && note.imgH ? note.imgW / note.imgH : 4 / 3;
  return note.type === 'photo' ? Math.min(2, Math.max(0.62, r)) : Math.min(2.2, Math.max(1.1, r));
}

function content(note, ctx) {
  const parts = [];
  if (isSafeImageUrl(note.img)) {
    const fig = h('figure', { class: 'note__photo' },
      h('img', { src: note.img, alt: '', decoding: 'async', draggable: 'false' }));
    fig.style.aspectRatio = String(photoRatio(note));
    parts.push(fig);
  }
  if (note.text) parts.push(h('p', { class: 'note__text', text: note.text }));
  parts.push(h('footer', { class: 'note__foot' },
    h('span', { class: 'note__sign', text: note.author }),
    h('span', { class: 'note__meta' },
      note.ownerId === ctx.uid ? h('span', { class: 'note__mine', text: '내 글' }) : null,
      h('time', { text: formatTime(note.createdAt, ctx.timeZone) }))));
  return parts;
}

const painted = new WeakMap();

export function paintNote(el, note, ctx) {
  // 내용이 그대로면 다시 그리지 않아요. (사진이 깜빡이지 않게)
  const sig = [note.type, note.color, note.author, note.text, note.img, note.imgW, note.imgH,
    note.createdAt, note.ownerId === ctx.uid];
  const prev = painted.get(el);
  if (!prev || prev.some((v, i) => v !== sig[i])) {
    painted.set(el, sig);
    el.replaceChildren(...content(note, ctx));
  }
  const type = TYPES[note.type] ? note.type : 'guest';
  el.className = `note note--${type}`;
  el.dataset.tint = TINTS.some((t) => t.id === note.color) ? note.color : 'clear';
  el.classList.toggle('is-mine', note.ownerId === ctx.uid);
  el.classList.toggle('is-movable', ctx.canMove(note));
  el.style.setProperty('--rot', `${Number(note.rot) || 0}deg`);
  const excerpt = note.text ? `: ${note.text.slice(0, 80)}` : '';
  el.setAttribute('aria-label', `${note.author}님의 ${TYPES[type].label}${excerpt}`);
}

export function createNoteElement(note) {
  return h('article', { class: 'note', tabindex: '0', role: 'button', dataset: { id: note.id } });
}
