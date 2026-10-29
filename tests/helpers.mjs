// 브라우저 테스트 공통 도우미
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const FIREBASE_DIR = fileURLToPath(new URL('../node_modules/firebase/', import.meta.url));

export async function launch() {
  const server = await startServer(0);
  // Google 로그인 창은 apis.google.com 스크립트가 필요해요. 프록시를 거쳐야 하는 환경이면 프록시를 써요.
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  return {
    browser,
    base: `http://127.0.0.1:${server.address().port}/`,
    async close() {
      await browser.close();
      server.close();
    },
  };
}

// 바깥 네트워크 없이도 돌아가게 글꼴은 막고, Firebase SDK는 node_modules에서 줘요.
export async function prepare(context, { config } = {}) {
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await context.route(/^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[\w-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    return route.fulfill({ path: FIREBASE_DIR + file, contentType: 'text/javascript; charset=utf-8' });
  });
  if (config) {
    await context.route(/\/config\.js$/, (route) => route.fulfill({
      contentType: 'text/javascript; charset=utf-8',
      body: `export default ${JSON.stringify(config)};`,
    }));
  }
}

export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

// 저장소에 연결되고 첫 보드를 다 불러올 때까지 기다려요.
export async function ready(page) {
  await page.waitForFunction(() => document.body.classList.contains('is-ready')
    && document.querySelector('#boardMessage').dataset.kind !== 'loading');
}

export function kstDay(offset = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + offset * 86_400_000));
}

// 사진처럼 무거운 PNG를 만들어요. (노이즈가 섞여서 잘 압축되지 않아요)
export async function makePhoto(browser, width = 2400, height = 1600) {
  const page = await browser.newPage({ viewport: { width: width / 2, height: height / 2 }, deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0;height:100vh;background:linear-gradient(160deg,#ffcf9e,#ff8fb1 45%,#6b6fd6)">
    <canvas id="c" style="width:100vw;height:100vh;opacity:.3"></canvas>
    <script>
      const c = document.getElementById('c'); c.width = innerWidth * 2; c.height = innerHeight * 2;
      const g = c.getContext('2d'); const d = g.createImageData(c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0);
    </script></body>`);
  const buffer = await page.screenshot({ type: 'png' });
  await page.close();
  return buffer;
}

// 보드에 바로 글을 써서 올려요. at(화면 좌표)을 주면 그 자리를 두 번 눌러 글상자를 열어요.
export async function write(page, { at, text = '', style = 'text', tint = 'clear', photo } = {}) {
  if (at) await page.mouse.dblclick(at.x, at.y);
  else await page.click('#writeBtn');
  await page.waitForSelector('.is-draft textarea');
  await page.check(`#writeBar input[name=style][value=${style}]`, { force: true });
  await page.check(`#writeBar input[name=tint][value=${tint}]`, { force: true });
  await page.fill('.is-draft textarea', text);
  if (photo) {
    await page.setInputFiles('#photoInput', { name: 'photo.png', mimeType: 'image/png', buffer: photo });
    await page.waitForSelector('.is-draft .draft__photo:not(.is-working) img[src^="data:image/"]', { timeout: 30_000 });
  }
  await page.click('#writeSubmit');
  await page.waitForSelector('.is-draft', { state: 'detached', timeout: 15_000 });
}

// 클립보드에서 사진을 붙여 넣은 것처럼 해요.
export async function pasteImage(page, buffer) {
  await page.evaluate((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'pasted.png', { type: 'image/png' }));
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, buffer.toString('base64'));
}

// 사진 파일을 화면의 한 점에 끌어다 놓은 것처럼 해요.
export async function dropImage(page, buffer, { x, y }) {
  await page.evaluate(([b64, cx, cy]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' }));
    const target = document.elementFromPoint(cx, cy);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    }
  }, [buffer.toString('base64'), x, y]);
}

// 로그인한 계정의 ID (Firebase가 브라우저에 저장해 둔 값)
export function uidOf(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('firebaseLocalStorageDb');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => resolve(all.result.find((r) => r.fbase_key.startsWith('firebase:authUser:'))?.value?.uid ?? null);
    };
  }));
}

export async function dragBy(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  const x = box.x + 30;
  const y = box.y + 24;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

export const translateOf = (locator) => locator.evaluate((el) => el.style.translate);
