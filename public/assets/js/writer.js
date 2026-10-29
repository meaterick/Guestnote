// 보드에 바로 쓰기
// 빈 곳을 두 번 누르거나 '글 남기기'를 누르면 그 자리에 글상자가 열려요. 창을 띄우지 않고 보드 위에서 바로 써요.
// 아래 도구 막대에서 모양(글자/메모장)과 색을 고르고, 사진을 넣은 뒤 '올리기'를 눌러요.
// 사진은 버튼, 끌어 놓기, 붙여 넣기로 넣을 수 있고, 올리기 전에 브라우저에서 줄여요.
import { $, h, toast, errorMessage } from './ui.js';
import { STYLES, TINTS, LIMITS, photoRatio } from './notes.js';
import { compressImage, formatBytes, isSafeImageUrl, ImageError } from './image.js';

const NAME_KEY = 'guestnote:author';

function remembered(key) {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장 공간을 못 쓰는 브라우저 */ }
}

const randomTilt = () => Math.round((Math.random() * 5 - 2.5) * 10) / 10 || 0.5;
const touchFirst = () => window.matchMedia('(pointer: coarse)').matches;

function describe(result) {
  const from = formatBytes(result.original.bytes);
  const to = formatBytes(result.thumb.bytes + (result.full?.bytes ?? 0));
  const gif = result.original.animated ? ' 움직이는 GIF는 첫 장면만 남아요.' : '';
  return `사진을 ${from} → ${to}로 줄였어요.${gif}`;
}

