// Guestnote 시작점: 날짜별 보드를 열고, 글쓰기·보기·달력·설정을 연결해요.
import userConfig from '../../config.js';
import { $, toast, setupDialog, anyDialogOpen, errorMessage } from './ui.js';
import { dayKey, isDayKey, addDays, describeDay, dayHue, msUntilNextDay } from './dates.js';
import { createStore } from './store/index.js';
import { createBoard } from './board.js';
import { createComposer } from './composer.js';
import { createDetail } from './detail.js';
import { createCalendar } from './calendar.js';
import { noteWidth, estimateHeight } from './notes.js';

const config = {
  siteTitle: 'Guestnote',
  siteSubtitle: '오늘의 방명록',
  timeZone: 'Asia/Seoul',
  firebase: null,
  emulator: null,
  ...userConfig,
  image: {
    thumbSide: 640,
    thumbBytes: 48 * 1024,
    fullSide: 1600,
    fullBytes: 300 * 1024,
    maxInputBytes: 25 * 1024 * 1024,
    ...userConfig.image,
  },
};
const tz = config.timeZone;
const todayKey = () => dayKey(new Date(), tz);
const PREF_THEME = 'guestnote:theme';
const PREF_LITE = 'guestnote:lite';
const LITE_AUTO_AT = 80;

const state = {
  store: null,
  today: todayKey(),
  view: null,
  notes: [],
  unsub: null,
};

const root = document.documentElement;
const viewport = $('#viewport');

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

function applyLite() {
  const p = pref(PREF_LITE);
  const on = p === 'on' || (p === null && state.notes.length > LITE_AUTO_AT);
  root.classList.toggle('lite', on);
}

applyTheme(pref(PREF_THEME));
applyLite();

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
}

function updateCountdown() {
  const left = msUntilNextDay(tz);
  const hrs = Math.floor(left / 3_600_000);
  const mins = Math.max(1, Math.ceil((left % 3_600_000) / 60_000));
  const text = hrs ? `${hrs}시간 ${mins === 60 ? 0 : mins}분` : `${mins}분`;
  $('#resetChip').textContent = `새 보드까지 ${text}`;
  $('#infoReset').textContent = `오늘 보드는 ${text} 뒤에 닫히고, 자정에 새 보드가 열려요.`;
}

