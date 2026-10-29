// 브라우저 테스트: Firebase 에뮬레이터 위에서 실제 화면을 띄워 여러 방문자가 함께 쓰는 흐름을 확인해요.
// 실행: npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { devices } from 'playwright';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import {
  launch, prepare, ready, write, pasteImage, dropImage, uidOf, dragBy, translateOf, makePhoto, collectErrors, kstDay,
} from './helpers.mjs';

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

// 다른 사람이 지난 날에 남긴 것처럼 글을 직접 넣어요. (보안 규칙을 끄고 넣어요)
async function seed(path, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));
}

function pastNote(date, over = {}) {
  const at = Timestamp.fromDate(new Date(`${date}T12:00:00+09:00`));
  return {
    date, type: 'memo', author: '지우', text: `${date}의 글`, color: 'lilac',
    x: 1800, y: 1200, z: 1, rot: 0, ownerId: 'someone-else', createdAt: at, updatedAt: at, ...over,
  };
}

const waitForTranslate = (page, text, translate) => page.waitForFunction(
  ([t, v]) => [...document.querySelectorAll('.note')].some((n) => n.textContent.includes(t) && n.style.translate === v),
  [text, translate],
  { timeout: 10_000 },
);

const waitForGone = (page, text) => page.waitForFunction(
  (t) => ![...document.querySelectorAll('.note')].some((n) => n.textContent.includes(t)),
  text,
  { timeout: 10_000 },
);

const dockMode = (page) => page.getAttribute('#dock', 'data-mode');

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
  assert.equal(await guest.isVisible('#boardTip .board-tip__mouse'), true);
  assert.match(await guest.textContent('#boardMessageTitle'), /오늘의 첫 글/);
  assert.equal(await guest.textContent('#accountBtn'), '로그인');
  assert.equal(await guest.isHidden('#adminChip'), true);
  assert.equal(await guest.locator('#minimap, .minimap, .zoombar, #zoomLabel, #infoBtn').count(), 0, '미니맵과 확대 비율 표시는 없어요');
  await guest.click('#writeBtn');
  await guest.waitForSelector('#signin[open]');
  assert.equal(await guest.locator('.is-draft').count(), 0);
  await guest.keyboard.press('Escape');
  // 빈 곳을 두 번 눌러도 로그인을 안내해요.
  await guest.mouse.dblclick(640, 420);
  await guest.waitForSelector('#signin[open]');
  await guest.keyboard.press('Escape');
});

test('Google로 로그인하면 보드 위에 글상자가 열리고 작성자는 계정 이름으로 고정돼요', async () => {
  await alice.evaluate(() => localStorage.setItem('guestnote:author', '예전에 적은 별명'));
  await alice.click('#writeBtn');
  await alice.waitForSelector('#signin[open]');
  const [popup] = await Promise.all([alice.waitForEvent('popup'), alice.click('#googleSignIn')]);
  await finishGooglePopup(popup, '앨리스', 'alice@example.com');
  await alice.waitForSelector('.note.is-draft textarea', { timeout: 15_000 });
  assert.equal(await alice.evaluate(() => document.querySelector('dialog[open]')), null, '글쓰기 창은 따로 뜨지 않아요');
  assert.equal(await alice.textContent('.is-draft .draft__name'), '앨리스');
  assert.equal(await alice.locator('.is-draft input, .is-draft [contenteditable=true], .note__dash').count(), 0);
  assert.equal(await alice.isHidden('#boardTip'), true);
  assert.equal(await alice.evaluate(() => document.activeElement?.classList.contains('draft__text')), true, '바로 쓸 수 있게 커서가 있어요');
  assert.equal(await alice.inputValue('#writeBar input[name=style]:checked'), 'text', '기본 모양은 글자만');
  assert.equal(await dockMode(alice), 'write');
  assert.equal(await alice.textContent('#accountBtn'), '앨');
  await alice.keyboard.press('Escape');
  await alice.waitForSelector('.is-draft', { state: 'detached' });
  assert.equal(await dockMode(alice), 'today');
  assert.equal(await alice.isVisible('#boardTip'), true);

  await signInWithGoogle(bob, '밥', 'bob@example.com');
  assert.notEqual(await uidOf(alice), await uidOf(bob));
});

