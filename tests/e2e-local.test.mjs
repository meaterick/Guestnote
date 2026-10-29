// 로컬 모드 브라우저 테스트: Firebase 없이 이 브라우저(IndexedDB)에만 저장하는 모드
// 실행: npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { devices } from 'playwright';
import { launch, prepare, ready, compose, dragBy, translateOf, makePhoto, collectErrors, kstDay } from './helpers.mjs';

let app;
const errorLists = [];

async function open(options = {}, { clock } = {}) {
  const context = await app.browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...options });
  await prepare(context);
  const page = await context.newPage();
  errorLists.push(collectErrors(page));
  if (clock) await page.clock.install({ time: clock });
  await page.goto(app.base);
  await ready(page);
  return page;
}

// 다른 사람이 남긴 것처럼 글을 직접 넣어요.
async function seed(page, notes) {
  await page.evaluate(async (list) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('guestnote', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('notes', 'readwrite');
      for (const n of list) tx.objectStore('notes').put(n);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, notes);
}

// 옮긴 자리가 브라우저 저장소에 실제로 저장될 때까지 기다려요. (저장 전에 새로고침하면 사라져요)
// page.waitForFunction은 비동기 조건을 기다려 주지 않아서 직접 확인해요.
async function waitForStored(page, translate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const stored = await page.evaluate(async (expected) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('guestnote', 1);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const notes = await new Promise((res) => {
        const q = db.transaction('notes').objectStore('notes').getAll();
        q.onsuccess = () => res(q.result);
      });
      db.close();
      return notes.some((n) => `${n.x}px ${n.y}px` === expected);
    }, translate);
    if (stored) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`옮긴 자리(${translate})가 저장되지 않았어요.`);
}

const other = (id, date, over = {}) => ({
  id, date, type: 'guest', author: '지우', text: `${date}의 글`, color: 'lilac',
  x: 1800, y: 1200, z: 1, rot: 0, ownerId: 'someone-else', createdAt: Date.parse(`${date}T12:00:00+09:00`), updatedAt: 0, ...over,
});

before(async () => {
  app = await launch();
});

after(async () => {
  await app?.close();
});

test('처음에는 빈 오늘 보드와 로컬 모드 안내가 보여요', async () => {
  const page = await open();
  assert.match(await page.textContent('#boardMessageTitle'), /오늘의 첫 글을 남겨 주세요/);
  assert.equal(await page.textContent('#modeChip'), '로컬 모드');
  assert.equal(await page.textContent('#dateBadge'), '오늘');
  await page.context().close();
});

test('글을 남기고, 끌어서 옮긴 자리가 새로고침 뒤에도 그대로예요', async () => {
  const page = await open();
  await compose(page, { author: '민지', text: '처음 와 봤어요!', tint: 'sky' });
  await compose(page, { type: 'memo', author: '도윤', text: '점심 뭐 먹지', tint: 'lemon', at: { x: 300, y: 600 } });
  await page.waitForFunction(() => document.querySelectorAll('.note').length === 2);
  assert.equal(await page.isHidden('#boardMessage'), true);

  const note = page.locator('.note--guest');
  await dragBy(page, note, 180, 120);
  const moved = await translateOf(note);
  await waitForStored(page, moved);
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => document.querySelectorAll('.note').length === 2);
  assert.equal(await translateOf(page.locator('.note--guest')), moved);

  // 이름은 다음 글쓰기 때 기억해 둬요.
  await page.click('#writeBtn');
  assert.equal(await page.inputValue('#composer input[name=author]'), '도윤');
  await page.keyboard.press('Escape');
  await page.context().close();
});

test('키보드 화살표로 내 글을 옮길 수 있어요', async () => {
  const page = await open();
  await compose(page, { author: '키보드', text: '화살표로 움직여요' });
  const note = page.locator('.note');
  const [x0, y0] = (await translateOf(note)).split(' ').map(parseFloat);
  await note.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const [x1, y1] = (await translateOf(note)).split(' ').map(parseFloat);
  assert.equal(x1 - x0, 16);
  assert.equal(y1 - y0, 64);
  await waitForStored(page, `${x1}px ${y1}px`);
  await page.reload();
  await ready(page);
  await page.waitForSelector('.note');
  assert.equal(await translateOf(page.locator('.note')), `${x1}px ${y1}px`);
  await page.context().close();
});

test('큰 사진은 올리기 전에 용량 예산 안으로 줄여요', async () => {
  const page = await open();
  const photo = await makePhoto(app.browser);
  assert.ok(photo.length > 3_000_000, `테스트 사진 ${photo.length}바이트`);
  await page.click('#writeBtn');
  await page.setInputFiles('#photoInput', { name: 'big.png', mimeType: 'image/png', buffer: photo });
  await page.waitForSelector('#photoPreview:not([hidden])', { timeout: 30_000 });
  assert.match(await page.textContent('#photoInfo'), /MB → \d+KB로 줄였어요/);
  assert.equal(await page.inputValue('#composer input[name=type]:checked'), 'photo');
  await page.fill('#composer input[name=author]', '하린');
  await page.click('#composerSubmit');
  await page.waitForSelector('.note--photo img');
  const thumb = await page.locator('.note--photo img').getAttribute('src');
  assert.match(thumb, /^data:image\/(webp|jpeg);base64,/);
  assert.ok(thumb.length <= Math.ceil((48 * 1024) / 3) * 4 + 30, `작은 사진 ${thumb.length}자`);

  await page.locator('.note--photo').click();
  await page.waitForFunction((len) => document.querySelector('#detailImg').src.length > len, thumb.length);
  const full = await page.$eval('#detailImg', (img) => img.src.length);
  assert.ok(full <= Math.ceil((300 * 1024) / 3) * 4 + 30, `큰 사진 ${full}자`);
  await page.context().close();
});

