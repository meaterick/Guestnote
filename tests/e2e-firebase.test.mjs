// 공유 모드 브라우저 테스트: 두 방문자가 Firebase 에뮬레이터로 같은 보드를 함께 써요.
// 실행: npm run test:firebase
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, prepare, ready, compose, dragBy, translateOf, makePhoto, collectErrors } from './helpers.mjs';

const PROJECT = 'demo-guestnote';
const FIRESTORE = 'http://127.0.0.1:8080';
const AUTH = 'http://127.0.0.1:9099';
const config = {
  firebase: { apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, appId: 'demo-app' },
  emulator: { host: '127.0.0.1', firestorePort: 8080, authPort: 9099 },
};

let app;
let alice;
let bob;
const errorLists = [];

async function visitor() {
  const context = await app.browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await prepare(context, { config });
  const page = await context.newPage();
  errorLists.push(collectErrors(page));
  await page.goto(app.base);
  await ready(page);
  return page;
}

async function uidOf(page) {
  await page.click('#infoBtn');
  const uid = (await page.textContent('#infoUid')).trim();
  await page.keyboard.press('Escape');
  return uid;
}

before(async () => {
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  app = await launch();
  alice = await visitor();
  bob = await visitor();
});

after(async () => {
  await app?.close();
});

test('익명으로 접속하고 공유 모드로 열려요', async () => {
  for (const page of [alice, bob]) {
    assert.equal(await page.isHidden('#modeChip'), true, '공유 모드에서는 로컬 모드 표시가 없어요');
    assert.match(await page.textContent('#boardMessageTitle'), /오늘의 첫 글/);
  }
  assert.notEqual(await uidOf(alice), await uidOf(bob));
});

test('한 사람이 남긴 글이 다른 사람 보드에 바로 나타나요', async () => {
  await compose(alice, { author: '앨리스', text: '실시간으로 보이나요?', tint: 'sky' });
  await bob.waitForSelector('.note >> text=실시간으로 보이나요?', { timeout: 10_000 });
  assert.equal(await alice.locator('.note.is-movable').count(), 1);
  assert.equal(await bob.locator('.note.is-movable').count(), 0, '남의 글은 옮길 수 없어요');
});

test('내 글을 옮기면 다른 사람 화면에서도 옮겨져요', async () => {
  const mine = alice.locator('.note').first();
  const before = await translateOf(mine);
  await dragBy(alice, mine, 220, 140);
  const moved = await translateOf(mine);
  assert.notEqual(moved, before);
  await bob.waitForFunction((t) => document.querySelector('.note').style.translate === t, moved, { timeout: 10_000 });
});

test('남의 글은 끌어도 움직이지 않고, 고치거나 지울 수 없어요', async () => {
  const theirs = bob.locator('.note').first();
  const before = await translateOf(theirs);
  await dragBy(bob, theirs, 150, 90);
  assert.equal(await translateOf(theirs), before);
  await theirs.click();
  await bob.waitForSelector('#detail[open]');
  assert.equal(await bob.isHidden('#detailEdit'), true);
  assert.equal(await bob.isHidden('#detailDelete'), true);
  await bob.keyboard.press('Escape');
});

test('사진 글은 작은 사진이 먼저 보이고, 누르면 큰 사진을 불러와요', async () => {
  const photo = await makePhoto(app.browser);
  await compose(alice, { type: 'photo', author: '앨리스', text: '노을', tint: 'peach', photo });
  const card = bob.locator('.note--photo');
  await card.waitFor({ timeout: 10_000 });
  const thumb = await card.locator('img').getAttribute('src');
  assert.ok(thumb.length < 90_000, `작은 사진 길이 ${thumb.length}`);
  await card.click();
  await bob.waitForFunction((len) => document.querySelector('#detailImg').src.length > len, thumb.length, { timeout: 10_000 });
  const full = await bob.$eval('#detailImg', (img) => img.src.length);
  assert.ok(full < 560_000, `큰 사진 길이 ${full}`);
  await bob.keyboard.press('Escape');
});

test('관리자는 남의 글도 옮기고 지울 수 있어요', async () => {
  const uid = await uidOf(bob);
  const res = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/admins/${uid}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {} }),
  });
  assert.equal(res.status, 200);
  await bob.reload();
  await ready(bob);
  await bob.waitForSelector('.note--photo');
  assert.equal(await bob.textContent('#modeChip'), '관리자');
  assert.equal(await bob.locator('.note.is-movable').count(), 2);

  await bob.locator('.note--guest').click();
  await bob.waitForSelector('#detail[open]');
  await bob.click('#detailDelete');
  await bob.click('#deleteYes');
  await alice.waitForFunction(() => !document.querySelector('.note--guest'), null, { timeout: 10_000 });
  assert.equal(await alice.locator('.note').count(), 1);
});

test('달력에서 오늘 글 수가 보여요', async () => {
  await alice.click('#dateBtn');
  await alice.waitForSelector('#calendar[open]');
  await alice.waitForSelector('.cal__day.is-today[data-level="1"]', { timeout: 10_000 });
  await alice.keyboard.press('Escape');
});

test('브라우저 오류가 없어요', () => {
  assert.deepEqual(errorLists.flat(), []);
});
