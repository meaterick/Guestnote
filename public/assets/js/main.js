// Guestnote 시작점: 날짜별 보드를 열고, 보드에 바로 쓰기·글 고르기·달력·설정을 연결해요.
import userConfig from '../../config.js';
import { $, toast, setupDialog, anyDialogOpen, errorMessage } from './ui.js';
import { dayKey, isDayKey, addDays, describeDay, dayHue, msUntilNextDay } from './dates.js';
import { createStore } from './store.js';
import { createBoard } from './board.js';
import { createWriter } from './writer.js';
import { createSelection } from './selection.js';
import { createCalendar } from './calendar.js';
import { isSafeImageUrl } from './image.js';

const config = {
  siteTitle: 'Guestnote',
  siteSubtitle: '오늘의 방명록',
  timeZone: 'Asia/Seoul',
  emulator: null,
  ...userConfig,
  image: {
    thumbSide: 512,
    thumbBytes: 32 * 1024,
    fullSide: 1200,
    fullBytes: 120 * 1024,
    maxInputBytes: 25 * 1024 * 1024,
    ...userConfig.image,
  },
};
const tz = config.timeZone;
const todayKey = () => dayKey(new Date(), tz);
const PREF_THEME = 'guestnote:theme';
const LITE_AUTO_AT = 80;
const PREF_TIP = 'guestnote:tip-move';
const PAST_ONLY_READ = '지난 보드는 읽기만 할 수 있어요. 글은 오늘 보드에 남겨 주세요.';

const state = {
  store: null,
  today: todayKey(),
  view: null,
  notes: [],
  unsub: null,
};

const root = document.documentElement;
const viewport = $('#viewport');
const dock = $('#dock');

// ---------- 저장해 둔 화면 설정 ----------
function pref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function setPref(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* 저장 공간을 못 쓰는 브라우저 */ }
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

// 글이 아주 많은 보드에서는 메모장의 유리 흐림을 꺼서, 휴대폰에서도 부드럽게 움직이게 해요.
function applyLite() {
  root.classList.toggle('lite', state.notes.length > LITE_AUTO_AT);
}

applyTheme(pref(PREF_THEME));

// ---------- 그날의 빛깔 ----------
const hues = { h1: null, h2: null, h3: null };
// 색상각이 360을 넘어가도 같은 색이라, 가까운 쪽으로 돌아가게 값을 맞춰요.
function nearestAngle(prev, next) {
  if (prev === null) return next;
  let v = next;
  while (v - prev > 180) v -= 360;
  while (prev - v > 180) v += 360;
  return v;
}

function applyLight(key) {
  const base = dayHue(key);
  const next = { h1: base, h2: base + 48, h3: base - 48 };
  for (const k of Object.keys(next)) {
    hues[k] = nearestAngle(hues[k], next[k]);
    root.style.setProperty(`--${k}`, hues[k].toFixed(1));
  }
  $('meta[name="theme-color"]').setAttribute('content', `oklch(0.9 0.05 ${base.toFixed(0)})`);
}

// ---------- 머리말: 날짜, 남은 시간 ----------
function renderHeader() {
  const isToday = state.view === state.today;
  const d = describeDay(state.view);
  const sameYear = d.year === describeDay(state.today).year;
  $('#dateMain').textContent = sameYear ? `${d.month}월 ${d.day}일` : `${d.year}년 ${d.month}월 ${d.day}일`;
  $('#dateSub').textContent = `${d.weekday}요일`;
  $('#dateBadge').textContent = isToday ? '오늘' : '지난 보드';
  $('#dateBtn').setAttribute('aria-label', `${d.year}년 ${d.month}월 ${d.day}일${isToday ? ' 오늘' : ''}, 달력 열기`);
  $('#nextDay').disabled = isToday;
  $('#todayBtn').hidden = isToday;
  document.body.classList.toggle('is-past', !isToday);
  document.title = isToday ? `${config.siteTitle} ${config.siteSubtitle}` : `${d.month}월 ${d.day}일의 보드 - ${config.siteTitle}`;
  updateCountdown();
  renderDock();
}