test('사진 파일이 아니면 친절하게 막아요', async () => {
  const page = await open();
  await page.click('#writeBtn');
  await page.setInputFiles('#photoInput', { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForSelector('#composerError:not([hidden])');
  assert.match(await page.textContent('#composerError'), /사진 파일만/);
  await page.check('#composer input[name=type][value=photo]', { force: true });
  await page.fill('#composer input[name=author]', '누군가');
  await page.click('#composerSubmit');
  assert.match(await page.textContent('#composerError'), /사진이 필요해요/);
  await page.context().close();
});

test('내 글은 고치고 지울 수 있어요', async () => {
  const page = await open();
  await compose(page, { author: '서준', text: '오타가 있는 글', tint: 'rose' });
  await page.locator('.note').click();
  await page.waitForSelector('#detail[open]');
  await page.click('#detailEdit');
  await page.waitForSelector('#composer[open]');
  assert.equal(await page.inputValue('#composer textarea[name=text]'), '오타가 있는 글');
  await page.fill('#composer textarea[name=text]', '고친 글');
  await page.click('#composerSubmit');
  await page.waitForSelector('.note >> text=고친 글');

  await page.locator('.note').click();
  await page.click('#detailDelete');
  await page.click('#deleteYes');
  await page.waitForFunction(() => !document.querySelector('.note'));
  assert.match(await page.textContent('#boardMessageTitle'), /첫 글/);
  await page.context().close();
});

test('남의 글은 옮기거나 고칠 수 없어요', async () => {
  const page = await open();
  await seed(page, [other('o1', kstDay())]);
  await page.reload();
  await ready(page);
  const note = page.locator('.note');
  await note.waitFor();
  const before = await translateOf(note);
  await dragBy(page, note, 160, 100);
  assert.equal(await translateOf(note), before);
  await note.click();
  await page.waitForSelector('#detail[open]');
  assert.equal(await page.isHidden('#detailEdit'), true);
  assert.equal(await page.isHidden('#detailDelete'), true);
  await page.context().close();
});

test('지난 날짜는 달력과 주소로 찾아가서 읽기만 할 수 있어요', async () => {
  const page = await open();
  const yesterday = kstDay(-1);
  const older = kstDay(-3);
  await seed(page, [other('y1', yesterday), other('y2', yesterday, { x: 2100 }), other('o1', older)]);

  await page.click('#dateBtn');
  await page.waitForSelector(`.cal__day[data-key="${yesterday}"][data-level="1"]`);
  await page.click(`.cal__day[data-key="${yesterday}"]`);
  await page.waitForFunction(() => document.querySelectorAll('.note').length === 2);
  assert.equal(await page.evaluate(() => location.hash), `#/${yesterday}`);
  assert.equal(await page.textContent('#dateBadge'), '지난 보드');
  assert.equal(await page.isVisible('#writeBtn'), false);
  assert.equal(await page.isVisible('.dock__past'), true);

  await page.click('#prevDay');
  await page.click('#prevDay');
  await page.waitForFunction(() => document.querySelectorAll('.note').length === 1);
  assert.equal(await page.evaluate(() => location.hash), `#/${older}`);

  await page.goBack();
  await page.waitForFunction((h) => location.hash === h, `#/${kstDay(-2)}`);
  await page.click('#backToToday');
  await page.waitForFunction(() => !document.body.classList.contains('is-past'));
  assert.equal(await page.evaluate(() => location.hash), '');

  // 내일 주소는 오늘 보드로 열려요.
  await page.goto(`${app.base}#/${kstDay(1)}`);
  await ready(page);
  assert.equal(await page.textContent('#dateBadge'), '오늘');
  await page.context().close();
});

test('자정이 지나면 새 보드가 열리고, 어제 글은 지난 보드로 남아요', async () => {
  const page = await open({}, { clock: new Date('2026-10-29T23:59:20+09:00') });
  assert.equal(await page.textContent('#dateMain'), '10월 29일');
  await compose(page, { author: '자정', text: '자정 직전의 글' });
  await page.clock.fastForward('01:00');
  await page.waitForFunction(() => document.querySelector('#dateMain').textContent === '10월 30일');
  assert.equal(await page.locator('.note').count(), 0);
  assert.match(await page.textContent('#toasts'), /새로운 하루/);

  await page.click('#prevDay');
  await page.waitForSelector('.note >> text=자정 직전의 글');
  assert.equal(await page.locator('.note.is-movable').count(), 0, '어제 글은 더 옮길 수 없어요');
  await page.context().close();
});

test('휴대폰에서도 글을 남길 수 있어요', async () => {
  const page = await open({ ...devices['iPhone 13'] });
  assert.equal(await page.isVisible('#minimap'), false);
  await page.tap('#writeBtn');
  await page.waitForSelector('#composer[open]');
  await page.fill('#composer input[name=author]', '모바일');
  await page.fill('#composer textarea[name=text]', '폰에서 남겨요');
  await page.tap('#composerSubmit');
  await page.waitForSelector('.note >> text=폰에서 남겨요');
  await page.context().close();
});

test('브라우저 오류가 없어요', () => {
  assert.deepEqual(errorLists.flat(), []);
});
