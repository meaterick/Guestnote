// Firestore 보안 규칙 테스트 (Firebase 에뮬레이터에서 실행)
// 실행: npm run test:e2e (브라우저 테스트와 함께 Firebase 에뮬레이터에서 돌아요)
import { test, before, after, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, deleteField,
  collection, query, where, getDocs, getCountFromServer, Timestamp, Bytes, setLogLevel,
} from 'firebase/firestore';

// 일부러 막히는 요청이 많아서 SDK 경고는 끄고 결과만 봐요.
setLogLevel('silent');

const kstDay = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })
  .format(new Date(Date.now() + offset * 86_400_000));
const TODAY = kstDay();
const YESTERDAY = kstDay(-1);
const TOMORROW = kstDay(1);
// 사진처럼 생긴 바이트
const bytes = (n, fill = 1) => Bytes.fromUint8Array(new Uint8Array(n).fill(fill));
const THUMB = bytes(4000);
const FULL = bytes(100000, 2);

let env;
// Google로 로그인한 방문자. provider를 바꾸면 다른 로그인 방식도 흉내 낼 수 있어요.
const as = (uid, provider = 'google.com') => (uid
  ? env.authenticatedContext(uid, { name: uid === 'alice' ? '앨리스' : uid, firebase: { sign_in_provider: provider } })
  : env.unauthenticatedContext()).firestore();

function note(over = {}) {
  return {
    date: TODAY, type: 'text', author: '앨리스', text: '안녕하세요', color: 'sky',
    x: 100, y: 200, z: 1, rot: 1.5, ownerId: 'alice',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over,
  };
}