// ---------- 보드 안내 문구 ----------
function setBoardMessage(kind) {
  const box = $('#boardMessage');
  const isToday = state.view === state.today;
  const messages = {
    loading: ['보드를 펼치는 중…', ''],
    empty: isToday
      ? ['오늘의 첫 글을 남겨 주세요', '빈 곳을 두 번 누르면 그 자리에 붙어요.']
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

// ---------- 권한 ----------
const perms = {
  isMine: (n) => !!state.store?.uid && n.ownerId === state.store.uid,
  canMove: (n) => !!state.store?.canWrite && (state.store.isAdmin || (perms.isMine(n) && n.date === state.today)),
  canEdit: (n) => !!state.store?.canWrite && perms.isMine(n) && n.date === state.today,
  canDelete: (n) => !!state.store?.canWrite && (perms.isMine(n) || state.store.isAdmin),
};

const boardCtx = () => ({ uid: state.store?.uid, timeZone: tz, canMove: perms.canMove });

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
  if (target !== routeKey() || (target === state.today && location.hash)) history.pushState(null, '', urlFor(target));
  openDay(target);
}

function openDay(key) {
  if (!state.store) return;
  if (state.view === key && state.unsub) return;
  state.unsub?.();
  state.unsub = null;
  state.view = key;
  state.notes = [];
  applyLight(key);
  renderHeader();
  board.reset();
  setBoardMessage('loading');
  let first = true;
  state.unsub = state.store.subscribeDay(key, (notes) => {
    if (state.view !== key) return;
    state.notes = notes;
    board.setNotes(notes, boardCtx());
    detail?.sync(notes);
    if (key === state.today) calendar?.noteCountChanged(key, notes.length);
    setBoardMessage(notes.length ? null : 'empty');
    applyLite();
    if (first) {
      first = false;
      board.fit({ animate: false });
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

// 자정이 지나면 오늘 보드를 새로 열어요.
function checkDay() {
  const now = todayKey();
  if (now !== state.today) {
    const wasToday = state.view === state.today;
    state.today = now;
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
function startWriting({ at = null, file = null } = {}) {
  if (!state.store) return;
  if (state.store.needsSignIn && !state.store.canWrite) {
    askSignIn({ at, file });
    return;
  }
  if (state.view !== state.today) goTo(state.today);
  composer.open({ at, file, defaultAuthor: state.store.user?.name });
}

function randomTilt() {
  return Math.round((Math.random() * 5 - 2.5) * 10) / 10;
}

async function submitNote({ mode, note, at, data, image }) {
  if (mode === 'edit') {
    await state.store.updateNote(note, data, image);
    toast('고친 내용을 저장했어요.');
    return;
  }
  checkDay();
  const date = state.today;
  if (state.view !== date) goTo(date);
  const w = noteWidth(data.type);
  const hgt = estimateHeight(data.type, !!image, data.text);
  const pos = at ? board.clampPos(at.x - w / 2, at.y - 36, w, hgt) : board.findSpot(w, hgt);
  const created = await state.store.createNote({
    ...data, date, x: pos.x, y: pos.y, z: board.maxZ + 1, rot: randomTilt(),
  }, image);
  board.flashWhenReady(created.id);
  board.reveal({ x: pos.x, y: pos.y, w, h: hgt });
  toast('보드에 붙였어요. 내 글은 끌어서 옮길 수 있어요.');
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
  const dock = $('.dock').getBoundingClientRect();
  const bottom = dock.height ? window.innerHeight - dock.top + 12 : 24;
  return { top, bottom, left: 16, right: 16 };
}

let lastZoomLabel = '';
const board = createBoard({
  viewport,
  world: $('#world'),
  layer: $('#notes'),
  minimap: $('#minimap'),
  handlers: {
    insets: chromeInsets,
    onView(view) {
      const label = `${Math.round(view.s * 100)}%`;
      if (label !== lastZoomLabel) {
        lastZoomLabel = label;
        $('#zoomLabel').textContent = label;
      }
    },
    onOpen: (note) => detail?.open(note),
    onMove: moveNote,
    onEmptyActivate(at) {
      if (state.view !== state.today) {
        toast('지난 보드에는 글을 남길 수 없어요. 오늘 보드에 남겨 주세요.');
        return;
      }
      startWriting({ at });
    },
  },
});

const composer = createComposer({
  dialog: $('#composer'),
  imageOptions: config.image,
  onSubmit: submitNote,
});

let detail = null;
let calendar = null;

$('#writeBtn').addEventListener('click', () => startWriting());
$('#backToToday').addEventListener('click', () => goTo(state.today));
$('#todayBtn').addEventListener('click', () => goTo(state.today));
$('#prevDay').addEventListener('click', () => goTo(addDays(state.view, -1)));
$('#nextDay').addEventListener('click', () => goTo(addDays(state.view, 1)));
$('#dateBtn').addEventListener('click', () => calendar?.open(state.view));
$('#zoomIn').addEventListener('click', () => board.zoomBy(1.25));
$('#zoomOut').addEventListener('click', () => board.zoomBy(0.8));
$('#zoomLabel').addEventListener('click', () => board.zoomTo(1));
$('#zoomFit').addEventListener('click', () => board.fit());

// 사진 파일을 보드에 끌어다 놓거나 붙여 넣으면 바로 글쓰기 창이 열려요.
const imageFileOf = (list) => [...(list ?? [])].find((f) => f.type.startsWith('image/'));
viewport.addEventListener('dragover', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  viewport.classList.add('is-dropping');
});
viewport.addEventListener('dragleave', (e) => {
  if (!viewport.contains(e.relatedTarget)) viewport.classList.remove('is-dropping');
});
viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  viewport.classList.remove('is-dropping');
  const file = imageFileOf(e.dataTransfer.files);
  if (!file) return;
  if (state.view !== state.today) {
    toast('지난 보드에는 글을 남길 수 없어요. 오늘 보드에 남겨 주세요.');
    return;
  }
  startWriting({ at: board.toWorld(e.clientX, e.clientY), file });
});
document.addEventListener('paste', (e) => {
  if (anyDialogOpen() || e.target.closest?.('input, textarea')) return;
  const file = imageFileOf(e.clipboardData?.files);
  if (file) {
    e.preventDefault();
    startWriting({ file });
  }
});

// 단축키: + / - 확대·축소, 0 전체 보기, N 글쓰기, [ ] 날짜 이동
document.addEventListener('keydown', (e) => {
  if (anyDialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const onNote = !!e.target.closest?.('.note');
  if (e.key === '+' || e.key === '=') board.zoomBy(1.25);
  else if (e.key === '-' || e.key === '_') board.zoomBy(0.8);
  else if (e.key === '0') board.fit();
  else if (e.code === 'KeyN') { e.preventDefault(); startWriting(); }
  else if (e.code === 'BracketLeft') goTo(addDays(state.view, -1));
  else if (e.code === 'BracketRight' && state.view < state.today) goTo(addDays(state.view, 1));
  else if (!onNote && e.key.startsWith('Arrow')) {
    const d = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    e.preventDefault();
    board.panBy(d[0] * 120, d[1] * 120);
  } else return;
});

window.addEventListener('popstate', () => openDay(routeKey()));
window.addEventListener('hashchange', () => openDay(routeKey()));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkDay();
});

// ---------- Google 로그인 ----------
// 카카오톡 같은 앱 안의 브라우저에서는 Google이 로그인을 막아서, 다른 브라우저로 열도록 안내해요.
const UA = navigator.userAgent;
const inKakao = /KAKAOTALK/i.test(UA);
const inAppBrowser = inKakao || /FBAN|FBAV|Instagram|Line\/|NAVER\(inapp|DaumApps|everytimeApp|; wv\)/i.test(UA);
const signin = setupDialog($('#signin'), { onClose() { pendingWrite = null; } });
let pendingWrite = null;

function askSignIn(next = null) {
  pendingWrite = next;
  $('#signinError').hidden = true;
  $('#inAppHint').hidden = !inAppBrowser;
  $('#openExternal').hidden = !inKakao;
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
  location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`;
});

function renderAccount() {
  const s = state.store;
  const btn = $('#accountBtn');
  btn.hidden = !s?.needsSignIn;
  if (!s?.needsSignIn) return;
  const user = s.user;
  btn.classList.toggle('is-signed-in', !!user);
  if (user) {
    const label = user.name || user.email || '내 계정';
    btn.textContent = [...label.trim()][0]?.toUpperCase() ?? '나';
    btn.setAttribute('aria-label', `${label} 계정, 로그아웃은 안내 창에서 할 수 있어요`);
    btn.title = label;
  } else {
    btn.textContent = '로그인';
    btn.setAttribute('aria-label', 'Google로 로그인');
    btn.removeAttribute('title');
  }
}

$('#accountBtn').addEventListener('click', () => {
  if (state.store?.user) {
    renderInfo();
    info.open();
  } else {
    askSignIn();
  }
});

// ---------- 안내와 설정 ----------
const info = setupDialog($('#info'));
$('#infoBtn').addEventListener('click', () => {
  renderInfo();
  info.open();
});
$('#modeChip').addEventListener('click', () => {
  renderInfo();
  info.open();
});

function renderInfo() {
  const s = state.store;
  const mode = $('#infoMode');
  if (!s) mode.textContent = '저장소에 연결하는 중이에요.';
  else if (s.mode === 'local') mode.textContent = '로컬 모드: 글이 이 브라우저에만 저장돼요. Firebase를 연결하면 방문자 모두가 같은 보드를 봐요.';
  else if (s.isAdmin) mode.textContent = '공유 모드: 관리자로 로그인했어요. 모든 글을 옮기거나 지울 수 있어요.';
  else mode.textContent = '공유 모드: 방문자 모두가 같은 보드를 봐요.';

  const shared = !!s?.needsSignIn;
  const user = s?.user;
  $('#howtoLogin').hidden = !shared;
  $('#infoAccountRow').hidden = !shared;
  $('#infoAccount').textContent = user
    ? `${user.name || '이름 없음'}${user.email ? ` (${user.email})` : ''}`
    : '로그인하지 않았어요. 글을 남기려면 Google로 로그인해 주세요.';
  $('#accountAction').textContent = user ? '로그아웃' : 'Google로 로그인';
  $('#adminDetails').hidden = !user;
  $('#infoUid').textContent = user?.uid ?? '';

  const theme = pref(PREF_THEME) ?? 'auto';
  for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === theme;
  $('#liteToggle').checked = root.classList.contains('lite');
  updateCountdown();
}

$('#accountAction').addEventListener('click', async () => {
  if (!state.store?.user) {
    info.close();
    askSignIn();
    return;
  }
  try {
    await state.store.signOut();
    info.close();
    toast('로그아웃했어요.');
  } catch {
    toast('로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.', { tone: 'error' });
  }
});

// 안내 창이 열려 있으면 알림이 창 뒤에 가려져서, 버튼 글자로 결과를 알려요.
$('#copyUid').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(state.store.uid);
    btn.textContent = '복사했어요';
  } catch {
    btn.textContent = '직접 복사해 주세요';
  }
  setTimeout(() => { btn.textContent = '복사'; }, 2000);
});

$('#info').addEventListener('change', (e) => {
  if (e.target.name === 'theme') {
    const v = e.target.value === 'auto' ? null : e.target.value;
    setPref(PREF_THEME, v);
    applyTheme(v);
  } else if (e.target.id === 'liteToggle') {
    setPref(PREF_LITE, e.target.checked ? 'on' : 'off');
    applyLite();
  }
});

function renderModeChip() {
  const s = state.store;
  const chip = $('#modeChip');
  const kind = s.mode === 'local' ? 'local' : s.isAdmin ? 'admin' : '';
  chip.hidden = !kind;
  chip.textContent = kind === 'local' ? '로컬 모드' : '관리자';
  chip.dataset.kind = kind;
}

// 로그인하거나 로그아웃하면 '내 글' 표시와 옮기기 권한을 다시 그려요.
function onAuthChanged() {
  board.setNotes(state.notes, boardCtx());
  detail?.refresh();
  renderAccount();
  renderModeChip();
  if ($('#info').open) renderInfo();
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
  detail = createDetail({
    dialog: $('#detail'),
    store: state.store,
    timeZone: tz,
    permissions: perms,
    onEdit: (note) => composer.open({ mode: 'edit', note }),
    onDeleted: () => toast('글을 지웠어요.'),
  });
  calendar = createCalendar({
    dialog: $('#calendar'),
    store: state.store,
    getToday: () => state.today,
    onPick: goTo,
  });
  renderModeChip();
  renderAccount();
  state.store.onAuthChange(onAuthChanged);
  const start = routeKey();
  if (location.hash && start === state.today) history.replaceState(null, '', location.pathname + location.search);
  state.view = null;
  openDay(start);
}
document.body.classList.add('is-ready');
