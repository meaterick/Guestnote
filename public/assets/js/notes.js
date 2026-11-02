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

export const LIMITS = { author: 20, text: 500 };

// 기존 Firestore 보안 규칙과의 호환용 값이에요. 화면에는 이름을 표시하지 않아요.
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
  if (note.text) parts.push(h('p', { class: 'note__text', text: note.text }));
  return parts;
}

const painted = new WeakMap();

// ctx.photo(note): 움직이는 GIF를 다 불러왔으면 그 주소 (아직이면 작은 사진을 보여 줘요)
export function paintNote(el, note, ctx) {
  const photo = ctx.photo?.(note) || note.img;
  // 내용이 그대로면 다시 그리지 않아요. (사진이 깜빡이지 않게)
  const sig = [note.text, photo, note.imgW, note.imgH];
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
  el.dataset.tint = TINTS.some((t) => t.id === note.color) ? note.color : 'clear';
  el.classList.toggle('is-mine', note.ownerId === ctx.uid);
  el.classList.toggle('is-movable', ctx.canMove(note));
  el.style.setProperty('--rot', `${Number(note.rot) || 0}deg`);
  const what = hasPhoto ? (note.text ? '사진과 글' : '사진') : '글';
  const excerpt = note.text ? `: ${note.text.slice(0, 80)}` : '';
  el.setAttribute('aria-label', `${what}${excerpt}`);
}

export function createNoteElement(note) {
  return h('article', { class: 'note', tabindex: '0', role: 'button', dataset: { id: note.id } });
}