function updateCountdown() {
  const left = msUntilNextDay(tz);
  const hrs = Math.floor(left / 3_600_000);
  const mins = Math.max(1, Math.ceil((left % 3_600_000) / 60_000));
  const text = hrs ? `${hrs}시간 ${mins === 60 ? 0 : mins}분` : `${mins}분`;
  $('#resetChip').textContent = `새 보드까지 ${text}`;
}

// ---------- 보드 안내 문구 ----------
function setBoardMessage(kind) {
  const box = $('#boardMessage');
  const isToday = state.view === state.today;
  const messages = {
    loading: ['보드를 펼치는 중…', ''],
    empty: isToday
      ? ['오늘의 첫 글을 남겨 주세요', '빈 곳을 두 번 누르면 그 자리에 바로 쓸 수 있어요.']
      : ['이 날에는 남겨진 글이 없어요', '날짜를 눌러 달력에서 다른 날을 골라 보세요.'],
    error: ['보드를 불러오지 못했어요', '인터넷 연결을 확인하고 새로고침해 주세요.'],
  };
  const m = messages[kind];
  box.hidden = !m;
  box.dataset.kind = kind;
  if (m) {
    $('#boardMessageTitle').textContent = m[0];
    $('#boardMessageHint').textContent = m[1];
  }
}

// ---------- 아래 막대 ----------
// 쓰는 중 > 글을 고른 중 > 오늘 / 지난 보드 순서로 보여 줘요.
function renderDock() {
  dock.dataset.mode = writer?.active ? 'write'
    : selection?.active ? 'pick'
      : state.view === state.today ? 'today' : 'past';
  // 쓰는 동안에는 보드 가운데의 큰 안내 글씨를 감춰요.
  $('#boardMessage').classList.toggle('is-hushed', !!writer?.active);
}

// ---------- 권한 ----------
// 지난 보드는 관리자도 읽기만 해요. (firestore.rules 와 같아요)
const perms = {
  isMine: (n) => !!state.store?.uid && n.ownerId === state.store.uid,
  canMove: (n) => !!state.store?.canWrite && n.date === state.today && (state.store.isAdmin || perms.isMine(n)),
  canEdit: (n) => !!state.store?.canWrite && n.date === state.today && perms.isMine(n),
  canDelete: (n) => !!state.store?.canWrite && n.date === state.today && (state.store.isAdmin || perms.isMine(n)),
};

const boardCtx = () => ({ uid: state.store?.uid, canMove: perms.canMove });

// ---------- 날짜 이동 ----------
function routeKey() {
  const m = /^#\/?(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
  return m && isDayKey(m[1]) && m[1] < state.today ? m[1] : state.today;
}

function urlFor(key) {
  return key === state.today ? location.pathname + location.search : `#/${key}`;
}

function goTo(key) {
  const target = key > state.today ? state.today : key;
  // 쓰던 글이 있으면 지난 보드로 가기 전에 먼저 올리거나 그만두게 해요.
  if (writer?.active && target !== state.today) {
    if (!writer.isEmpty) {
      toast('쓰던 글을 먼저 올리거나 취소해 주세요.');
      writer.focus();
      return;
    }
    writer.cancel();
  }
  if (target !== routeKey() || (target === state.today && location.hash)) history.pushState(null, '', urlFor(target));
  openDay(target);
}

