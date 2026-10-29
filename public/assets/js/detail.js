// 글 자세히 보기 창: 전체 내용, 큰 사진, 고치기/지우기
import { $, setupDialog, errorMessage } from './ui.js';
import { TYPES } from './notes.js';
import { formatDateTime } from './dates.js';
import { isSafeImageUrl } from './image.js';

export function createDetail({ dialog, store, timeZone, permissions, onEdit, onDeleted }) {
  const panel = $('.detail', dialog);
  const typeEl = $('#detailType', dialog);
  const fig = $('#detailFigure', dialog);
  const img = $('#detailImg', dialog);
  const textEl = $('#detailText', dialog);
  const authorEl = $('#detailAuthor', dialog);
  const timeEl = $('#detailTime', dialog);
  const mineEl = $('#detailMine', dialog);
  const actions = $('#detailActions', dialog);
  const editBtn = $('#detailEdit', dialog);
  const deleteBtn = $('#detailDelete', dialog);
  const confirmBox = $('#deleteConfirm', dialog);
  const confirmYes = $('#deleteYes', dialog);
  const confirmNo = $('#deleteNo', dialog);
  const status = $('#detailStatus', dialog);

  let current = null;
  let ticket = 0;
  const modal = setupDialog(dialog, { onClose() { ticket += 1; current = null; } });

  function setConfirm(on) {
    confirmBox.hidden = !on;
    actions.hidden = on || (editBtn.hidden && deleteBtn.hidden);
    if (on) confirmNo.focus();
  }

  async function loadFull(note, my) {
    if (!note.imgFull) return;
    try {
      const full = await store.getFullImage(note.id);
      if (my === ticket && isSafeImageUrl(full)) img.src = full;
    } catch {
      // 큰 사진을 못 불러와도 작은 사진은 그대로 보여요.
    }
  }

  function render(note) {
    const type = TYPES[note.type] ?? TYPES.guest;
    dialog.dataset.tint = note.color;
    panel.dataset.type = note.type;
    typeEl.textContent = `${note.author}님의 ${type.label}`;
    textEl.textContent = note.text;
    textEl.hidden = !note.text;
    authorEl.textContent = note.author;
    timeEl.textContent = formatDateTime(note.createdAt, timeZone);
    timeEl.dateTime = new Date(note.createdAt).toISOString();
    mineEl.hidden = !permissions.isMine(note);
    const hasImg = isSafeImageUrl(note.img);
    fig.hidden = !hasImg;
    if (hasImg) {
      img.src = note.img;
      img.alt = note.text ? `${note.author}님이 올린 사진: ${note.text.slice(0, 60)}` : `${note.author}님이 올린 사진`;
    } else {
      img.removeAttribute('src');
    }
    editBtn.hidden = !permissions.canEdit(note);
    deleteBtn.hidden = !permissions.canDelete(note);
    deleteBtn.textContent = permissions.isMine(note) ? '지우기' : '관리자 권한으로 지우기';
    status.textContent = '';
    setConfirm(false);
  }

  editBtn.addEventListener('click', () => {
    const note = current;
    modal.close();
    if (note) onEdit(note);
  });
  deleteBtn.addEventListener('click', () => setConfirm(true));
  confirmNo.addEventListener('click', () => {
    setConfirm(false);
    deleteBtn.focus();
  });
  confirmYes.addEventListener('click', async () => {
    const note = current;
    if (!note) return;
    confirmYes.disabled = true;
    status.textContent = '';
    try {
      await store.deleteNote(note);
      modal.close();
      onDeleted(note);
    } catch (err) {
      status.textContent = errorMessage(err, '지우지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      confirmYes.disabled = false;
    }
  });

  return {
    open(note) {
      current = note;
      const my = ++ticket;
      render(note);
      modal.open();
      loadFull(note, my);
    },
    // 보고 있는 글이 바뀌거나 지워지면 창도 맞춰요.
    sync(notes) {
      if (!current) return;
      const next = notes.find((n) => n.id === current.id);
      if (!next) {
        modal.close();
        return;
      }
      // 위치만 바뀐 경우에는 다시 그리지 않아요. (큰 사진이 깜빡이지 않게)
      const changed = ['text', 'author', 'color', 'type', 'img'].some((k) => next[k] !== current[k]);
      current = next;
      if (changed && confirmBox.hidden) {
        render(next);
        loadFull(next, ++ticket);
      }
    },
    close: () => modal.close(),
  };
}
