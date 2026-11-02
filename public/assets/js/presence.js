// 탭마다, 화면을 보는 구간마다 별도의 접속 기록을 써요.
// 지운 문서를 늦은 heartbeat가 다시 만들지 않도록 첫 저장 뒤에는 updateDoc만 써요.
export function watchPresence({ F, db, config, getUid, onAuthChange }, onChange, {
  every = 10_000, window: recent = 25_000,
} = {}) {
  const col = F.collection(db, 'presence');
  const base = config.emulator
    ? `http://${config.emulator.host}:${config.emulator.firestorePort}`
    : 'https://firestore.googleapis.com';
  let active = null;
  let docs = [];
  let skew = 0;
  let unsub = null;
  let beat = 0;
  let sweep = 0;
  let stopped = false;

  const emit = () => {
    const cutoff = Date.now() + skew - recent;
    const me = getUid();
    const others = new Set();
    for (const d of docs) {
      if (d.id === active?.id || d.seen < cutoff || (me && d.uid === me)) continue;
      others.add(d.uid || d.id);
    }
    onChange({ total: others.size });
  };

  function remove(segment) {
    // keepalive는 페이지가 닫힌 뒤에도 전송돼요. SDK 요청도 보내 일반적인 탭 전환을 처리해요.
    const url = `${base}/v1/projects/${config.firebase.projectId}/databases/(default)/documents/presence/${segment.id}?key=${encodeURIComponent(config.firebase.apiKey)}`;
    try { fetch(url, { method: 'DELETE', keepalive: true, mode: 'cors' }).catch(() => {}); } catch { /* SDK로도 지워요 */ }
    F.deleteDoc(segment.ref).catch(() => {});
  }

  function listen() {
    if (unsub) return;
    const since = F.Timestamp.fromMillis(Date.now() + skew - recent);
    unsub = F.onSnapshot(F.query(col, F.where('seen', '>', since)), (snap) => {
      docs = snap.docs.map(d => ({
        id: d.id,
        seen: d.get('seen', { serverTimestamps: 'estimate' })?.toMillis?.() ?? Date.now(),
        uid: typeof d.get('uid') === 'string' ? d.get('uid') : '',
      }));
      const mine = snap.docs.find(d => d.id === active?.id && !d.metadata.hasPendingWrites);
      if (mine && active.wroteAt) {
        skew = mine.get('seen').toMillis() - active.wroteAt;
        active.wroteAt = 0;
      }
      emit();
    }, () => {
      unsub = null;
      onChange(null);
    });
  }

  async function write(segment) {
    // 익명 로그인 도중 무인증 쓰기를 먼저 보내면 인증 전환 때 요청이 대기할 수 있어요.
    // 계정 준비 알림이 오면 바로 다시 시도해요.
    if (segment !== active || segment.pending || stopped || document.hidden || !getUid()) return;
    segment.pending = true;
    const uid = getUid();
    const mark = { seen: F.serverTimestamp(), ...(uid ? { uid } : {}) };
    segment.wroteAt = Date.now();
    let saved = false;
    try {
      const save = data => segment.created ? F.updateDoc(segment.ref, data) : F.setDoc(segment.ref, data);
      try {
        await save(mark);
      } catch (err) {
        // 예전 규칙을 쓰는 사이트도 이름 없이 접속 수만 남길 수 있어요.
        if (err?.code !== 'permission-denied') throw err;
        await save({ seen: F.serverTimestamp() });
      }
      segment.created = true;
      segment.uid = uid;
      saved = true;
    } catch (err) {
      // 삭제된 문서는 다시 만들지 않아요. 다음 표시 구간에 새 문서를 써요.
      if (err?.code === 'not-found' && segment === active) {
        pause();
        start();
      }
    } finally {
      segment.pending = false;
      // 퇴장 직전에 시작한 첫 저장이 늦게 끝났어도 남아 있지 않게 다시 지워요.
      if (segment !== active || stopped || document.hidden) remove(segment);
      else if (saved && uid !== getUid()) write(segment);
    }
  }

  function tick() {
    if (!active || stopped || document.hidden) return;
    listen();
    write(active);
    clearTimeout(beat);
    beat = setTimeout(tick, every);
  }

  function start() {
    if (stopped || document.hidden) return;
    if (!active) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(20)), b =>
        'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      active = { id, ref: F.doc(db, 'presence', id), created: false, pending: false, uid: null, wroteAt: 0 };
    }
    tick();
    clearInterval(sweep);
    sweep = setInterval(emit, Math.min(5_000, recent / 4));
  }

  function pause() {
    clearTimeout(beat);
    clearInterval(sweep);
    const leaving = active;
    active = null;
    if (leaving) remove(leaving);
    unsub?.();
    unsub = null;
  }

  const authChanged = () => {
    emit();
    if (active) write(active);
  };
  const offAuth = onAuthChange(authChanged);
  const onVisible = () => document.hidden ? pause() : start();
  const onShow = e => { if (e.persisted) start(); };
  const onOnline = () => { if (!document.hidden) start(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', onShow);
  window.addEventListener('online', onOnline);
  start();

  return {
    stop() {
      stopped = true;
      pause();
      offAuth();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('online', onOnline);
    },
  };
}