function openDay(key) {
  if (!state.store) return;
  if (state.view === key && state.unsub) return;
  if (key !== state.today) writer?.cancel();
  selection?.clear();
  state.unsub?.();
  state.unsub = null;
  state.view = key;
  state.notes = [];
  applyLight(key);
  board.reset();
  renderHeader();
  setBoardMessage('loading');
  let first = true;
  state.unsub = state.store.subscribeDay(key, (notes) => {
    if (state.view !== key) return;
    state.notes = notes;
    board.setNotes(notes, boardCtx());
    selection?.sync(notes);
    if (key === state.today) calendar?.noteCountChanged(key, notes.length);
    setBoardMessage(notes.length ? null : 'empty');
    applyLite();
    if (first) {
      first = false;
      // 쓰는 중이면 보던 자리를 그대로 둬요.
      if (!writer?.active) board.fit({ animate: false });
    }
  }, (err) => {
    console.error(err);
    if (state.view !== key) return;
    // 다른 날짜로 갔다가 돌아오면 다시 불러와요.
    state.unsub = null;
    setBoardMessage('error');
    const message = err?.code === 'permission-denied'
      ? '보드를 읽을 권한이 없어요. Firebase 보안 규칙을 게시했는지 확인해 주세요.'
      : errorMessage(err, '보드를 불러오지 못했어요. 새로고침해 주세요.');
    toast(message, { tone: 'error', duration: 6000 });
  });
}

// 자정이 지나면 오늘 보드를 새로 열어요. 쓰던 새 글은 그대로 두고 새 보드에 올려요.
function checkDay() {
  const now = todayKey();
  if (now !== state.today) {
    const wasToday = state.view === state.today;
    state.today = now;
    if (writer?.editingId) {
      writer.cancel();
      toast('자정이 지나서 어제 글은 더 고칠 수 없어요.', { duration: 5200 });
    }
    if (wasToday && state.store) {
      history.replaceState(null, '', location.pathname + location.search);
      openDay(now);
      toast('새로운 하루가 시작됐어요. 어제의 보드는 날짜를 눌러 볼 수 있어요.', { duration: 5200 });
    } else if (state.view) {
      renderHeader();
    }
  }
  updateCountdown();
  clearTimeout(checkDay.timer);
  checkDay.timer = setTimeout(checkDay, Math.min(msUntilNextDay(tz) + 400, 30_000));
}

// ---------- 글쓰기 ----------
// at: 글상자를 열 보드 좌표, file: 처음부터 넣을 사진
function startWriting(opts = {}) {
  if (!state.store) return;
  if (!state.store.canWrite) {
    askSignIn(opts);
    return;
  }
  if (state.view !== state.today) goTo(state.today);
  selection.clear();
  writer.start({ ...opts, defaultAuthor: state.store.user?.name ?? '' });
}

async function submitNote({ mode, note, id, data, image, pos }) {
  if (mode === 'edit') {
    await state.store.updateNote(note, { ...data, x: pos.x, y: pos.y }, image);
    toast('고친 내용을 저장했어요.');
    return;
  }
  checkDay();
  await state.store.createNote({ ...data, date: state.today, x: pos.x, y: pos.y, z: board.maxZ + 1 }, image, id);
  // 처음 한 번만 옮기는 방법을 알려 줘요.
  if (!pref(PREF_TIP)) {
    setPref(PREF_TIP, '1');
    toast('보드에 붙였어요. 내 글은 오늘 안에서 끌어서 옮길 수 있어요.', { duration: 4200 });
  }
}

async function moveNote(note, pos) {
  try {
    await state.store.moveNote(note.id, pos);
  } catch (err) {
    toast(errorMessage(err, '자리를 옮기지 못했어요. 잠시 후 다시 시도해 주세요.'), { tone: 'error' });
    throw err;
  }
}

// ---------- 화면 요소 연결 ----------
function chromeInsets() {
  const top = $('.topbar').getBoundingClientRect().bottom + 12;
  const bar = dock.getBoundingClientRect();
  const bottom = bar.height ? window.innerHeight - bar.top + 12 : 24;
  return { top, bottom, left: 16, right: 16 };
}

const board = createBoard({
  viewport,
  world: $('#world'),
  layer: $('#notes'),
  handlers: {
    insets: chromeInsets,
    onSelect(note, { keyboard } = {}) {
      if (!writer.active) selection?.select(note, { keyboard });
    },
    // 두 번 누르면: 고칠 수 있는 내 글은 바로 고치고, 사진은 크게 봐요.
    onActivate(note) {
      if (writer.active) return;
      if (perms.canEdit(note)) {
        selection?.clear();
        writer.start({ note });
      } else if (isSafeImageUrl(note.img)) {
        selection?.openPhoto(note);
      }
    },
    onEmptyTap() {
      selection?.clear();
      writer.dismissIfEmpty();
    },
    onEmptyActivate(at) {
      if (state.view !== state.today) {
        toast(PAST_ONLY_READ);
        return;
      }
      startWriting({ at });
    },
    onMove: moveNote,
  },
});

