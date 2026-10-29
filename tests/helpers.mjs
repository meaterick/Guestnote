// 브라우저 테스트 공통 도우미
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const FIREBASE_DIR = fileURLToPath(new URL('../node_modules/firebase/', import.meta.url));

export async function launch() {
  const server = await startServer(0);
  const browser = await chromium.launch();
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

export async function compose(page, { type = 'guest', author, text = '', tint = 'clear', photo, at } = {}) {
  if (at) await page.mouse.dblclick(at.x, at.y);
  else await page.click('#writeBtn');
  await page.waitForSelector('#composer[open]');
  await page.check(`#composer input[name=type][value=${type}]`, { force: true });
  if (author !== undefined) await page.fill('#composer input[name=author]', author);
  await page.fill('#composer textarea[name=text]', text);
  await page.check(`#composer .swatch[data-tint=${tint}] input`, { force: true });
  if (photo) {
    await page.setInputFiles('#photoInput', { name: 'photo.png', mimeType: 'image/png', buffer: photo });
    await page.waitForSelector('#photoPreview:not([hidden])', { timeout: 30_000 });
  }
  await page.click('#composerSubmit');
  await page.waitForFunction(() => !document.querySelector('#composer').open, null, { timeout: 15_000 });
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