async function seed(path, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

const stamp = Timestamp.fromMillis(Date.now() - 86_400_000);
const seeded = (over = {}) => note({ createdAt: stamp, updatedAt: stamp, ...over });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-guestnote',
    firestore: { rules: await readFile(new URL('../firebase/firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(() => env?.cleanup());
beforeEach(() => env.clearFirestore());

test('누구나 글을 읽고 날짜별로 셀 수 있어요', async () => {
  await seed('notes/n1', seeded({ date: YESTERDAY }));
  await assertSucceeds(getDoc(doc(as(null), 'notes/n1')));
  await assertSucceeds(getDocs(query(collection(as(null), 'notes'), where('date', '==', YESTERDAY))));
  await assertSucceeds(getCountFromServer(query(collection(as(null), 'notes'), where('date', '==', YESTERDAY))));
});

test('로그인한 방문자는 오늘 보드에 글을 남길 수 있어요', async () => {
  await assertSucceeds(setDoc(doc(as('alice'), 'notes/n1'), note()));
  await assertSucceeds(setDoc(doc(as('alice'), 'notes/n2'), note({ type: 'memo', text: '메모', color: 'clear', x: 0, y: 0, z: 0, rot: -8 })));
});

test('로그인하지 않으면 글을 남길 수 없어요', async () => {
  await assertFails(setDoc(doc(as(null), 'notes/n1'), note()));
});

test('Google이 아닌 방식(익명 등)으로 로그인하면 글을 남길 수 없어요', async () => {
  await assertFails(setDoc(doc(as('alice', 'anonymous'), 'notes/n1'), note()));
  await assertFails(setDoc(doc(as('alice', 'password'), 'notes/n2'), note()));
  await seed('notes/n3', seeded());
  await assertFails(updateDoc(doc(as('alice', 'anonymous'), 'notes/n3'), { x: 300, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(as('alice', 'anonymous'), 'notes/n3')));
});

test('다른 사람 이름(ownerId)으로는 남길 수 없어요', async () => {
  await assertFails(setDoc(doc(as('bob'), 'notes/n1'), note()));
});

test('작성자는 계정 이름만 사용하고, 저장한 이름은 본인도 바꿀 수 없어요', async () => {
  const db = as('alice');
  await assertFails(setDoc(doc(db, 'notes/forged'), note({ author: '다른 이름' })));
  await seed('notes/legacy', seeded({ author: '이전에 적은 이름' }));
  await assertSucceeds(updateDoc(doc(db, 'notes/legacy'), { text: '내용만 고쳐요', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'notes/legacy'), { author: '앨리스', updatedAt: serverTimestamp() }));
  for (const [i, name] of [undefined, '', '   ', '  앨리스  ', '가'.repeat(21), '😀'.repeat(21)].entries()) {
    const ctx = env.authenticatedContext('alice', { ...(name === undefined ? {} : { name }), firebase: { sign_in_provider: 'google.com' } });
    const author = (name?.trim() || '방문자').slice(0, 20);
    await assertSucceeds(setDoc(doc(ctx.firestore(), `notes/name${i}`), note({ author })))
      .catch((err) => { throw new Error(`계정 이름 사례 ${i}: ${JSON.stringify(name)}`, { cause: err }); });
  }
});

test('어제나 내일 보드에는 남길 수 없어요', async () => {
  await assertFails(setDoc(doc(as('alice'), 'notes/n1'), note({ date: YESTERDAY })));
  await assertFails(setDoc(doc(as('alice'), 'notes/n2'), note({ date: TOMORROW })));
  await assertFails(setDoc(doc(as('alice'), 'notes/n3'), note({ date: '2026-1-01' })));
});

test('작성 시각은 서버 시각이어야 해요', async () => {
  await assertFails(setDoc(doc(as('alice'), 'notes/n1'), note({ createdAt: Timestamp.now() })));
});

test('잘못된 내용은 막아요', async () => {
  const db = as('alice');
  const bad = [
    { author: '가'.repeat(21) },
    { author: '' },
    { author: '   ' },
    { text: '가'.repeat(501) },
    { text: '' },
    { color: 'black' },
    { type: 'poll' },
    { x: 4001 },
    { y: -1 },
    { rot: 20 },
    { z: '1' },
    { extra: true },
    { type: 'guest' },
    { type: 'photo' },
  ];
  for (const [i, over] of bad.entries()) {
    await assertFails(setDoc(doc(db, `notes/bad${i}`), note(over)));
  }
});

test('사진은 작은 WebP/JPEG 바이트만 받아요', async () => {
  const db = as('alice');
  const img = { img: THUMB, imgType: 'image/webp', imgW: 640, imgH: 480, imgFull: false };
  await assertSucceeds(setDoc(doc(db, 'notes/ok'), note({ text: '', ...img })));
  await assertSucceeds(setDoc(doc(db, 'notes/memo'), note({ type: 'memo', text: '', ...img })));
  await assertSucceeds(setDoc(doc(db, 'notes/jpeg'), note({ ...img, imgType: 'image/jpeg', img: bytes(40000) })));
  await assertFails(setDoc(doc(db, 'notes/svg'), note({ ...img, imgType: 'image/svg+xml' })));
  await assertFails(setDoc(doc(db, 'notes/big'), note({ ...img, img: bytes(40001) })));
  await assertFails(setDoc(doc(db, 'notes/text'), note({ ...img, img: 'data:image/webp;base64,AAAA' })));
  await assertFails(setDoc(doc(db, 'notes/notype'), note({ img: THUMB, imgW: 10, imgH: 10, imgFull: false })));
  await assertFails(setDoc(doc(db, 'notes/nosize'), note({ img: THUMB, imgType: 'image/webp' })));
  await assertFails(setDoc(doc(db, 'notes/orphan'), note({ imgW: 10, imgH: 10 })));
});

test('내 글은 오늘 안에서 옮기거나 고칠 수 있어요', async () => {
  await seed('notes/n1', seeded());
  const db = as('alice');
  await assertSucceeds(updateDoc(doc(db, 'notes/n1'), { x: 300, y: 400, z: 9, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'notes/n1'), { text: '고친 글', color: 'mint', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'notes/n1'), { type: 'memo', rot: -2, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'notes/n1'), { x: 10 }));
  await assertFails(updateDoc(doc(db, 'notes/n1'), { date: YESTERDAY, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'notes/n1'), { ownerId: 'bob', updatedAt: serverTimestamp() }));
});

test('남의 글이나 지난 글은 옮길 수 없어요', async () => {
  await seed('notes/today', seeded());
  await seed('notes/past', seeded({ date: YESTERDAY }));
  await assertFails(updateDoc(doc(as('bob'), 'notes/today'), { x: 300, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('alice'), 'notes/past'), { x: 300, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('alice'), 'notes/past'), { text: '지난 글 고치기', updatedAt: serverTimestamp() }));
});

test('관리자는 오늘 보드의 남의 글을 옮기거나 지울 수 있지만, 내용은 못 고쳐요', async () => {
  await seed('admins/root', {});
  await seed('notes/today', seeded());
  await seed('notes/today2', seeded());
  const db = as('root');
  await assertSucceeds(updateDoc(doc(db, 'notes/today'), { x: 1, y: 2, z: 3, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'notes/today'), { text: '관리자가 고침', updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(db, 'notes/today2')));
});

test('지난 보드는 관리자도 읽기만 할 수 있어요', async () => {
  await seed('admins/root', {});
  await seed('notes/past', seeded({ date: YESTERDAY }));
  for (const uid of ['root', 'alice']) {
    const db = as(uid);
    await assertSucceeds(getDoc(doc(db, 'notes/past')));
    await assertFails(updateDoc(doc(db, 'notes/past'), { x: 1, y: 2, z: 3, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, 'notes/past')));
  }
});

test('내 글은 오늘 지울 수 있고, 남의 글은 못 지워요', async () => {
  await seed('notes/today', seeded());
  await assertFails(deleteDoc(doc(as('bob'), 'notes/today')));
  await assertSucceeds(deleteDoc(doc(as('alice'), 'notes/today')));
});

test('큰 사진은 같은 글과 함께 저장해야 해요', async () => {
  const db = as('alice');
  const withImage = note({ text: '', img: THUMB, imgType: 'image/webp', imgW: 640, imgH: 480, imgFull: true });

  const batch = writeBatch(db);
  batch.set(doc(db, 'notes/p1'), withImage);
  batch.set(doc(db, 'images/p1'), { data: FULL, type: 'image/jpeg', ownerId: 'alice', date: TODAY });
  await assertSucceeds(batch.commit());

  // 글 없이 사진만
  await assertFails(setDoc(doc(db, 'images/lonely'), { data: FULL, type: 'image/jpeg', ownerId: 'alice', date: TODAY }));
  // 남의 글에 사진 붙이기
  await seed('notes/bobs', seeded({ ownerId: 'bob', imgFull: true, img: THUMB, imgType: 'image/webp', imgW: 1, imgH: 1 }));
  await assertFails(setDoc(doc(db, 'images/bobs'), { data: FULL, type: 'image/jpeg', ownerId: 'alice', date: TODAY }));
  // 너무 큰 사진
  const big = writeBatch(db);
  big.set(doc(db, 'notes/p2'), withImage);
  big.set(doc(db, 'images/p2'), { data: bytes(160001), type: 'image/jpeg', ownerId: 'alice', date: TODAY });
  await assertFails(big.commit());
  // 다른 사람은 사진을 못 바꾸거나 지워요
  await assertFails(setDoc(doc(as('bob'), 'images/p1'), { data: FULL, type: 'image/jpeg', ownerId: 'bob', date: TODAY }));
  await assertFails(deleteDoc(doc(as('bob'), 'images/p1')));
});

test('움직이는 GIF는 imgAnim 글의 큰 사진 자리에만, 320,000바이트까지 받아요', async () => {
  const db = as('alice');
  const anim = { img: THUMB, imgType: 'image/webp', imgW: 320, imgH: 180, imgFull: true, imgAnim: true };
  const gifDoc = (n = 200000) => ({ data: bytes(n, 9), type: 'image/gif', ownerId: 'alice', date: TODAY });
  const pair = (id, noteData, imageData) => {
    const batch = writeBatch(db);
    batch.set(doc(db, `notes/${id}`), note(noteData));
    batch.set(doc(db, `images/${id}`), imageData);
    return batch.commit();
  };
  await assertSucceeds(pair('g1', anim, gifDoc()));
  await assertSucceeds(pair('g2', { ...anim, text: '' }, gifDoc(320000)));
  await assertFails(pair('g3', anim, gifDoc(320001)));
  // 움직이는 글에 GIF가 아닌 사진, 보통 글에 GIF는 안 돼요.
  await assertFails(pair('g4', anim, { data: FULL, type: 'image/webp', ownerId: 'alice', date: TODAY }));
  const { imgAnim: _, ...still } = anim;
  await assertFails(pair('g5', still, gifDoc()));
  // 작은 사진 자리에는 GIF를 못 넣어요.
  await assertFails(pair('g6', { ...anim, imgType: 'image/gif' }, gifDoc()));
  // imgAnim은 큰 사진이 있을 때 true로만 써요.
  await assertFails(setDoc(doc(db, 'notes/g7'), note({ ...anim, imgFull: false })));
  await assertFails(setDoc(doc(db, 'notes/g8'), note({ ...anim, imgAnim: false })));
  await assertFails(setDoc(doc(db, 'notes/g9'), note({ imgAnim: true })));
});

test('사진을 빼거나 바꾸고, 글과 함께 지울 수 있어요', async () => {
  const db = as('alice');
  const batch = writeBatch(db);
  batch.set(doc(db, 'notes/p1'), note({ img: THUMB, imgType: 'image/webp', imgW: 640, imgH: 480, imgFull: true }));
  batch.set(doc(db, 'images/p1'), { data: FULL, type: 'image/jpeg', ownerId: 'alice', date: TODAY });
  await batch.commit();

  const swap = writeBatch(db);
  swap.update(doc(db, 'notes/p1'), { img: bytes(3000, 7), imgType: 'image/jpeg', imgW: 320, imgH: 240, imgFull: true, updatedAt: serverTimestamp() });
  swap.set(doc(db, 'images/p1'), { data: bytes(90000, 3), type: 'image/webp', ownerId: 'alice', date: TODAY });
  await assertSucceeds(swap.commit());

  const remove = writeBatch(db);
  remove.update(doc(db, 'notes/p1'), {
    img: deleteField(), imgType: deleteField(), imgW: deleteField(), imgH: deleteField(), imgFull: deleteField(), updatedAt: serverTimestamp(),
  });
  remove.delete(doc(db, 'images/p1'));
  await assertSucceeds(remove.commit());

  const gone = writeBatch(db);
  gone.delete(doc(db, 'notes/p1'));
  gone.delete(doc(db, 'images/p1'));
  await assertSucceeds(gone.commit());
});

test('지난 날의 큰 사진은 아무도 지울 수 없어요', async () => {
  await seed('admins/root', {});
  await seed('images/old', { data: FULL, type: 'image/jpeg', ownerId: 'alice', date: YESTERDAY });
  await assertFails(deleteDoc(doc(as('alice'), 'images/old')));
  await assertFails(deleteDoc(doc(as('root'), 'images/old')));
});

test('관리자 목록은 자기 것만 확인할 수 있고 아무도 못 써요', async () => {
  await seed('admins/root', {});
  await assertSucceeds(getDoc(doc(as('root'), 'admins/root')));
  await assertSucceeds(getDoc(doc(as('alice'), 'admins/alice')));
  await assertFails(getDoc(doc(as('alice'), 'admins/root')));
  await assertFails(getDocs(collection(as('root'), 'admins')));
  await assertFails(setDoc(doc(as('alice'), 'admins/alice'), {}));
});