const writer = createWriter({
  layer: $('#drafts'),
  bar: $('#writeBar'),
  board,
  imageOptions: config.image,
  newId: () => state.store.newNoteId(),
  onSubmit: submitNote,
  onChange: renderDock,
});

let selection = null;
let calendar = null;

$('#writeBtn').addEventListener('click', () => startWriting());
$('#backToToday').addEventListener('click', () => goTo(state.today));
$('#todayBtn').addEventListener('click', () => goTo(state.today));
$('#prevDay').addEventListener('click', () => goTo(addDays(state.view, -1)));
$('#nextDay').addEventListener('click', () => goTo(addDays(state.view, 1)));
$('#dateBtn').addEventListener('click', () => calendar?.open(state.view));

// 사진은 보드에 끌어다 놓거나 붙여 넣어도 돼요. 쓰는 중이면 그 글에, 아니면 새 글상자에 넣어요.
const imageFileOf = (list) => [...(list ?? [])].find((f) => f.type.startsWith('image/'));
const draggingFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

function takeImage(file, at = null) {
  if (writer.active) {
    writer.attach(file);
  } else if (state.view !== state.today) {
    toast(PAST_ONLY_READ);
  } else {
    startWriting({ at, file });
  }
}

document.addEventListener('dragover', (e) => {
  if (!draggingFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  viewport.classList.add('is-dropping');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) viewport.classList.remove('is-dropping');
});
document.addEventListener('drop', (e) => {
  viewport.classList.remove('is-dropping');
  if (!draggingFiles(e)) return;
  // 브라우저가 사진 파일을 열어 버리지 않게 막아요.
  e.preventDefault();
  if (anyDialogOpen()) return;
  const file = imageFileOf(e.dataTransfer.files);
  if (!file) {
    toast('사진 파일만 넣을 수 있어요.', { tone: 'error' });
    return;
  }
  takeImage(file, viewport.contains(e.target) ? board.toWorld(e.clientX, e.clientY) : null);
});
document.addEventListener('paste', (e) => {
  if (anyDialogOpen()) return;
  // 글자는 글상자에 그대로 붙고, 사진만 따로 받아요.
  const file = imageFileOf(e.clipboardData?.files);
  if (!file) return;
  e.preventDefault();
  takeImage(file);
});

// 단축키: + / - 확대·축소, 0 전체 보기, N 글쓰기, [ ] 날짜 이동, Esc 그만두기
document.addEventListener('keydown', (e) => {
  if (anyDialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const onNote = !!e.target.closest?.('.note');
  if (e.key === '+' || e.key === '=') board.zoomBy(1.25);
  else if (e.key === '-' || e.key === '_') board.zoomBy(0.8);
  else if (e.key === '0') board.fit();
  else if (e.code === 'KeyN') {
    e.preventDefault();
    if (state.view === state.today) startWriting();
    else toast(PAST_ONLY_READ);
  } else if (e.key === 'Escape') {
    if (writer.active) writer.cancel();
    else selection?.clear({ refocus: true });
  } else if (e.code === 'BracketLeft') goTo(addDays(state.view, -1));
  else if (e.code === 'BracketRight' && state.view < state.today) goTo(addDays(state.view, 1));
  else if (!onNote && e.key.startsWith('Arrow')) {
    const d = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    e.preventDefault();
    board.panBy(d[0] * 120, d[1] * 120);
  }
});

window.addEventListener('popstate', () => openDay(routeKey()));
window.addEventListener('hashchange', () => openDay(routeKey()));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkDay();
});

