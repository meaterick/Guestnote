// 공유 모드 저장소. Firebase Firestore에 저장하고, 익명 로그인으로 '내 글'을 구분해요.
// 보드는 실시간으로 구독해서 다른 방문자가 남기거나 옮긴 글이 바로 보여요.
//
// 컬렉션 구조
//   notes/{id}   보드에 붙은 글 (작은 사진 포함)
//   images/{id}  크게 보기용 사진 (글을 눌렀을 때만 불러와요)
//   admins/{uid} 관리자 표시용 빈 문서 (Firebase 콘솔에서 직접 만들어요)

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

export async function createFirebaseStore(config) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);

  const app = initializeApp(config.firebase);
  const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
  const db = F.initializeFirestore(app, {});
  if (config.emulator) {
    const { host, firestorePort, authPort } = config.emulator;
    A.connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    F.connectFirestoreEmulator(db, host, firestorePort);
  }

  let uid = null;
  let authError = null;
  try {
    await auth.authStateReady();
    if (!auth.currentUser) await A.signInAnonymously(auth);
    uid = auth.currentUser.uid;
  } catch (err) {
    authError = err;
  }

  let isAdmin = false;
  if (uid) {
    try {
      isAdmin = (await F.getDoc(F.doc(db, 'admins', uid))).exists();
    } catch {
      isAdmin = false;
    }
  }

  const notesCol = F.collection(db, 'notes');
  const noteRef = (id) => F.doc(db, 'notes', id);
  const imageRef = (id) => F.doc(db, 'images', id);
  const fullImages = new Map();

  function toNote(snap) {
    const d = snap.data({ serverTimestamps: 'estimate' });
    return {
      ...d,
      id: snap.id,
      createdAt: d.createdAt?.toMillis?.() ?? Date.now(),
      updatedAt: d.updatedAt?.toMillis?.() ?? Date.now(),
    };
  }

  function imageFields(image) {
    return { img: image.thumb.dataUrl, imgW: image.thumb.width, imgH: image.thumb.height, imgFull: !!image.full };
  }

  return {
    mode: 'firebase',
    uid,
    isAdmin,
    canWrite: !!uid,
    authError,

    subscribeDay(date, onNotes, onError) {
      const q = F.query(notesCol, F.where('date', '==', date));
      return F.onSnapshot(q, (snap) => {
        onNotes(snap.docs.map(toNote).sort((a, b) => a.createdAt - b.createdAt));
      }, onError);
    },

    async createNote(data, image) {
      const ref = F.doc(notesCol);
      const batch = F.writeBatch(db);
      const note = {
        ...data,
        ownerId: uid,
        createdAt: F.serverTimestamp(),
        updatedAt: F.serverTimestamp(),
        ...(image ? imageFields(image) : {}),
      };
      batch.set(ref, note);
      if (image?.full) {
        batch.set(imageRef(ref.id), { data: image.full.dataUrl, ownerId: uid, date: data.date });
        fullImages.set(ref.id, image.full.dataUrl);
      }
      await batch.commit();
      return { ...note, id: ref.id };
    },

    // image: undefined = 그대로, null = 사진 빼기, 객체 = 새 사진
    async updateNote(note, patch, image) {
      const { id } = note;
      const batch = F.writeBatch(db);
      const fields = { ...patch, updatedAt: F.serverTimestamp() };
      if (image === null) {
        Object.assign(fields, { img: F.deleteField(), imgW: F.deleteField(), imgH: F.deleteField(), imgFull: F.deleteField() });
      } else if (image) {
        Object.assign(fields, imageFields(image));
      }
      batch.update(noteRef(id), fields);
      if (image?.full) {
        batch.set(imageRef(id), { data: image.full.dataUrl, ownerId: uid, date: note.date });
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

    async getFullImage(id) {
      if (fullImages.has(id)) return fullImages.get(id);
      const snap = await F.getDoc(imageRef(id));
      const data = snap.exists() ? snap.data().data : null;
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

    async firstDay() {
      const snap = await F.getDocs(F.query(notesCol, F.orderBy('date'), F.limit(1)));
      return snap.empty ? null : snap.docs[0].get('date');
    },
  };
}
