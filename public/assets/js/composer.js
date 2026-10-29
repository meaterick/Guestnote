// 글 남기기 / 고치기 창
import { $, h, setupDialog, errorMessage } from './ui.js';
import { TYPES, TINTS, LIMITS } from './notes.js';
import { compressImage, formatBytes, ImageError } from './image.js';

const NAME_KEY = 'guestnote:author';

function remembered(key, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장 공간을 못 쓰는 브라우저 */ }
}

export function createComposer({ dialog, imageOptions, onSubmit }) {
  const form = $('form', dialog);
  const title = $('#composerTitle', dialog);
  const submit = $('#composerSubmit', dialog);
  const error = $('#composerError', dialog);
  const count = $('#textCount', dialog);
  const text = form.elements.text;
  const author = form.elements.author;
  const fileInput = $('#photoInput', dialog);
  const pick = $('#photoPick', dialog);
  const preview = $('#photoPreview', dialog);
  const previewImg = $('img', preview);
  const previewInfo = $('#photoInfo', dialog);
  const removeBtn = $('#photoRemove', dialog);
  const swatches = $('#tintSwatches', dialog);

  author.maxLength = LIMITS.author;
  text.maxLength = LIMITS.text;

  swatches.replaceChildren(...TINTS.map((t, i) => h('label', { class: 'swatch', title: t.label, dataset: { tint: t.id } },
    h('input', { type: 'radio', name: 'color', value: t.id, checked: i === 0, 'aria-label': t.label }),
    h('span', { class: 'swatch__chip', 'aria-hidden': 'true' }))));

  let state = { mode: 'create', note: null, at: null };
  // image: undefined = 손대지 않음, null = 사진 없음, 객체 = 새로 줄인 사진
  let image;
  let working = 0;
  let busy = false;

  const modal = setupDialog(dialog, {
    onClose() {
      working += 1;
      busy = false;
    },
  });

  function setType(type) {
    form.elements.type.value = type;
    text.placeholder = TYPES[type].placeholder;
    dialog.dataset.type = type;
  }

  function updateCount() {
    count.textContent = `${text.value.length} / ${LIMITS.text}`;
  }

  function showError(msg) {
    error.textContent = msg || '';
    error.hidden = !msg;
  }

  function showPhoto(src, info) {
    preview.hidden = !src;
    pick.hidden = !!src;
    if (src) previewImg.src = src;
    else previewImg.removeAttribute('src');
    previewInfo.textContent = info || '';
  }

  function describe(result) {
    const kept = result.full ?? result.thumb;
    const from = formatBytes(result.original.bytes);
    const to = formatBytes(result.thumb.bytes + (result.full?.bytes ?? 0));
    const gif = result.original.animated ? ' 움직이는 GIF는 첫 장면만 저장돼요.' : '';
    return `${from} → ${to}로 줄였어요. (${kept.width}×${kept.height})${gif}`;
  }

  async function useFile(file) {
    if (!file) return;
    const ticket = ++working;
    showError('');
    pick.disabled = true;
    pick.classList.add('is-working');
    $('.dropzone__label', pick).textContent = '사진을 줄이는 중…';
    try {
      const result = await compressImage(file, imageOptions);
      if (ticket !== working) return;
      image = result;
      showPhoto(result.thumb.dataUrl, describe(result));
      if (form.elements.type.value !== 'photo' && !text.value.trim()) setType('photo');
    } catch (err) {
      if (ticket !== working) return;
      showError(err instanceof ImageError ? err.message : '사진을 열지 못했어요. 다른 사진을 골라 주세요.');
    } finally {
      if (ticket === working) {
        pick.disabled = false;
        pick.classList.remove('is-working');
        $('.dropzone__label', pick).textContent = '사진 추가';
      }
    }
  }

  form.addEventListener('change', (e) => {
    if (e.target.name === 'type') setType(e.target.value);
  });
  text.addEventListener('input', updateCount);
  pick.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    useFile(fileInput.files[0]);
    fileInput.value = '';
  });
  removeBtn.addEventListener('click', () => {
    working += 1;
    image = null;
    showPhoto(null);
    pick.focus();
  });

  // 붙여 넣기와 끌어 놓기로도 사진을 넣을 수 있어요.
  dialog.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      useFile(file);
    }
  });
  dialog.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      dialog.classList.add('is-dropping');
    }
  });
  dialog.addEventListener('dragleave', (e) => {
    if (e.target === dialog || !dialog.contains(e.relatedTarget)) dialog.classList.remove('is-dropping');
  });
  dialog.addEventListener('drop', (e) => {
    e.preventDefault();
    dialog.classList.remove('is-dropping');
    useFile([...e.dataTransfer.files].find((f) => f.type.startsWith('image/')));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (pick.classList.contains('is-working')) {
      showError('사진을 줄이는 중이에요. 잠시만 기다려 주세요.');
      return;
    }
    const data = {
      type: form.elements.type.value,
      author: author.value.trim().slice(0, LIMITS.author),
      text: text.value.replace(/\s+$/, '').slice(0, LIMITS.text),
      color: form.elements.color.value || 'clear',
    };
    const hasPhoto = image ? true : image === undefined && !!state.note?.img;
    if (!data.author) {
      showError('이름을 적어 주세요.');
      author.focus();
      return;
    }
    if (data.type === 'photo' && !hasPhoto) {
      showError('사진 글에는 사진이 필요해요. 사진을 추가해 주세요.');
      pick.focus();
      return;
    }
    if (!data.text.trim() && !hasPhoto) {
      showError('내용을 적거나 사진을 추가해 주세요.');
      text.focus();
      return;
    }
    if (!data.text.trim()) data.text = '';
    busy = true;
    submit.disabled = true;
    submit.textContent = state.mode === 'edit' ? '저장하는 중…' : '붙이는 중…';
    showError('');
    try {
      remember(NAME_KEY, data.author);
      await onSubmit({ ...state, data, image: state.mode === 'edit' ? image : image ?? null });
      modal.close();
    } catch (err) {
      showError(errorMessage(err, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = state.mode === 'edit' ? '저장' : '붙이기';
    }
  });

  return {
    // at: 글을 붙일 보드 좌표 (없으면 빈자리를 찾아요)
    open({ mode = 'create', note = null, at = null, file = null } = {}) {
      state = { mode, note, at };
      working += 1;
      image = mode === 'edit' ? undefined : null;
      busy = false;
      form.reset();
      showError('');
      submit.disabled = false;
      pick.disabled = false;
      pick.classList.remove('is-working');
      $('.dropzone__label', pick).textContent = '사진 추가';
      if (mode === 'edit') {
        title.textContent = '글 고치기';
        submit.textContent = '저장';
        setType(note.type);
        author.value = note.author;
        text.value = note.text;
        form.elements.color.value = note.color;
        showPhoto(note.img || null, note.img ? '지금 붙어 있는 사진이에요.' : '');
      } else {
        title.textContent = '오늘의 보드에 남기기';
        submit.textContent = '붙이기';
        setType(file ? 'photo' : 'guest');
        author.value = remembered(NAME_KEY);
        showPhoto(null);
      }
      updateCount();
      modal.open();
      (author.value ? text : author).focus();
      if (file) useFile(file);
    },
    close: () => modal.close(),
    get isOpen() {
      return modal.isOpen;
    },
  };
}