test('빈 곳을 두 번 눌러 쓰면 그 자리에 붙고, 다른 사람 보드에도 바로 나타나요', async () => {
  const at = { x: 520, y: 380 };
  await write(alice, { at, text: '실시간으로 보이나요?', tint: 'sky' });
  const mine = alice.locator('.note', { hasText: '실시간으로 보이나요?' });
  assert.equal(await mine.evaluate((el) => el.classList.contains('note--text')), true, '기본은 글자만 붙어요');
  const box = await mine.boundingBox();
  assert.ok(Math.abs(box.x - at.x) < 60 && Math.abs(box.y - at.y) < 60, `누른 곳(${at.x},${at.y}) 근처에 붙어요: ${box.x},${box.y}`);
  await bob.waitForSelector('.note >> text=실시간으로 보이나요?', { timeout: 10_000 });
  await guest.waitForSelector('.note >> text=실시간으로 보이나요?', { timeout: 10_000 });
  assert.equal(await alice.locator('.note.is-movable').count(), 1);
  assert.equal(await bob.locator('.note.is-movable').count(), 0, '남의 글은 옮길 수 없어요');
  assert.equal(await mine.locator('.note__foot').textContent(), '앨리스');
  assert.equal(await guest.isVisible('#boardTip'), true, '글이 있어도 안내가 보여요');
});

test('메모장 모양과 색을 골라서 쓸 수 있어요', async () => {
  await write(alice, { style: 'memo', text: '메모장에 적어요', tint: 'rose' });
  const memo = bob.locator('.note', { hasText: '메모장에 적어요' });
  await memo.waitFor({ timeout: 10_000 });
  assert.deepEqual(await memo.evaluate((el) => [el.classList.contains('note--memo'), el.dataset.tint]), [true, 'rose']);
});

test('Enter로 바로 올리고, Shift+Enter로 줄을 바꿔요', async () => {
  await alice.click('#writeBtn');
  const box = alice.locator('.is-draft textarea');
  await box.waitFor();
  await alice.keyboard.type('첫 줄');
  await alice.keyboard.press('Shift+Enter');
  await alice.keyboard.type('둘째 줄');
  assert.equal(await box.inputValue(), '첫 줄\n둘째 줄');
  // 한글을 조합하는 중에 누른 Enter는 글자를 마무리할 뿐 올리지 않아요.
  await box.evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
  });
  assert.equal(await alice.locator('.is-draft').count(), 1);
  await alice.keyboard.press('Enter');
  await alice.waitForSelector('.is-draft', { state: 'detached', timeout: 15_000 });
  const posted = bob.locator('.note', { hasText: '둘째 줄' });
  await posted.waitFor({ timeout: 10_000 });
  assert.equal(await posted.locator('.note__text').textContent(), '첫 줄\n둘째 줄');
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

test('남의 글은 끌어도 움직이지 않고, 고르면 쓴 사람만 보이고 고치거나 지울 수 없어요', async () => {
  const theirs = bob.locator('.note', { hasText: '실시간으로 보이나요?' });
  const before = await translateOf(theirs);
  await dragBy(bob, theirs, 150, 90);
  assert.equal(await translateOf(theirs), before);
  await theirs.click();
  await bob.waitForSelector('#dock[data-mode="pick"]');
  assert.equal(await bob.textContent('#pickAuthor'), '앨리스');
  assert.equal(await bob.isHidden('#pickEdit'), true);
  assert.equal(await bob.isHidden('#pickDelete'), true);
  assert.equal(await bob.isHidden('#pickMine'), true);
  await theirs.dblclick();
  assert.equal(await bob.locator('.is-draft').count(), 0, '남의 글은 두 번 눌러도 고칠 수 없어요');
  await bob.keyboard.press('Escape');
  await bob.waitForSelector('#dock[data-mode="today"]');
});