// 휴대폰 키보드가 올라오면 아래 막대(글쓰기 도구)를 키보드 바로 위로 올리고, 글상자가 보이게 옮겨요.
if (window.visualViewport) {
  const vv = window.visualViewport;
  let lastKb = 0;
  const syncKeyboard = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (kb === lastKb) return;
    lastKb = kb;
    root.style.setProperty('--kb', `${kb}px`);
    if (writer.active) requestAnimationFrame(() => writer.reveal());
  };
  vv.addEventListener('resize', syncKeyboard);
  vv.addEventListener('scroll', syncKeyboard);
}
// 알림은 아래 막대 바로 위에 떠요. 막대 높이가 바뀌면 같이 올라가요.
new ResizeObserver(() => root.style.setProperty('--dock-h', `${dock.offsetHeight}px`)).observe(dock);

// ---------- Google 로그인 ----------
// 카카오톡 같은 앱 안의 브라우저에서는 Google이 로그인을 막아서, 다른 브라우저로 열도록 안내해요.
const UA = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const inKakao = /KAKAOTALK/i.test(UA);
const inInstagram = /Instagram/i.test(UA);
const inAppBrowser = inKakao || inInstagram || /FBAN|FBAV|Line\/|NAVER\(inapp|DaumApps|everytimeApp|; wv\)/i.test(UA);

// 앱 안 브라우저에서는 Google 로그인 버튼 대신 브라우저로 여는 방법을 보여 줘요.
// 카카오톡은 바로 열기, 아이폰은 Safari로 열기, 안드로이드는 메뉴 안내와 주소 복사를 써요.
if (inAppBrowser) {
  const appName = inKakao ? '카카오톡' : inInstagram ? '인스타그램' : '이 앱';
  $('#inAppHint').hidden = false;
  $('#googleSignIn').hidden = true;
  $('#inAppText').textContent = `${appName} 안에서 연 화면에서는 Google이 로그인을 막아요. 브라우저로 열면 바로 글을 남길 수 있어요.`;
  const open = $('#openExternal');
  open.hidden = !(inKakao || isIOS);
  open.textContent = inKakao ? '다른 브라우저로 열기' : 'Safari로 열기';
  $('#inAppTip').textContent = inKakao ? ''
    : isIOS ? '열리지 않으면 오른쪽 위 ⋯ 메뉴에서 ‘외부 브라우저에서 열기’를 눌러 주세요.'
      : '오른쪽 위 ⋮ 메뉴에서 ‘다른 브라우저로 열기’를 누르거나, 주소를 복사해서 크롬에 붙여 넣어 주세요.';
}
const signin = setupDialog($('#signin'), { onClose() { pendingWrite = null; } });
let pendingWrite = null;

function askSignIn(next = null) {
  pendingWrite = next;
  $('#signinError').hidden = true;
  signin.open();
}

function signInErrorMessage(err) {
  const code = err?.code || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  if (code === 'auth/popup-blocked') return '로그인 창이 막혔어요. 브라우저에서 팝업을 허용한 뒤 다시 눌러 주세요.';
  if (code === 'auth/unauthorized-domain') return '이 주소에서는 아직 로그인할 수 없어요. 사이트 관리자가 Firebase의 승인된 도메인에 이 주소를 추가해야 해요.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return 'Google 로그인이 아직 꺼져 있어요. 사이트 관리자가 Firebase에서 Google 로그인을 켜야 해요.';
  }
  if (code === 'auth/network-request-failed') return '인터넷 연결을 확인하고 다시 시도해 주세요.';
  if (code === 'auth/web-storage-unsupported' || code === 'auth/operation-not-supported-in-this-environment') {
    return '이 브라우저에서는 로그인할 수 없어요. 크롬이나 사파리로 열어 주세요.';
  }
  return '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

$('#googleSignIn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  $('#signinError').hidden = true;
  try {
    // 팝업이 막히지 않게 다른 일보다 먼저 로그인 창을 열어요.
    await state.store.signIn();
    const next = pendingWrite;
    signin.close();
    toast(`${state.store.user?.name || '방문자'}님, 반가워요.`);
    if (next) startWriting(next);
  } catch (err) {
    // 사용자가 로그인 창을 닫은 경우에는 아무 말도 하지 않아요.
    const message = signInErrorMessage(err);
    if (message) {
      $('#signinError').textContent = message;
      $('#signinError').hidden = false;
      console.warn(err);
    }
  } finally {
    btn.disabled = false;
  }
});

