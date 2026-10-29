// 브라우저 테스트: Firebase 에뮬레이터 위에서 실제 화면을 띄워 여러 방문자가 함께 쓰는 흐름을 확인해요.
// 실행: npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { devices } from 'playwright';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { launch, prepare, ready, compose, dragBy, translateOf, makePhoto, collectErrors, kstDay } from './helpers.mjs';

const PROJECT = 'demo-guestnote';
const config = {
  firebase: { apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, appId: 'demo-app' },
  emulator: { host: '127.0.0.1', firestorePort: 8080, authPort: 9099 },
};

let app;
let env;
let alice;
let bob;
let guest;
const errorLists = [];

async function visitor(options = {}, { clock } = {}) {
  const context = await app.browser.newContext({
    viewport: { width: 1280, height: 820 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ignoreHTTPSErrors: true, ...options,
  });
  await prepare(context, { config });
  const page = await context.newPage();
  // 시계를 일부러 돌린 페이지는 서버와 시간이 크게 어긋나서 연결 경고가 날 수 있어요. 실제 방문자와 달라서 오류 검사에서 빼요.
  if (clock) await page.clock.install({ time: clock });
  else errorLists.push(collectErrors(page));
  await page.goto(app.base);
  await ready(page);
  return page;
}

// 에뮬레이터의 가짜 Google 로그인 창에서 계정을 만들어 로그인해요.
// 창의 스크립트가 다 뜨기 전에 누르면 입력란이 안 열려서, 보일 때까지 다시 눌러요.
async function finishGooglePopup(popup, name, email) {
  await popup.waitForLoadState('load');
  const emailInput = popup.locator('#email-input');
  for (let attempt = 0; attempt < 5; attempt++) {
    await popup.click('text=Add new account');
    if (await emailInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) break;
  }
  await emailInput.fill(email);
  await popup.fill('#display-name-input', name);
  await popup.click('#sign-in');
}

async function signInWithGoogle(page, name, email) {
  await page.click('#accountBtn');
  await page.waitForSelector('#signin[open]');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#googleSignIn')]);
  await finishGooglePopup(popup, name, email);
  await page.waitForFunction(() => document.querySelector('#accountBtn').classList.contains('is-signed-in'), null, { timeout: 15_000 });
  await page.waitForFunction(() => !document.querySelector('#signin').open);
}

async function uidOf(page) {
  await page.click('#infoBtn');
  const uid = (await page.textContent('#infoUid')).trim();
  await page.keyboard.press('Escape');
  return uid;
}

// 다른 사람이 지난 날에 남긴 것처럼 글을 직접 넣어요. (보안 규칙을 끄고 넣어요)
async function seed(path, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));
}

function pastNote(date, over = {}) {
  const at = Timestamp.fromDate(new Date(`${date}T12:00:00+09:00`));
  return {
    date, type: 'guest', author: '지우', text: `${date}의 글`, color: 'lilac',
    x: 1800, y: 1200, z: 1, rot: 0, ownerId: 'someone-else', createdAt: at, updatedAt: at, ...over,
  };
}

const waitForTranslate = (page, text, translate) => page.waitForFunction(
  ([t, v]) => [...document.querySelectorAll('.note')].some((n) => n.textContent.includes(t) && n.style.translate === v),
  [text, translate],
  { timeout: 10_000 },
);

before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: '127.0.0.1', port: 8080 } });
  await env.clearFirestore();
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  app = await launch();
  alice = await visitor();
  bob = await visitor();
  guest = await visitor();
});

after(async () => {
  await app?.close();
  await env?.cleanup();
});

test('로그인하지 않아도 보드를 볼 수 있고, 글을 남기려면 Google 로그인을 안내해요', async () => {
  assert.match(await guest.textContent('#boardMessageTitle'), /오늘의 첫 글/);
  assert.equal(await guest.textContent('#accountBtn'), '로그인');
  assert.equal(await guest.isHidden('#adminChip'), true);
  await guest.click('#writeBtn');
  await guest.waitForSelector('#signin[open]');
  assert.equal(await guest.evaluate(() => document.querySelector('#composer').open), false);
  await guest.keyboard.press('Escape');
});