test('사진은 버튼으로 넣으면 올리기 전에 줄이고, 보드에는 작은 사진만 먼저 보여요', async () => {
  const photo = await makePhoto(app.browser);
  assert.ok(photo.length > 3_000_000, `테스트 사진 ${photo.length}바이트`);
  await alice.click('#writeBtn');
  await alice.waitForSelector('.is-draft textarea');
  await alice.setInputFiles('#photoInput', { name: 'big.png', mimeType: 'image/png', buffer: photo });
  await alice.waitForSelector('.toast >> text=/MB → \\d+KB로 줄였어요/', { timeout: 30_000 });
  await alice.waitForSelector('.is-draft .draft__photo:not(.is-working) img[src^="data:image/"]');
  await alice.fill('.is-draft textarea', '노을');
  await alice.click('#writeSubmit');
  await alice.waitForSelector('.is-draft', { state: 'detached', timeout: 15_000 });

  const card = bob.locator('.note.has-photo', { hasText: '노을' });
  await card.waitFor({ timeout: 10_000 });
  const thumb = await card.locator('img').getAttribute('src');
  assert.match(thumb, /^data:image\/(webp|jpeg);base64,/);
  assert.ok(thumb.length <= Math.ceil((32 * 1024) / 3) * 4 + 30, `작은 사진 ${thumb.length}자`);
  await card.click();
  await bob.click('#pickView');
  await bob.waitForSelector('#viewer[open]');
  await bob.waitForFunction((len) => document.querySelector('#viewerImg').src.length > len, thumb.length, { timeout: 10_000 });
  const full = await bob.$eval('#viewerImg', (img) => img.src.length);
  assert.ok(full <= Math.ceil((120 * 1024) / 3) * 4 + 30, `큰 사진 ${full}자`);
  await bob.keyboard.press('Escape');
  await bob.waitForFunction(() => !document.querySelector('#viewer').open);
  await bob.keyboard.press('Escape');
});

test('사진은 붙여 넣거나 끌어다 놓아도 줄여서 올라가요', async () => {
  const photo = await makePhoto(app.browser, 1200, 800);
  // 쓰는 중이 아닐 때 붙여 넣으면 사진이 든 새 글상자가 열려요.
  await pasteImage(alice, photo);
  await alice.waitForSelector('.is-draft .draft__photo:not(.is-working) img[src^="data:image/"]', { timeout: 30_000 });
  await alice.fill('.is-draft textarea', '붙여 넣은 사진');
  await alice.click('#writeSubmit');
  await alice.waitForSelector('.is-draft', { state: 'detached', timeout: 15_000 });
  await bob.waitForSelector('.note.has-photo >> text=붙여 넣은 사진', { timeout: 10_000 });

  // 끌어다 놓으면 놓은 자리에 글상자가 열리고, 사진만 있어도 올릴 수 있어요.
  const spot = { x: 980, y: 300 };
  await dropImage(alice, photo, spot);
  await alice.waitForSelector('.is-draft .draft__photo:not(.is-working) img[src^="data:image/"]', { timeout: 30_000 });
  const box = await alice.locator('.is-draft').boundingBox();
  assert.ok(Math.abs(box.x - spot.x) < 60 && Math.abs(box.y - spot.y) < 60, `놓은 곳 근처: ${box.x},${box.y}`);
  await alice.click('#writeSubmit');
  await alice.waitForSelector('.is-draft', { state: 'detached', timeout: 15_000 });
  await bob.waitForFunction(() => document.querySelectorAll('.note.has-photo').length === 3, null, { timeout: 10_000 });
  const thumbs = await bob.$$eval('.note.has-photo img', (imgs) => imgs.map((i) => i.src.length));
  assert.ok(thumbs.every((n) => n <= Math.ceil((32 * 1024) / 3) * 4 + 30), `작은 사진들 ${thumbs}`);
});

