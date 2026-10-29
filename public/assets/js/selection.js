// 고른 글: 글을 한 번 누르면 아래 막대에 쓴 사람과 시간이 나오고, 권한에 따라 크게 보기·고치기·지우기를 할 수 있어요.
import { $, setupDialog, errorMessage, toast } from './ui.js';
import { formatTime } from './dates.js';
import { isSafeImageUrl } from './image.js';

export function createSelection({ bar, viewer, store, timeZone, permissions, board, onEdit, onChange }) {
  const author = $('#pickAuthor', bar);
  const time = $('#pickTime', bar);
  const mine = $('#pickMine', bar);
  const actions = $('#pickActions', bar);
  const viewBtn = $('#pickView', bar);
  const editBtn = $('#pickEdit', bar);
  const deleteBtn = $('#pickDelete', bar);
  const closeBtn = $('#pickClose', bar);
  const confirmBox = $('#pickConfirm', bar);
  const yes = $('#pickYes', bar);
  const no = $('#pickNo', bar);
  const photo = $('#viewerImg', viewer);

  let current = null;
  let ticket = 0;
  const lightbox = setupDialog(viewer, {
    onClose() {
      ticket += 1;
      photo.removeAttribute('src');
    },
  });

  function setConfirm(on) {
    confirmBox.hidden = !on;
    actions.hidden = on;
    if (on) no.focus();
  }

  function render() {
    const n = current;
    author.textContent = n.author;
    time.textContent = formatTime(n.createdAt, timeZone);
    time.dateTime = new Date(n.createdAt).toISOString();
    mine.hidden = !permissions.isMine(n);
    viewBtn.hidden = !isSafeImageUrl(n.img);
    editBtn.hidden = !permissions.canEdit(n);
    deleteBtn.hidden = !permissions.canDelete(n);
    deleteBtn.textContent = permissions.isMine(n) ? '지우기' : '관리자로 지우기';
    setConfirm(false);
  }

  function select(note, { keyboard = false } = {}) {
    current = note;
    board.select(note.id);
    render();
    onChange();
    if (keyboard) [...actions.querySelectorAll('button')].find((b) => !b.hidden)?.focus();
  }

  function clear({ refocus = false } = {}) {
    if (!current) return;
    const id = current.id;
    current = null;
    board.select(null);
    onChange();
    if (refocus) board.elementOf(id)?.focus({ preventScroll: true });
  }

  // 큰 사진은 누를 때만 불러와요. 먼저 작은 사진을 보여 주고, 다 받으면 바꿔요.
  async function openPhoto(note) {
    if (!isSafeImageUrl(note.img)) return;
    const my = ++ticket;
    photo.src = note.img;
    photo.alt = note.text ? `${note.author}님이 올린 사진: ${note.text.slice(0, 60)}` : `${note.author}님이 올린 사진`;
    lightbox.open();
    if (!note.imgFull) return;
    try {
      const full = await store.getFullImage(note.id);
      if (my === ticket && isSafeImageUrl(full)) photo.src = full;
    } catch {
      // 큰 사진을 못 불러와도 작은 사진은 그대로 보여요.
    }
  }

  photo.addEventListener('click', () => lightbox.close());
  viewBtn.addEventListener('click', () => current && openPhoto(current));
  editBtn.addEventListener('click', () => {
    const note = current;
    clear();
    if (note) onEdit(note);
  });
  deleteBtn.addEventListener('click', () => setConfirm(true));
  no.addEventListener('click', () => {
    setConfirm(false);
    deleteBtn.focus();
  });
  yes.addEventListener('click', async () => {
    const note = current;
    if (!note) return;
    yes.disabled = true;
    try {
      await store.deleteNote(note);
      if (current?.id === note.id) clear();
      toast('글을 지웠어요.');
    } catch (err) {
      toast(errorMessage(err, '지우지 못했어요. 잠시 후 다시 시도해 주세요.'), { tone: 'error' });
    } finally {
      yes.disabled = false;
    }
  });
  closeBtn.addEventListener('click', () => clear({ refocus: true }));
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      clear({ refocus: true });
    }
  });

  return {
    select,
    clear,
    openPhoto,
    // 고른 글이 바뀌거나 지워지면 막대도 맞춰요.
    sync(notes) {
      if (!current) return;
      const next = notes.find((n) => n.id === current.id);
      if (!next) return clear();
      current = next;
      if (confirmBox.hidden) render();
    },
    // 로그인 상태가 바뀌면 고치기·지우기 버튼을 다시 정해요.
    refresh() {
      if (current && confirmBox.hidden) render();
    },
    get active() {
      return !!current;
    },
  };
}
