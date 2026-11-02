import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchPresence } from '../public/assets/js/presence.js';
globalThis.document = undefined;
globalThis.window = undefined;

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness(t, initialUid = 'me') {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100000 });
  class Surface extends EventTarget { hidden = false; }
  const document = new Surface();
  const window = new Surface();
  t.mock.property(globalThis, 'document', document);
  t.mock.property(globalThis, 'window', window);
  const rows = new Map();
  const requests = [];
  let authChanged;
  let currentUid = initialUid;
  let callback;
  let delayCreate;
  let delayUpdate;
  let result;
  const publish = () => callback?.({ docs: [...rows].map(([id, value]) => ({ id, metadata: { hasPendingWrites: false }, get: key => value[key] })) });
  const stamp = () => ({ toMillis: () => Date.now() });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(options);
    rows.delete(new URL(url).pathname.split('/').pop());
    publish();
    return { ok: true };
  });
  const F = {
    collection: () => null, doc: (_, __, id) => id, Timestamp: { fromMillis: x => x },
    where: () => null, query: () => null, serverTimestamp: stamp,
    onSnapshot: (_, fn) => { callback = fn; publish(); return () => { callback = null; }; },
    async setDoc(id, data) { if (delayCreate) await delayCreate.promise; rows.set(id, data); publish(); },
    async updateDoc(id, data) {
      if (delayUpdate) await delayUpdate.promise;
      if (!rows.has(id)) throw Object.assign(new Error('deleted'), { code: 'not-found' });
      rows.set(id, { ...rows.get(id), ...data }); publish();
    },
    async deleteDoc(id) { rows.delete(id); publish(); },
  };
  const watcher = watchPresence({ F, db: {}, config: { firebase: { projectId: 'demo', apiKey: 'demo' } },
    getUid: () => currentUid, onAuthChange: fn => { authChanged = fn; return () => {}; },
  }, value => { result = value; });
  t.after(() => watcher.stop());
  return { rows, requests, watcher, document, window, publish, stamp, get result() { return result; },
    delayCreate(value) { delayCreate = value; }, delayUpdate(value) { delayUpdate = value; },
    auth(uid) { currentUid = uid; authChanged(); },
    visible(value) { document.hidden = !value; document.dispatchEvent(new Event('visibilitychange')); },
  };
}

test('퇴장 뒤 늦게 끝난 첫 저장을 다시 지워요', async t => {
  const h = harness(t);
  await flush();
  h.visible(false);
  const delay = deferred();
  h.delayCreate(delay);
  h.visible(true);
  h.visible(false);
  assert.equal(h.rows.size, 0);
  delay.resolve();
  await flush();
  assert.equal(h.rows.size, 0, '늦은 첫 저장도 퇴장 뒤 남지 않아요');
  assert.ok(h.requests.every(r => r.method === 'DELETE' && r.keepalive));
});

test('익명 계정이 준비되기 전에는 쓰기를 보내지 않고 준비되면 바로 남겨요', async t => {
  const h = harness(t, null);
  await flush();
  assert.equal(h.rows.size, 0);
  h.auth('me');
  await flush();
  assert.equal(h.rows.size, 1);
  assert.equal([...h.rows.values()][0].uid, 'me');
});

test('진행 중인 heartbeat는 삭제된 문서를 다시 만들지 않아요', async t => {
  const h = harness(t);
  await flush();
  const delay = deferred();
  h.delayUpdate(delay);
  t.mock.timers.tick(10000);
  h.visible(false);
  assert.equal(h.rows.size, 0);
  delay.resolve();
  await flush();
  assert.equal(h.rows.size, 0);
});

test('보이는 구간마다 다른 ID를 쓰고, 이름을 보내지 않으며 같은 계정은 나로 제외해요', async t => {
  const h = harness(t);
  await flush();
  const first = [...h.rows.keys()][0];
  assert.deepEqual(Object.keys(h.rows.get(first)).sort(), ['seen', 'uid']);
  h.rows.set('same-account', { seen: h.stamp(), uid: 'me', name: '예전닉네임' });
  h.rows.set('other-a', { seen: h.stamp(), uid: 'other' });
  h.rows.set('other-b', { seen: h.stamp(), uid: 'other' });
  h.publish();
  assert.deepEqual(h.result, { total: 1 });
  h.visible(false);
  h.visible(true);
  await flush();
  assert.equal(h.rows.has(first), false);
  assert.notEqual([...h.rows.keys()].find(id => h.rows.get(id).uid === 'me' && id !== 'same-account'), first);
});

test('정리 요청이 없는 강제 종료 기록도 만료 시간이 지나면 제외해요', async t => {
  const h = harness(t);
  await flush();
  const seen = Date.now();
  h.rows.set('crashed', { seen: { toMillis: () => seen }, uid: 'other' });
  h.publish();
  assert.deepEqual(h.result, { total: 1 });
  t.mock.timers.tick(30000);
  await flush();
  assert.deepEqual(h.result, { total: 0 });
});