test('사진 파일이 아니면 알려 주고, 빈 글은 올리지 않아요', async () => {
  await alice.click('#writeBtn');
  await alice.waitForSelector('.is-draft textarea');
  await alice.setInputFiles('#photoInput', { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await alice.waitForSelector('.toast >> text=사진 파일만');
  await alice.click('#writeSubmit');
  await alice.waitForSelector('.toast >> text=내용을 적거나 사진을 넣어 주세요');
  assert.equal(await alice.locator('.is-draft').count(), 1);
  await alice.click('#writeCancel');
  await alice.waitForSelector('.is-draft', { state: 'detached' });
});

test('내 글은 두 번 눌러 그 자리에서 고치고, 골라서 지울 수 있어요', async () => {
  await write(alice, { style: 'memo', text: '오타가 있는 글', tint: 'mint' });
  await alice.locator('.note', { hasText: '오타가 있는 글' }).dblclick();
  await alice.waitForSelector('.is-draft textarea');
  assert.equal(await alice.inputValue('.is-draft textarea'), '오타가 있는 글');
  assert.equal(await alice.inputValue('#writeBar input[name=style]:checked'), 'memo');
  assert.equal(await alice.locator('.note.is-held').count(), 1, '고치는 동안 원래 글은 감춰요');
  assert.equal(await alice.textContent('.is-draft .draft__name'), '앨리스');
  assert.equal(await alice.locator('.is-draft input, .note__dash').count(), 0);
  // 표시 문구를 직접 변조해도 저장할 작성자는 처음 값 그대로예요.
  await alice.locator('.is-draft .draft__name').evaluate((el) => { el.textContent = '다른 이름'; });
  await alice.fill('.is-draft textarea', '고친 글');
  await alice.check('#writeBar input[name=style][value=text]', { force: true });
  await alice.click('#writeSubmit');
  await alice.waitForSelector('.is-draft', { state: 'detached', timeout: 15_000 });
  const fixed = bob.locator('.note', { hasText: '고친 글' });
  await fixed.waitFor({ timeout: 10_000 });
  assert.equal(await fixed.evaluate((el) => el.classList.contains('note--text')), true);
  assert.equal(await fixed.locator('.note__sign').textContent(), '앨리스');

  await alice.locator('.note', { hasText: '고친 글' }).click();
  assert.equal(await alice.isVisible('#pickMine'), true);
  await alice.click('#pickDelete');
  await alice.click('#pickYes');
  await waitForGone(bob, '고친 글');
});

test('관리자는 오늘 보드의 남의 글을 옮기고 지울 수 있지만, 내용은 못 고쳐요', async () => {
  await seed(`admins/${await uidOf(bob)}`, { name: '관리자' });
  await bob.reload();
  await ready(bob);
  await bob.waitForSelector('.note.has-photo');
  assert.equal(await bob.isVisible('#adminChip'), true);
  assert.equal(await bob.locator('.note.is-movable').count(), await bob.locator('.note').count());

  await bob.locator('.note', { hasText: '실시간으로 보이나요?' }).click();
  await bob.waitForSelector('#dock[data-mode="pick"]');
  assert.equal(await bob.isHidden('#pickEdit'), true);
  assert.equal(await bob.textContent('#pickDelete'), '관리자로 지우기');
  await bob.click('#pickDelete');
  await bob.click('#pickYes');
  await waitForGone(alice, '실시간으로 보이나요?');
});

test('지난 날짜는 달력과 주소로 찾아가서 읽기만 할 수 있어요 (관리자도)', async () => {
  const yesterday = kstDay(-1);
  const older = kstDay(-3);
  await seed('notes/y1', pastNote(yesterday));
  await seed('notes/y2', pastNote(yesterday, { x: 2100, ownerId: await uidOf(alice), author: '앨리스', type: 'text' }));
  await seed('notes/o1', pastNote(older));

  // 쓰던 글이 있으면 지난 보드로 가기 전에 알려 줘요.
  await alice.click('#writeBtn');
  await alice.fill('.is-draft textarea', '아직 쓰는 중');
  await alice.click('#prevDay');
  await alice.waitForSelector('.toast >> text=쓰던 글을 먼저 올리거나 취소해 주세요');
  assert.equal(await alice.textContent('#dateBadge'), '오늘');
  await alice.click('#writeCancel');

  await alice.click('#dateBtn');
  await alice.waitForSelector('#calendar[open]');
  await alice.waitForSelector('.cal__day.is-today:not([data-level="0"])', { timeout: 10_000 });
  await alice.waitForSelector(`.cal__day[data-key="${yesterday}"][data-level="1"]`, { timeout: 10_000 });
  await alice.click(`.cal__day[data-key="${yesterday}"]`);
  await alice.waitForFunction(() => document.querySelectorAll('.note').length === 2);
  assert.equal(await alice.evaluate(() => location.hash), `#/${yesterday}`);
  assert.equal(await alice.textContent('#dateBadge'), '지난 보드');
  assert.equal(await dockMode(alice), 'past');
  assert.equal(await alice.isHidden('#boardTip'), true);
  assert.equal(await alice.isVisible('#writeBtn'), false);
  assert.equal(await alice.locator('.note.is-movable').count(), 0, '어제 쓴 내 글도 옮길 수 없어요');

  // 두 번 눌러도 글상자가 열리지 않고, 내 글을 골라도 고치거나 지울 수 없어요.
  await alice.mouse.dblclick(200, 600);
  await alice.waitForSelector('.toast >> text=지난 보드는 읽기만');
  assert.equal(await alice.locator('.is-draft').count(), 0);
  await alice.locator('.note', { hasText: `${yesterday}의 글` }).filter({ hasText: '앨리스' }).click();
  await alice.waitForSelector('#dock[data-mode="pick"]');
  assert.equal(await alice.isVisible('#pickMine'), true);
  assert.equal(await alice.isHidden('#pickEdit'), true);
  assert.equal(await alice.isHidden('#pickDelete'), true);
  await alice.keyboard.press('Escape');

  // 관리자도 지난 보드는 읽기만 해요.
  await bob.goto(`${app.base}#/${yesterday}`);
  await ready(bob);
  await bob.waitForFunction(() => document.querySelectorAll('.note').length === 2);
  assert.equal(await bob.locator('.note.is-movable').count(), 0);
  await bob.locator('.note').first().click();
  await bob.waitForSelector('#dock[data-mode="pick"]');
  assert.equal(await bob.isHidden('#pickDelete'), true);
  await bob.goto(app.base);
  await ready(bob);

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

test('프로필에는 화면 설정과 로그아웃만 있고, 로그아웃하면 내 글도 옮길 수 없어요', async () => {
  await alice.waitForSelector('.note.is-movable');
  await alice.click('#accountBtn');
  await alice.waitForSelector('#profile[open]');
  const controls = await alice.$$eval('#profile button, #profile input', (els) => els.map((el) => el.id || el.name || el.getAttribute('aria-label')));
  assert.deepEqual(controls, ['닫기', 'theme', 'theme', 'theme', 'signOutBtn']);
  assert.doesNotMatch(await alice.textContent('#profile'), /alice@example\.com|계정 ID|관리자|이렇게 써요|유리 효과/);
  await alice.check('#profile input[name=theme][value=dark]', { force: true });
  assert.equal(await alice.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await alice.check('#profile input[name=theme][value=auto]', { force: true });
  assert.equal(await alice.evaluate(() => document.documentElement.dataset.theme ?? null), null);
  await alice.click('#signOutBtn');
  await alice.waitForFunction(() => document.querySelector('#accountBtn').textContent === '로그인');
  assert.equal(await alice.evaluate(() => document.querySelector('#profile').open), false);
  assert.equal(await alice.locator('.note.is-movable').count(), 0);
  assert.equal(await alice.locator('.note.is-mine').count(), 0);
});

test('자정이 지나면 새 보드가 열리고, 어제 글은 지난 보드로 남아요', async () => {
  // 브라우저 시계만 오늘 밤 23:59:20으로 돌려요. 서버(에뮬레이터)는 실제 시각이라 '오늘' 날짜가 같아요.
  const today = kstDay();
  const night = await visitor({}, { clock: new Date(`${today}T23:59:20+09:00`) });
  await signInWithGoogle(night, '자정', 'night@example.com');
  await write(night, { text: '자정 직전의 글' });
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

test('휴대폰에서도 로그인하고 보드에 바로 글을 쓸 수 있어요', async () => {
  const phone = await visitor({ ...devices['iPhone 13'] });
  assert.equal(await phone.isVisible('#boardTip .board-tip__touch'), true);
  assert.equal(await phone.isHidden('#boardTip .board-tip__mouse'), true);
  const tip = await phone.locator('#boardTip').boundingBox();
  assert.ok(tip.x >= 0 && tip.x + tip.width <= phone.viewportSize().width);
  await signInWithGoogle(phone, '모바일', 'phone@example.com');
  await phone.tap('#writeBtn');
  await phone.waitForSelector('.is-draft textarea');
  assert.equal(await phone.textContent('.is-draft .draft__name'), '모바일');
  assert.equal(await phone.isVisible('#writeSubmit'), true);
  await phone.fill('.is-draft textarea', '폰에서 남겨요');
  await phone.tap('#writeSubmit');
  await phone.waitForSelector('.is-draft', { state: 'detached', timeout: 15_000 });
  await phone.waitForSelector('.note >> text=폰에서 남겨요');
  await bob.waitForSelector('.note >> text=폰에서 남겨요', { timeout: 10_000 });
  await phone.locator('.note', { hasText: '폰에서 남겨요' }).tap();
  await phone.waitForSelector('#dock[data-mode="pick"]');
  assert.equal(await phone.isVisible('#pickEdit'), true);
  await phone.context().close();
});

test('카카오톡·인스타그램 앱 안에서는 Google 로그인 대신 브라우저로 여는 방법을 보여 줘요', async () => {
  const iphone = devices['iPhone 13'];
  const android = devices['Pixel 7'];
  const cases = [
    { name: '카카오톡', device: { ...iphone, userAgent: `${iphone.userAgent} KAKAOTALK 10.8.5` }, open: '다른 브라우저로 열기' },
    { name: '아이폰 인스타그램', device: { ...iphone, userAgent: `${iphone.userAgent} Instagram 350.0.0.0` }, open: 'Safari로 열기' },
    { name: '안드로이드 인스타그램', device: { ...android, userAgent: `${android.userAgent} Instagram 350.0.0.0` }, open: null },
  ];
  for (const c of cases) {
    const page = await visitor(c.device);
    await page.tap('#writeBtn');
    await page.waitForSelector('#signin[open]');
    assert.equal(await page.isVisible('#inAppHint'), true, c.name);
    assert.equal(await page.isVisible('#googleSignIn'), false, `${c.name}: 막히는 Google 버튼은 숨겨요`);
    assert.equal(await page.isVisible('#copyLink'), true, c.name);
    if (c.open) assert.equal(await page.textContent('#openExternal'), c.open);
    else assert.equal(await page.isVisible('#openExternal'), false, c.name);
    await page.context().close();
  }
  // 보통 브라우저에서는 Google 버튼만 보여요.
  await guest.click('#writeBtn');
  await guest.waitForSelector('#signin[open]');
  assert.equal(await guest.isVisible('#inAppHint'), false);
  assert.equal(await guest.isVisible('#googleSignIn'), true);
  await guest.keyboard.press('Escape');
});

test('공유 미리보기 정보와 이미지가 있어요', async () => {
  const og = await guest.$$eval('meta[property^="og:"]', (els) => Object.fromEntries(els.map((m) => [m.getAttribute('property'), m.content])));
  assert.equal(og['og:title'], 'Guestnote 오늘의 방명록');
  assert.match(og['og:image'], /^https:\/\/.+\/og\.jpg$/);
  const res = await fetch(new URL('og.jpg', app.base));
  assert.equal(res.status, 200);
  assert.ok((await res.arrayBuffer()).byteLength > 10_000);
});

test('브라우저 오류가 없어요', () => {
  assert.deepEqual(errorLists.flat(), []);
});