test('Google로 로그인하면 바로 글쓰기 창이 열리고 이름이 채워져요', async () => {
  await alice.click('#writeBtn');
  await alice.waitForSelector('#signin[open]');
  const [popup] = await Promise.all([alice.waitForEvent('popup'), alice.click('#googleSignIn')]);
  await finishGooglePopup(popup, '앨리스', 'alice@example.com');
  await alice.waitForSelector('#composer[open]', { timeout: 15_000 });
  assert.equal(await alice.inputValue('#composer input[name=author]'), '앨리스');
  assert.equal(await alice.textContent('#accountBtn'), '앨');
  await alice.keyboard.press('Escape');

  await signInWithGoogle(bob, '밥', 'bob@example.com');
  assert.notEqual(await uidOf(alice), await uidOf(bob));
});

test('한 사람이 남긴 글이 다른 사람 보드에 바로 나타나요', async () => {
  await compose(alice, { author: '앨리스', text: '실시간으로 보이나요?', tint: 'sky' });
  await bob.waitForSelector('.note >> text=실시간으로 보이나요?', { timeout: 10_000 });
  await guest.waitForSelector('.note >> text=실시간으로 보이나요?', { timeout: 10_000 });
  assert.equal(await alice.locator('.note.is-movable').count(), 1);
  assert.equal(await bob.locator('.note.is-movable').count(), 0, '남의 글은 옮길 수 없어요');
});

test('내 글을 끌어서 옮기면 다른 사람 화면에도 반영되고, 새로고침해도 그 자리예요', async () => {
  const mine = alice.locator('.note', { hasText: '실시간으로 보이나요?' });
  const before = await translateOf(mine);
  await dragBy(alice, mine, 220, 140);
  const moved = await translateOf(mine);
  assert.notEqual(moved, before);
  await waitForTranslate(bob, '실시간으로 보이나요?', moved);
  await alice.reload();
  await ready(alice);
  await waitForTranslate(alice, '실시간으로 보이나요?', moved);
});

test('키보드 화살표로도 내 글을 옮길 수 있어요', async () => {
  const mine = alice.locator('.note', { hasText: '실시간으로 보이나요?' });
  const [x0, y0] = (await translateOf(mine)).split(' ').map(parseFloat);
  await mine.focus();
  await alice.keyboard.press('ArrowRight');
  await alice.keyboard.press('Shift+ArrowDown');
  await waitForTranslate(bob, '실시간으로 보이나요?', `${x0 + 16}px ${y0 + 64}px`);
});

test('남의 글은 끌어도 움직이지 않고, 고치거나 지울 수 없어요', async () => {
  const theirs = bob.locator('.note', { hasText: '실시간으로 보이나요?' });
  const before = await translateOf(theirs);
  await dragBy(bob, theirs, 150, 90);
  assert.equal(await translateOf(theirs), before);
  await theirs.click();
  await bob.waitForSelector('#detail[open]');
  assert.equal(await bob.isHidden('#detailEdit'), true);
  assert.equal(await bob.isHidden('#detailDelete'), true);
  await bob.keyboard.press('Escape');
});