$('#openExternal').addEventListener('click', () => {
  const url = location.href;
  location.href = inKakao ? `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}` : `x-safari-${url}`;
});

// 앱 안 브라우저는 클립보드 API를 막기도 해서, 예전 방식으로 한 번 더 시도해요.
$('#copyLink').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const url = location.href;
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    const field = Object.assign(document.createElement('textarea'), { value: url });
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    btn.after(field);
    field.select();
    copied = document.execCommand('copy');
    field.remove();
  }
  btn.textContent = copied ? '주소를 복사했어요' : '직접 복사해 주세요';
  if (!copied) $('#inAppTip').textContent = url;
  setTimeout(() => { btn.textContent = '주소 복사'; }, 2500);
});

// ---------- 프로필: 화면 설정과 로그아웃 ----------
function renderAccount() {
  const btn = $('#accountBtn');
  const user = state.store?.user;
  btn.classList.toggle('is-signed-in', !!user);
  if (user) {
    const label = user.name || user.email || '내 계정';
    btn.textContent = [...label.trim()][0]?.toUpperCase() ?? '나';
    btn.setAttribute('aria-label', `${label} 계정, 화면 설정과 로그아웃`);
    btn.title = label;
  } else {
    btn.textContent = '로그인';
    btn.setAttribute('aria-label', 'Google로 로그인');
    btn.removeAttribute('title');
  }
}

const profile = setupDialog($('#profile'));

$('#accountBtn').addEventListener('click', () => {
  if (!state.store) return;
  if (!state.store.user) {
    askSignIn();
    return;
  }
  const theme = pref(PREF_THEME) ?? 'auto';
  for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === theme;
  profile.open();
});

$('#signOutBtn').addEventListener('click', async () => {
  try {
    await state.store.signOut();
    profile.close();
    toast('로그아웃했어요.');
  } catch {
    toast('로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.', { tone: 'error' });
  }
});

$('#profile').addEventListener('change', (e) => {
  if (e.target.name !== 'theme') return;
  const v = e.target.value === 'auto' ? null : e.target.value;
  setPref(PREF_THEME, v);
  applyTheme(v);
});

// 로그인하거나 로그아웃하면 '내 글' 표시와 옮기기 권한을 다시 그려요.
function onAuthChanged() {
  if (!state.store.user) writer.cancel();
  board.setNotes(state.notes, boardCtx());
  selection.refresh();
  renderAccount();
  $('#adminChip').hidden = !state.store.isAdmin;
}

// ---------- 시작 ----------
$('#brandName').textContent = config.siteTitle;
$('#brandSub').textContent = config.siteSubtitle;
state.view = routeKey();
applyLight(state.view);
renderHeader();
setBoardMessage('loading');
board.fit({ animate: false });
checkDay();

try {
  state.store = await createStore(config);
} catch (err) {
  console.error(err);
  setBoardMessage('error');
  $('#writeBtn').disabled = true;
}

if (state.store) {
  selection = createSelection({
    bar: $('#pickBar'),
    viewer: $('#viewer'),
    store: state.store,
    timeZone: tz,
    permissions: perms,
    board,
    onEdit: (note) => writer.start({ note }),
    onChange: renderDock,
  });
  calendar = createCalendar({
    dialog: $('#calendar'),
    store: state.store,
    getToday: () => state.today,
    onPick: goTo,
  });
  $('#adminChip').hidden = !state.store.isAdmin;
  renderAccount();
  state.store.onAuthChange(onAuthChanged);
  const start = routeKey();
  if (location.hash && start === state.today) history.replaceState(null, '', location.pathname + location.search);
  state.view = null;
  openDay(start);
}
document.body.classList.add('is-ready');
