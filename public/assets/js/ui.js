// 화면 공통 도우미: 요소 만들기, 알림(토스트), 대화상자 열고 닫기

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) el.append(c);
  }
  return el;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let toastBox;
export function toast(message, { tone = 'info', duration = 2800 } = {}) {
  toastBox ??= $('#toasts');
  // 같은 알림이 떠 있으면 새로 쌓지 않고 시간만 늘려요. 한 번에 두 개까지만 보여요.
  let t = [...toastBox.children].find((el) => el.textContent === message && !el.classList.contains('is-leaving'));
  if (!t) {
    t = h('div', { class: `toast toast--${tone}`, role: tone === 'error' ? 'alert' : 'status' }, message);
    toastBox.append(t);
    while (toastBox.children.length > 2) toastBox.firstElementChild.remove();
  }
  clearTimeout(t.timer);
  t.timer = setTimeout(() => {
    t.classList.add('is-leaving');
    t.addEventListener('animationend', () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 600);
  }, duration);
}

// <dialog> 공통 동작: 바깥(어두운 배경)을 누르거나 [data-close] 버튼으로 닫기
export function setupDialog(dialog, { onClose } = {}) {
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnBackdrop) dialog.close();
    if (e.target.closest('[data-close]')) dialog.close();
  });
  dialog.addEventListener('close', () => onClose?.());
  return {
    open() {
      if (!dialog.open) dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    },
    get isOpen() {
      return dialog.open;
    },
  };
}

export function anyDialogOpen() {
  return !!document.querySelector('dialog[open]');
}

export function errorMessage(err, fallback = '잠시 후 다시 시도해 주세요.') {
  const code = err?.code || '';
  if (code === 'permission-denied') return '권한이 없어서 저장하지 못했어요. 날짜가 바뀌었다면 새로고침해 주세요.';
  if (code === 'unavailable' || code === 'deadline-exceeded') return '인터넷 연결이 불안정해요. 연결을 확인하고 다시 시도해 주세요.';
  if (code === 'resource-exhausted') return '오늘 사용할 수 있는 저장 용량을 다 썼어요. 내일 다시 시도해 주세요.';
  if (err?.name === 'QuotaExceededError') return '브라우저 저장 공간이 가득 찼어요. 오래된 글이나 사진을 지워 주세요.';
  return err?.message && !code ? err.message : fallback;
}
