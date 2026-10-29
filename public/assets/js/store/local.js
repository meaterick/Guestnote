// 로컬 모드 저장소. Firebase를 연결하기 전에는 글을 이 브라우저의 IndexedDB에 저장해요.
// 같은 브라우저의 다른 탭과는 BroadcastChannel로 바로 동기화돼요.

const DB_NAME = 'guestnote';
const DB_VERSION = 1;
const UID_KEY = 'guestnote:uid';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('notes', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('다른 탭에서 저장소를 쓰고 있어요. 탭을 닫고 다시 시도해 주세요.'));
  });
}

function run(db, stores, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    Promise.resolve(work(tx)).then((r) => { result = r; }, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장하지 못했어요.'));
  });
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// crypto.randomUUID는 https에서만 있어서, 어디서나 되는 getRandomValues를 써요.
function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function localUid() {
  try {
    let uid = localStorage.getItem(UID_KEY);
    if (!uid) {
      uid = `local-${randomHex(12)}`;
      localStorage.setItem(UID_KEY, uid);
    }
    return uid;
  } catch {
    return `local-${randomHex(12)}`;
  }
}

function imageFields(image) {
  return { img: image.thumb.dataUrl, imgW: image.thumb.width, imgH: image.thumb.height, imgFull: !!image.full };
}

export async function createLocalStore() {
  const db = await openDb();
  const uid = localUid();
  const subs = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('guestnote') : null;

  async function readDay(date) {
    const notes = await run(db, 'notes', 'readonly', (tx) => req(tx.objectStore('notes').index('date').getAll(date)));
    return notes.sort((a, b) => a.createdAt - b.createdAt);
  }

  function refresh(date) {
    for (const s of subs) {
      if (s.date === date) readDay(date).then(s.onNotes, s.onError);
    }
  }

  function changed(date) {
    refresh(date);
    channel?.postMessage({ date });
  }

  if (channel) channel.onmessage = (e) => refresh(e.data?.date);

  async function getNote(id) {
    const note = await run(db, 'notes', 'readonly', (tx) => req(tx.objectStore('notes').get(id)));
    if (!note) throw new Error('글을 찾지 못했어요. 이미 지워졌을 수 있어요.');
    return note;
  }

  return {
    mode: 'local',
    uid,
    isAdmin: false,
    canWrite: true,
    authError: null,

    subscribeDay(date, onNotes, onError) {
      const s = { date, onNotes, onError };
      subs.add(s);
      readDay(date).then(onNotes, onError);
      return () => subs.delete(s);
    },

    async createNote(data, image) {
      const now = Date.now();
      const note = { ...data, id: randomHex(10), ownerId: uid, createdAt: now, updatedAt: now };
      if (image) Object.assign(note, imageFields(image));
      await run(db, ['notes', 'images'], 'readwrite', (tx) => {
        tx.objectStore('notes').put(note);
        if (image?.full) tx.objectStore('images').put({ id: note.id, data: image.full.dataUrl });
      });
      changed(note.date);
      return note;
    },

    // image: undefined = 그대로, null = 사진 빼기, 객체 = 새 사진
    async updateNote(target, patch, image) {
      const { id } = target;
      const note = await getNote(id);
      const next = { ...note, ...patch, updatedAt: Date.now() };
      if (image === null) {
        delete next.img; delete next.imgW; delete next.imgH; delete next.imgFull;
      } else if (image) {
        Object.assign(next, imageFields(image));
      }
      await run(db, ['notes', 'images'], 'readwrite', (tx) => {
        tx.objectStore('notes').put(next);
        if (image?.full) tx.objectStore('images').put({ id, data: image.full.dataUrl });
        else if (image !== undefined) tx.objectStore('images').delete(id);
      });
      changed(note.date);
      return next;
    },

    async moveNote(id, pos) {
      const note = await getNote(id);
      await run(db, 'notes', 'readwrite', (tx) => {
        tx.objectStore('notes').put({ ...note, x: pos.x, y: pos.y, z: pos.z, updatedAt: Date.now() });
      });
      changed(note.date);
    },

    async deleteNote(note) {
      await run(db, ['notes', 'images'], 'readwrite', (tx) => {
        tx.objectStore('notes').delete(note.id);
        tx.objectStore('images').delete(note.id);
      });
      changed(note.date);
    },

    async getFullImage(id) {
      const row = await run(db, 'images', 'readonly', (tx) => req(tx.objectStore('images').get(id)));
      return row?.data ?? null;
    },

    async countDays(keys) {
      const counts = new Map();
      await run(db, 'notes', 'readonly', (tx) => {
        const index = tx.objectStore('notes').index('date');
        return Promise.all(keys.map(async (k) => counts.set(k, await req(index.count(k)))));
      });
      return counts;
    },

    async firstDay() {
      return run(db, 'notes', 'readonly', async (tx) => {
        const cursor = await req(tx.objectStore('notes').index('date').openKeyCursor());
        return cursor ? cursor.key : null;
      });
    },
  };
}