test('큰 사진은 올리기 전에 줄이고, 보드에는 작은 사진만 먼저 보여요', async () => {
  const photo = await makePhoto(app.browser);
  assert.ok(photo.length > 3_000_000, `테스트 사진 ${photo.length}바이트`);
  await alice.click('#writeBtn');
  await alice.setInputFiles('#photoInput', { name: 'big.png', mimeType: 'image/png', buffer: photo });
  await alice.waitForSelector('#photoPreview:not([hidden])', { timeout: 30_000 });
  assert.match(await alice.textContent('#photoInfo'), /MB → \d+KB로 줄였어요/);
  assert.equal(await alice.inputValue('#composer input[name=type]:checked'), 'photo');
  await alice.fill('#composer textarea[name=text]', '노을');
  await alice.click('#composerSubmit');
  await alice.waitForFunction(() => !document.querySelector('#composer').open, null, { timeout: 15_000 });

  const card = bob.locator('.note--photo');
  await card.waitFor({ timeout: 10_000 });
  const thumb = await card.locator('img').getAttribute('src');
  assert.match(thumb, /^data:image\/(webp|jpeg);base64,/);
  assert.ok(thumb.length <= Math.ceil((48 * 1024) / 3) * 4 + 30, `작은 사진 ${thumb.length}자`);
  await card.click();
  await bob.waitForFunction((len) => document.querySelector('#detailImg').src.length > len, thumb.length, { timeout: 10_000 });
  const full = await bob.$eval('#detailImg', (img) => img.src.length);
  assert.ok(full <= Math.ceil((300 * 1024) / 3) * 4 + 30, `큰 사진 ${full}자`);
  await bob.keyboard.press('Escape');
});

