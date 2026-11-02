// 저장소: Firebase Firestore에 글을 저장해요. 로그인 화면은 없고, 브라우저마다 익명 계정을
// 몰래 만들어서(Firebase 익명 로그인) 그 id로 '내 글'을 구분해요.
// 보드는 실시간으로 구독해서 다른 방문자가 남기거나 옮긴 글이 바로 보여요.
//
// 컬렉션 구조
//   notes/{id}   보드에 붙은 글 (작은 사진 포함)
//   images/{id}  크게 보기용 사진 (글을 눌렀을 때만 불러와요)
//   admins/{uid} 관리자 표시용 문서 (Firebase 콘솔에서 UID로 직접 만들어요)
//   profiles/{uid} 기존 보안 규칙과의 호환용 프로필. 이름은 화면에 표시하지 않아요.
//   presence/{id} 탭별 접속 기록. 마지막 시각과 익명 uid만 저장해요.

import { accountAuthor } from './notes.js';
import { watchPresence } from './presence.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

export async function createStore(config) {
  if (!config.firebase) throw new Error('public/config.js 에 Firebase 설정이 없어요.');
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);

  const app = initializeApp(config.firebase);
  // 로그인 창(팝업)은 없어서 익명 계정만 이 브라우저에 저장해요.
  const auth = A.initializeAuth(app, {
    persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence],
  });
  const db = F.initializeFirestore(app, {});
  if (config.emulator) {
    const { host, firestorePort, authPort } = config.emulator;
    A.connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    F.connectFirestoreEmulator(db, host, firestorePort);
  }

  // 관리자 권한과 기존 보안 규칙에 필요한 작성자 값을 확인해요.
  const session = { user: null, isAdmin: false, error: null, author: '익명' };
  const profileRef = (uid) => F.doc(db, 'profiles', uid);
  const listeners = new Set();
  let ticket = 0;
  let settle;
  const firstState = new Promise((resolve) => { settle = resolve; });
  A.onAuthStateChanged(auth, async (user) => {
    const my = ++ticket;
    let isAdmin = false;
    let nickname = '';
    if (user) {
      const [admin, profile] = await Promise.allSettled([
        F.getDoc(F.doc(db, 'admins', user.uid)),
        F.getDoc(profileRef(user.uid)),
      ]);
      isAdmin = admin.status === 'fulfilled' && admin.value.exists();
      if (profile.status === 'fulfilled' && profile.value.exists()) nickname = profile.value.get('name') || '';
    }
    if (my !== ticket) return;
    // 기존 규칙과 저장된 프로필을 위해 작성자 값만 내부에서 유지해요. 화면에는 보내지 않아요.
    session.author = accountAuthor(nickname);
    session.user = user ? { uid: user.uid } : null;
    session.isAdmin = isAdmin;
    settle();
    for (const fn of listeners) fn();
  });
  await firstState;

  // 처음 온 브라우저는 익명 계정을 만들어요. (한 번 만들면 이 브라우저에 남아서 다음에도 같은 '나'예요)
  // 기다리지 않고 보드를 먼저 보여 줘요. 글을 쓸 때 ready()로 기다려요.
  let signing = null;
  function ensureUser() {
    if (session.user) return Promise.resolve(session.user);
    signing ??= A.signInAnonymously(auth)
      .then(({ user }) => untilSession((s) => s.user?.uid === user.uid).then(() => session.user))
      .catch((err) => {
        session.error = err;
        signing = null;
        throw err;
      });
    return signing;
  }
  ensureUser().catch((err) => console.warn('익명 계정을 만들지 못했어요.', err));

  // 익명 계정이 생기고 관리자 확인까지 끝나서 화면에 반영될 때까지 기다려요.
  function untilSession(test) {
    if (test(session)) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (!test(session)) return;
        listeners.delete(check);
        resolve();
      };
      listeners.add(check);
    });
  }

  const notesCol = F.collection(db, 'notes');
  const noteRef = (id) => F.doc(db, 'notes', id);
  const imageRef = (id) => F.doc(db, 'images', id);
  const fullImages = new Map();
  const thumbs = new Map(); // 글 id → { bytes, url }: 같은 사진을 매번 다시 바꾸지 않게 기억해요

  // 사진은 base64 글자 대신 바이트로 저장해요. 같은 사진이 저장 공간을 25% 덜 차지해요.
  // 화면에는 기존처럼 data URL로 바꿔서 넘겨요.
  // 작은 사진은 WebP/JPEG, 큰 사진 자리에는 움직이는 GIF도 와요.
  const IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/gif'];
  const toBytes = async (blob) => F.Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer()));
  const toDataUrl = (bytes, type) => (bytes instanceof F.Bytes && IMAGE_TYPES.includes(type)
    ? `data:${type};base64,${bytes.toBase64()}`
    : null);

  function thumbUrl(id, bytes, type) {
    const hit = thumbs.get(id);
    if (hit && hit.type === type && hit.bytes.isEqual(bytes)) return hit.url;
    const url = toDataUrl(bytes, type);
    thumbs.set(id, { bytes, type, url });
    return url;
  }

  function toNote(snap) {
    const d = snap.data({ serverTimestamps: 'estimate' });
    const note = {
      ...d,
      id: snap.id,
      createdAt: d.createdAt?.toMillis?.() ?? Date.now(),
      updatedAt: d.updatedAt?.toMillis?.() ?? Date.now(),
    };
    if (d.img) note.img = thumbUrl(snap.id, d.img, d.imgType);
    return note;
  }

  async function imageFields(image) {
    return {
      img: await toBytes(image.thumb.blob),
      imgType: image.thumb.type,
      imgW: image.thumb.width,
      imgH: image.thumb.height,
      imgFull: !!image.full,
      // 움직이는 GIF는 큰 사진 자리에 있어요. 보드가 이 표시를 보고 불러와서 움직여요.
      ...(image.anim ? { imgAnim: true } : {}),
    };
  }

  async function fullImageDoc(image, date) {
    return { data: await toBytes(image.full.blob), type: image.full.type, ownerId: session.user.uid, date };
  }

  return {
    get user() {
      return session.user;
    },
    get uid() {
      return session.user?.uid ?? null;
    },
    get isAdmin() {
      return session.isAdmin;
    },
    get canWrite() {
      return !!session.user;
    },
    onAuthChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // 글을 쓰기 전에 익명 계정이 준비될 때까지 기다려요. (못 만들면 오류를 던져요)
    ready() {
      return ensureUser();
    },

    subscribeDay(date, onNotes, onError) {
      thumbs.clear();
      const q = F.query(notesCol, F.where('date', '==', date));
      return F.onSnapshot(q, (snap) => {
        onNotes(snap.docs.map(toNote).sort((a, b) => a.createdAt - b.createdAt));
      }, onError);
    },

    // 새 글의 id를 미리 받아 두면, 저장되는 동안 보드에 먼저 나타나는 글을 알아볼 수 있어요.
    newNoteId() {
      return F.doc(notesCol).id;
    },

    async createNote(data, image, id = F.doc(notesCol).id) {
      const ref = noteRef(id);
      const batch = F.writeBatch(db);
      const note = {
        ...data,
        author: session.author,
        ownerId: session.user.uid,
        createdAt: F.serverTimestamp(),
        updatedAt: F.serverTimestamp(),
        ...(image ? await imageFields(image) : {}),
      };
      batch.set(ref, note);
      if (image?.full) {
        batch.set(imageRef(ref.id), await fullImageDoc(image, data.date));
        fullImages.set(ref.id, image.full.dataUrl);
      }
      await batch.commit();
      return { ...note, id: ref.id };
    },

    // image: undefined = 그대로, null = 사진 빼기, 객체 = 새 사진
    async updateNote(note, patch, image) {
      const { id } = note;
      const batch = F.writeBatch(db);
      const { author, ...editable } = patch;
      const fields = { ...editable, updatedAt: F.serverTimestamp() };
      if (image === null) {
        for (const k of ['img', 'imgType', 'imgW', 'imgH', 'imgFull', 'imgAnim']) fields[k] = F.deleteField();
      } else if (image) {
        Object.assign(fields, await imageFields(image));
        if (!image.anim) fields.imgAnim = F.deleteField();
      }
      batch.update(noteRef(id), fields);
      if (image?.full) {
        batch.set(imageRef(id), await fullImageDoc(image, note.date));
      } else if (image !== undefined && note.imgFull) {
        batch.delete(imageRef(id));
      }
      await batch.commit();
      if (image !== undefined) fullImages.delete(id);
      if (image?.full) fullImages.set(id, image.full.dataUrl);
    },

    async moveNote(id, pos) {
      await F.updateDoc(noteRef(id), { x: pos.x, y: pos.y, z: pos.z, updatedAt: F.serverTimestamp() });
    },

    async deleteNote(note) {
      const batch = F.writeBatch(db);
      batch.delete(noteRef(note.id));
      if (note.imgFull) batch.delete(imageRef(note.id));
      await batch.commit();
      fullImages.delete(note.id);
    },

    // fresh: 사진이 바뀌었을 수 있어서 기억해 둔 것 말고 새로 불러와요.
    async getFullImage(id, { fresh = false } = {}) {
      if (!fresh && fullImages.has(id)) return fullImages.get(id);
      const snap = await F.getDoc(imageRef(id));
      const data = snap.exists() ? toDataUrl(snap.get('data'), snap.get('type')) : null;
      if (data) fullImages.set(id, data);
      return data;
    },

    async countDays(keys) {
      const counts = new Map();
      await Promise.all(keys.map(async (k) => {
        const snap = await F.getCountFromServer(F.query(notesCol, F.where('date', '==', k)));
        counts.set(k, snap.data().count);
      }));
      return counts;
    },

    // 접속 수만 공개하고, 이름은 보내거나 표시하지 않아요.
    watchPresence(onChange, options) {
      return watchPresence({ F, db, config, getUid: () => session.user?.uid,
        onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      }, onChange, options);
    },

    async firstDay() {
      const snap = await F.getDocs(F.query(notesCol, F.orderBy('date'), F.limit(1)));
      return snap.empty ? null : snap.docs[0].get('date');
    },
  };
}
