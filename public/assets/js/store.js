// 저장소: Firebase Firestore에 글을 저장하고, Google 로그인으로 '내 글'을 구분해요.
// 보드는 로그인 없이도 볼 수 있고, 실시간으로 구독해서 다른 방문자가 남기거나 옮긴 글이 바로 보여요.
//
// 컬렉션 구조
//   notes/{id}   보드에 붙은 글 (작은 사진 포함)
//   images/{id}  크게 보기용 사진 (글을 눌렀을 때만 불러와요)
//   admins/{uid} 관리자 표시용 문서 (Firebase 콘솔에서 직접 만들어요)
//   profiles/{uid} 내 닉네임 (프로필 창에서 바꿔요)
//   presence/{id}  지금 보는 사람. 브라우저마다 하나, 마지막으로 본 시각 (+ 로그인했으면 uid와 이름)

import { accountAuthor } from './notes.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

export async function createStore(config) {
  if (!config.firebase) throw new Error('public/config.js 에 Firebase 설정이 없어요.');
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);

  const app = initializeApp(config.firebase);
  const auth = A.initializeAuth(app, {
    persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence],
    popupRedirectResolver: A.browserPopupRedirectResolver,
  });
  const db = F.initializeFirestore(app, {});
  if (config.emulator) {
    const { host, firestorePort, authPort } = config.emulator;
    A.connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    F.connectFirestoreEmulator(db, host, firestorePort);
  }

  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  // 로그인 상태가 바뀌면 관리자인지, 닉네임이 있는지도 확인하고 화면에 알려요.
  const session = { user: null, isAdmin: false };
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
    session.user = user ? { uid: user.uid, name: user.displayName || '', email: user.email || '', nickname } : null;
    session.isAdmin = isAdmin;
    settle();
    for (const fn of listeners) fn();
  });
  await firstState;

  // 로그인/로그아웃 뒤 관리자 확인까지 끝나서 화면에 반영될 때까지 기다려요.
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
    // 새 글에 붙는 이름: 닉네임, 없으면 Google 계정 이름 (보안 규칙의 authorName()과 같아요)
    get author() {
      return session.user ? accountAuthor(session.user.nickname || session.user.name) : '';
    },
    // 빈 이름이면 닉네임을 지우고 Google 계정 이름으로 돌아가요.
    async setNickname(name) {
      const nickname = name.trim();
      if (nickname) await F.setDoc(profileRef(session.user.uid), { name: nickname, updatedAt: F.serverTimestamp() });
      else await F.deleteDoc(profileRef(session.user.uid));
      session.user = { ...session.user, nickname };
      for (const fn of listeners) fn();
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
    // 팝업이 막히지 않게 버튼을 누른 바로 그 순간에 불러야 해요. (await 전에 팝업을 열어요)
    async signIn() {
      const { user } = await A.signInWithPopup(auth, provider);
      await untilSession((s) => s.user?.uid === user.uid);
      return session.user;
    },
    async signOut() {
      await A.signOut(auth);
      await untilSession((s) => !s.user);
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
        author: accountAuthor(session.user.nickname || session.user.name),
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

    // 지금 보는 사람 수: 화면을 보고 있는 동안 every마다 '여기 있어요'를 남기고,
    // 최근 window 안에 남긴 브라우저 수를 세요. (세기는 1번 읽기로 끝나서 사람이 많아도 싸요)
    // 지금 보는 사람: 1분마다 "보고 있음"을 남기고 최근 window 안에 남긴 사람 수를 알려 줘요.
    // 로그인했으면 이름도 남겨서 누가 보는지 보여 줄 수 있어요. (익명 방문자는 시각만 남겨요)
    watchPresence(onCount, { every = 60_000, window: recent = 90_000 } = {}) {
      const KEY = 'guestnote:visitor';
      let id = '';
      try { id = localStorage.getItem(KEY) || ''; } catch { /* 저장 공간을 못 쓰는 브라우저 */ }
      if (!/^[a-z0-9]{20}$/.test(id)) {
        id = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
        try { localStorage.setItem(KEY, id); } catch { /* 이번 방문 동안만 써요 */ }
      }
      const ref = F.doc(db, 'presence', id);
      const col = F.collection(db, 'presence');
      const recentQuery = () => F.query(col, F.where('seen', '>', F.Timestamp.fromMillis(Date.now() - recent)));
      const mark = () => (session.user
        ? { seen: F.serverTimestamp(), uid: session.user.uid, name: accountAuthor(session.user.nickname || session.user.name) }
        : { seen: F.serverTimestamp() });
      let timer = 0;
      const tick = async () => {
        clearTimeout(timer);
        if (document.hidden) return;
        timer = setTimeout(tick, every);
        try {
          await F.setDoc(ref, mark());
          const snap = await F.getCountFromServer(recentQuery());
          onCount(Math.max(1, snap.data().count));
        } catch {
          // 세지 못하면 표시를 숨겨요. (무료 한도를 넘었거나 연결이 끊긴 경우)
          onCount(null);
        }
      };
      // 로그인/로그아웃하거나 닉네임을 바꾸면 바로 다시 남겨요.
      let last = session.user ? `${session.user.uid}:${session.user.nickname}:${session.user.name}` : '';
      const onAuth = () => {
        const now = session.user ? `${session.user.uid}:${session.user.nickname}:${session.user.name}` : '';
        if (now !== last) { last = now; tick(); }
      };
      const onVisible = () => { if (!document.hidden) tick(); };
      // 창을 닫으면 바로 빠지도록 지워 봐요. (못 지워도 window가 지나면 세지 않아요)
      const onLeave = () => { F.deleteDoc(ref).catch(() => {}); };
      listeners.add(onAuth);
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('pagehide', onLeave);
      tick();
      return {
        // 누가 보는지: 로그인한 사람은 이름(같은 계정은 한 번만), 나머지는 익명 수.
        // 목록을 열 때만 불러서 읽기 횟수를 아껴요.
        async list() {
          const snap = await F.getDocs(recentQuery());
          const named = new Map();
          let anonymous = 0;
          // 내 기록은 반영 전일 수 있어서 지금 상태로 직접 넣어요.
          if (session.user) named.set(session.user.uid, { uid: session.user.uid, name: accountAuthor(session.user.nickname || session.user.name), me: true });
          else anonymous += 1;
          for (const d of snap.docs) {
            if (d.id === id) continue;
            const uid = d.get('uid');
            const name = d.get('name');
            if (typeof uid === 'string' && typeof name === 'string' && name) {
              if (!named.has(uid)) named.set(uid, { uid, name, me: false });
            } else {
              anonymous += 1;
            }
          }
          const people = [...named.values()].sort((a, b) => (b.me - a.me) || a.name.localeCompare(b.name, 'ko'));
          return { people, anonymous, total: people.length + anonymous };
        },
        stop() {
          clearTimeout(timer);
          listeners.delete(onAuth);
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('pagehide', onLeave);
        },
      };
    },

    async firstDay() {
      const snap = await F.getDocs(F.query(notesCol, F.orderBy('date'), F.limit(1)));
      return snap.empty ? null : snap.docs[0].get('date');
    },
  };
}