test('사진 파일이 아니거나 사진 글에 사진이 없으면 알려 줘요', async () => {
  await alice.click('#writeBtn');
  await alice.setInputFiles('#photoInput', { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await alice.waitForSelector('#composerError:not([hidden])');
  assert.match(await alice.textContent('#composerError'), /사진 파일만/);
  await alice.check('#composer input[name=type][value=photo]', { force: true });
  await alice.click('#composerSubmit');
  assert.match(await alice.textContent('#composerError'), /사진이 필요해요/);
  await alice.keyboard.press('Escape');
});

test('내 글은 고치고 지울 수 있고, 다른 사람 화면에도 바로 반영돼요', async () => {
  await compose(alice, { type: 'memo', author: '앨리스', text: '오타가 있는 글', tint: 'rose' });
  await alice.locator('.note', { hasText: '오타가 있는 글' }).click();
  await alice.waitForSelector('#detail[open]');
  await alice.click('#detailEdit');
  await alice.waitForSelector('#composer[open]');
  assert.equal(await alice.inputValue('#composer textarea[name=text]'), '오타가 있는 글');
  await alice.fill('#composer textarea[name=text]', '고친 글');
  await alice.click('#composerSubmit');
  await bob.waitForSelector('.note >> text=고친 글', { timeout: 10_000 });

  await alice.locator('.note', { hasText: '고친 글' }).click();
  await alice.click('#detailDelete');
  await alice.click('#deleteYes');
  await bob.waitForFunction(() => ![...document.querySelectorAll('.note')].some((n) => n.textContent.includes('고친 글')), null, { timeout: 10_000 });
});

test('관리자는 남의 글도 옮기고 지울 수 있어요', async () => {
  await seed(`admins/${await uidOf(bob)}`, { name: '관리자' });
  await bob.reload();
  await ready(bob);
  await bob.waitForSelector('.note--photo');
  assert.equal(await bob.isVisible('#adminChip'), true);
  assert.equal(await bob.locator('.note.is-movable').count(), 2);

  await bob.locator('.note', { hasText: '실시간으로 보이나요?' }).click();
  await bob.waitForSelector('#detail[open]');
  await bob.click('#detailDelete');
  await bob.click('#deleteYes');
  await alice.waitForFunction(() => document.querySelectorAll('.note').length === 1, null, { timeout: 10_000 });
});

test('지난 날짜는 달력과 주소로 찾아가서 읽기만 할 수 있어요', async () => {
  const yesterday = kstDay(-1);
  const older = kstDay(-3);
  await seed('notes/y1', pastNote(yesterday));
  await seed('notes/y2', pastNote(yesterday, { x: 2100 }));
  await seed('notes/o1', pastNote(older));

  await alice.click('#dateBtn');
  await alice.waitForSelector('#calendar[open]');
  await alice.waitForSelector('.cal__day.is-today[data-level="1"]', { timeout: 10_000 });
  await alice.waitForSelector(`.cal__day[data-key="${yesterday}"][data-level="1"]`, { timeout: 10_000 });
  await alice.click(`.cal__day[data-key="${yesterday}"]`);
  await alice.waitForFunction(() => document.querySelectorAll('.note').length === 2);
  assert.equal(await alice.evaluate(() => location.hash), `#/${yesterday}`);
  assert.equal(await alice.textContent('#dateBadge'), '지난 보드');
  assert.equal(await alice.isVisible('#writeBtn'), false);
  assert.equal(await alice.isVisible('.dock__past'), true);
  assert.equal(await alice.locator('.note.is-movable').count(), 0);

  await alice.click('#prevDay');
  await alice.click('#prevDay');
  await alice.waitForFunction(() => document.querySelectorAll('.note').length === 1);
  assert.equal(await alice.evaluate(() => location.hash), `#/${older}`);
  await alice.goBack();
  await alice.waitForFunction((h) => location.hash === h, `#/${kstDay(-2)}`);
  await alice.click('#backToToday');
  await alice.waitForFunction(() => !document.body.classList.contains('is-past'));
  assert.equal(await alice.evaluate(() => location.hash), '');

  // 내일 주소는 오늘 보드로 열려요.
  await alice.goto(`${app.base}#/${kstDay(1)}`);
  await ready(alice);
  assert.equal(await alice.textContent('#dateBadge'), '오늘');
});

test('로그아웃하면 내 글도 옮길 수 없고, 다시 로그인을 안내해요', async () => {
  await alice.waitForSelector('.note.is-movable');
  await alice.click('#accountBtn');
  await alice.waitForSelector('#info[open]');
  assert.match(await alice.textContent('#infoAccount'), /앨리스 \(alice@example\.com\)/);
  await alice.click('#accountAction');
  await alice.waitForFunction(() => document.querySelector('#accountBtn').textContent === '로그인');
  assert.equal(await alice.locator('.note.is-movable').count(), 0);
  assert.equal(await alice.locator('.note.is-mine').count(), 0);
});

test('자정이 지나면 새 보드가 열리고, 어제 글은 지난 보드로 남아요', async () => {
  // 브라우저 시계만 오늘 밤 23:59:20으로 돌려요. 서버(에뮬레이터)는 실제 시각이라 '오늘' 날짜가 같아요.
  const today = kstDay();
  const night = await visitor({}, { clock: new Date(`${today}T23:59:20+09:00`) });
  await signInWithGoogle(night, '자정', 'night@example.com');
  await compose(night, { author: '자정', text: '자정 직전의 글' });
  await night.waitForSelector('.note >> text=자정 직전의 글');

  const next = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000);
  await night.clock.fastForward('01:00');
  await night.waitForFunction(
    (label) => document.querySelector('#dateMain').textContent.endsWith(label),
    `${next.getUTCMonth() + 1}월 ${next.getUTCDate()}일`,
  );
  assert.equal(await night.locator('.note').count(), 0);
  assert.match(await night.textContent('#toasts'), /새로운 하루/);

  await night.click('#prevDay');
  await night.waitForSelector('.note >> text=자정 직전의 글');
  assert.equal(await night.locator('.note.is-movable').count(), 0, '어제 글은 더 옮길 수 없어요');
  await night.context().close();
});

test('휴대폰에서도 로그인하고 글을 남길 수 있어요', async () => {
  const phone = await visitor({ ...devices['iPhone 13'] });
  assert.equal(await phone.isVisible('#minimap'), false);
  await signInWithGoogle(phone, '모바일', 'phone@example.com');
  await phone.tap('#writeBtn');
  await phone.waitForSelector('#composer[open]');
  await phone.fill('#composer textarea[name=text]', '폰에서 남겨요');
  await phone.tap('#composerSubmit');
  await phone.waitForSelector('.note >> text=폰에서 남겨요');
  await bob.waitForSelector('.note >> text=폰에서 남겨요', { timeout: 10_000 });
  await phone.context().close();
});

test('브라우저 오류가 없어요', () => {
  assert.deepEqual(errorLists.flat(), []);
});