// onSubmit({ mode, note, id, data, image, pos }) 저장이 끝나면 풀리는 Promise
// newId()   새 글의 문서 id
// onChange() 글쓰기를 시작하거나 마쳤을 때
export function createWriter({ layer, bar, board, imageOptions, newId, onSubmit, onChange }) {
  const tintBox = $('#writeTints', bar);
  const photoBtn = $('#writePhoto', bar);
  const fileInput = $('#photoInput', bar);
  const cancelBtn = $('#writeCancel', bar);
  const submitBtn = $('#writeSubmit', bar);

  tintBox.replaceChildren(...TINTS.map((t) => h('label', { class: 'swatch', title: t.label, dataset: { tint: t.id } },
    h('input', { type: 'radio', name: 'tint', value: t.id, 'aria-label': t.label }),
    h('span', { class: 'swatch__chip', 'aria-hidden': 'true' }))));

  // 지금 쓰고 있는 글상자. 한 번에 하나만 열어요.
  let d = null;

  function build() {
    const text = h('textarea', {
      class: 'draft__text', rows: '1', cols: '1', maxlength: String(LIMITS.text),
      placeholder: '여기에 바로 적어요', 'aria-label': '글 내용', enterkeyhint: 'send',
    });
    const grow = h('div', { class: 'note__text draft__grow' }, text);
    const img = h('img', { alt: '넣은 사진', draggable: 'false' });
    const unphoto = h('button', { class: 'draft__unphoto', type: 'button', 'aria-label': '사진 빼기', title: '사진 빼기' });
    unphoto.innerHTML = '<svg aria-hidden="true"><use href="#i-close"/></svg>';
    const fig = h('figure', { class: 'note__photo draft__photo', hidden: true },
      img, h('span', { class: 'draft__busy', text: '사진을 줄이는 중…' }), unphoto);
    const name = h('input', {
      class: 'note__sign draft__name', maxlength: String(LIMITS.author), placeholder: '이름',
      'aria-label': '이름', autocomplete: 'nickname', enterkeyhint: 'send',
    });
    const el = h('div', { class: 'note is-draft', role: 'group', 'aria-label': '쓰는 중인 글' },
      fig, grow, h('footer', { class: 'note__foot' }, h('span', { class: 'note__dash', text: '—', 'aria-hidden': 'true' }), name));

    text.addEventListener('input', () => {
      grow.dataset.value = text.value;
      sync();
      // 글이 길어져 화면 밖으로 넘어가면 따라가요.
      board.reveal(rect());
    });
    unphoto.addEventListener('click', removePhoto);
    // Enter로 바로 올리고, 줄은 Shift+Enter로 바꿔요.
    // 한글처럼 글자를 조합하는 중에 누른 Enter는 그 글자를 마무리하는 키라서 올리지 않아요. (두 번 올라가거나 마지막 글자가 빠지지 않게)
    el.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey && (e.target === text || e.target === name)) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    img.addEventListener('load', () => d && reveal());
    return { el, text, grow, fig, img, name };
  }

  // ---------- 자리와 보이기 ----------
  function place(x, y) {
    d.x = x;
    d.y = y;
    d.el.style.translate = `${x}px ${y}px`;
  }

  function rect() {
    return { x: d.x, y: d.y, w: d.el.offsetWidth, h: d.el.offsetHeight };
  }

  // 누른 곳에 첫 줄이 오도록 놓고, 자리가 없으면 화면 가운데 근처의 빈자리를 찾아요.
  function spotFor(at) {
    const { w, h: ht } = rect();
    return at ? board.clampPos(at.x - 18, at.y - 30, w, ht) : board.findSpot(w, ht);
  }

  function reveal({ at = null, start = false } = {}) {
    if (!d) return;
    // 휴대폰에서는 키보드가 올라와도 가리지 않게 위쪽으로 올리고, 바로 커서를 둘 수 있게 움직임 없이 옮겨요.
    const high = start && touchFirst();
    board.focusOn(rect(), { at, high, animate: start && !high, minScale: start ? 0.9 : 0 });
  }

  function focus() {
    if (!d || d.busy) return;
    d.text.focus({ preventScroll: true });
  }

  // ---------- 모양, 색, 사진 ----------
  function setStyle(style, rot = null) {
    d.style = STYLES[style] ? style : 'text';
    d.el.classList.toggle('note--text', d.style === 'text');
    d.el.classList.toggle('note--memo', d.style === 'memo');
    d.rot = d.style === 'memo' ? (rot || randomTilt()) : 0;
    d.el.style.setProperty('--rot', `${d.rot}deg`);
    sync();
  }

  function setTint(id) {
    d.tint = TINTS.some((t) => t.id === id) ? id : 'clear';
    d.el.dataset.tint = d.tint;
    sync();
  }

  function hasPhoto() {
    return d.image ? true : d.image === undefined && isSafeImageUrl(d.note?.img);
  }

  function showPhoto(src, ratio) {
    d.fig.hidden = !src;
    d.el.classList.toggle('has-photo', !!src);
    if (src) {
      d.img.src = src;
      d.fig.style.aspectRatio = String(ratio);
    } else {
      d.img.removeAttribute('src');
    }
  }

  async function attach(file) {
    if (!d || d.busy || !file) return;
    const ticket = ++d.working;
    const draft = d;
    draft.compressing = true;
    draft.fig.hidden = false;
    draft.fig.classList.add('is-working');
    if (!draft.img.getAttribute('src')) draft.fig.style.aspectRatio = '4 / 3';
    draft.el.classList.add('has-photo');
    sync();
    try {
      const result = await compressImage(file, imageOptions);
      if (d !== draft || ticket !== draft.working) return;
      draft.image = result;
      showPhoto(result.thumb.dataUrl, photoRatio({ imgW: result.thumb.width, imgH: result.thumb.height }));
      // 자리를 직접 고르지 않은 글상자는 사진만큼 커진 크기로 빈자리를 다시 찾아요. (다른 글을 덮지 않게)
      if (draft.auto) {
        const p = spotFor(null);
        place(p.x, p.y);
      }
      toast(describe(result));
    } catch (err) {
      if (d !== draft || ticket !== draft.working) return;
      toast(err instanceof ImageError ? err.message : '사진을 열지 못했어요. 다른 사진을 골라 주세요.', { tone: 'error' });
      showPhoto(draft.img.getAttribute('src'), draft.fig.style.aspectRatio);
    } finally {
      if (d === draft && ticket === draft.working) {
        draft.compressing = false;
        draft.fig.classList.remove('is-working');
        sync();
        reveal();
      }
    }
  }

  function removePhoto() {
    if (!d || d.busy) return;
    d.working += 1;
    d.compressing = false;
    d.fig.classList.remove('is-working');
    d.image = null;
    showPhoto(null);
    sync();
    focus();
  }

  // ---------- 도구 막대 ----------
  function sync() {
    if (!d) return;
    const edit = d.mode === 'edit';
    for (const input of bar.querySelectorAll('input[name="style"]')) input.checked = input.value === d.style;
    for (const input of bar.querySelectorAll('input[name="tint"]')) input.checked = input.value === d.tint;
    for (const input of bar.querySelectorAll('input')) input.disabled = d.busy;
    photoBtn.disabled = d.busy;
    cancelBtn.disabled = d.busy;
    submitBtn.disabled = d.busy || d.compressing;
    submitBtn.textContent = d.busy ? (edit ? '저장하는 중…' : '올리는 중…') : (edit ? '저장' : '올리기');
    d.el.classList.toggle('is-saving', d.busy);
    d.text.readOnly = d.busy;
    d.name.readOnly = d.busy;
  }

  bar.addEventListener('change', (e) => {
    if (!d || d.busy) return;
    if (e.target.name === 'style') {
      setStyle(e.target.value);
      board.reveal(rect());
    } else if (e.target.name === 'tint') {
      setTint(e.target.value);
    }
  });
  // 도구를 눌러도 글상자의 커서가 그대로 있게 해요. (휴대폰 키보드가 내려가지 않게)
  bar.addEventListener('mousedown', (e) => {
    if (d && e.target.closest('label, #writePhoto')) e.preventDefault();
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && d) {
      e.preventDefault();
      cancel();
    }
  });
  photoBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    attach(fileInput.files[0]);
    fileInput.value = '';
  });
  cancelBtn.addEventListener('click', () => cancel());
  submitBtn.addEventListener('click', () => commit());

  // ---------- 시작, 올리기, 그만두기 ----------
  // at: 글상자를 열 보드 좌표 (없으면 화면 가운데 근처 빈자리)
  // note: 고칠 내 글 / file: 처음부터 넣을 사진 / defaultAuthor: 처음 쓸 때 채울 이름(Google 계정 이름)
  function start({ at = null, note = null, file = null, defaultAuthor = '' } = {}) {
    if (d) {
      // 이미 쓰는 중이면 그 글상자를 누른 곳으로 옮기고 이어서 써요.
      if (at && !d.busy) {
        const p = spotFor(at);
        d.auto = false;
        place(p.x, p.y);
        reveal({ at });
      }
      if (file) attach(file);
      focus();
      return;
    }
    d = {
      ...build(), mode: note ? 'edit' : 'create', note, id: null,
      // image: undefined = 원래 사진 그대로, null = 사진 없음, 객체 = 새로 줄인 사진
      image: note ? undefined : null,
      working: 0, compressing: false, busy: false, x: 0, y: 0, style: 'text', tint: 'clear', rot: 0,
      auto: !note && !at, // 자리를 직접 고르지 않았는지
    };
    setStyle(note?.type ?? 'text', note?.rot);
    setTint(note?.color ?? 'clear');
    d.text.value = note?.text ?? '';
    d.grow.dataset.value = d.text.value;
    d.name.value = note ? note.author : (remembered(NAME_KEY) || defaultAuthor).trim().slice(0, LIMITS.author);
    if (note && isSafeImageUrl(note.img)) showPhoto(note.img, photoRatio(note));
    layer.append(d.el);
    if (note) {
      board.hold(note.id);
      place(note.x, note.y);
    } else {
      const p = spotFor(at);
      place(p.x, p.y);
    }
    sync();
    onChange();
    reveal({ at, start: true });
    focus();
    const end = d.text.value.length;
    d.text.setSelectionRange(end, end);
    if (file) attach(file);
  }

  function close() {
    const { el, note, id } = d;
    d.working += 1;
    d = null;
    el.remove();
    if (note) board.release(note.id);
    if (id) board.release(id);
    onChange();
  }

  function cancel() {
    if (d && !d.busy) close();
  }

  async function commit() {
    if (!d || d.busy) return;
    if (d.compressing) {
      toast('사진을 줄이는 중이에요. 잠시만 기다려 주세요.');
      return;
    }
    const text = d.text.value.replace(/\s+$/, '').slice(0, LIMITS.text);
    const author = d.name.value.trim().slice(0, LIMITS.author);
    if (!text.trim() && !hasPhoto()) {
      toast('내용을 적거나 사진을 넣어 주세요.');
      focus();
      return;
    }
    if (!author) {
      toast('이름을 적어 주세요.');
      d.name.focus({ preventScroll: true });
      return;
    }
    const { w, h: ht } = rect();
    const pos = board.clampPos(d.x, d.y, w, ht);
    const data = { type: d.style, author, text: text.trim() ? text : '', color: d.tint, rot: d.rot };
    const draft = d;
    if (draft.mode === 'create') {
      // 저장되는 동안 보드에 먼저 나타나는 같은 글은 숨겨 두고, 글상자를 그대로 보여 줘요.
      draft.id ??= newId();
      board.hold(draft.id);
    }
    draft.busy = true;
    sync();
    try {
      remember(NAME_KEY, author);
      await onSubmit({ mode: draft.mode, note: draft.note, id: draft.id, data, image: draft.image, pos });
      if (d === draft) close();
    } catch (err) {
      console.warn(err);
      if (d !== draft) return;
      draft.busy = false;
      if (draft.id) board.release(draft.id);
      sync();
      toast(errorMessage(err, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'), { tone: 'error', duration: 5000 });
      focus();
    }
  }

  return {
    start,
    attach,
    cancel,
    commit,
    focus,
    // 빈 곳을 눌렀을 때: 아무것도 안 쓴 새 글상자는 닫아요.
    dismissIfEmpty() {
      if (d && d.mode === 'create' && !d.busy && !d.compressing && !d.text.value.trim() && !hasPhoto()) close();
    },
    // 키보드가 올라오거나 화면 크기가 바뀌면 글상자가 보이게 옮겨요.
    reveal: () => reveal(),
    get active() {
      return !!d;
    },
    get isEmpty() {
      return !d || (!d.compressing && !d.text.value.trim() && !hasPhoto());
    },
    get editingId() {
      return d?.mode === 'edit' ? d.note.id : null;
    },
  };
}
