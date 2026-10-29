// 큰 보드: 끌어서 둘러보기, 확대/축소, 내 글 옮기기, 미니맵
import { clamp } from './ui.js';
import { createNoteElement, paintNote, TINTS } from './notes.js';

// 보드 크기. firestore.rules 의 좌표 범위와 같아야 해요.
export const WORLD = { w: 4000, h: 2600 };
const MIN_SCALE = 0.06;
const MAX_SCALE = 2.4;
const KEEP_VISIBLE = 120;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createBoard({ viewport, world, layer, minimap, handlers }) {
  const view = { x: 0, y: 0, s: 1 };
  const items = new Map(); // id → { el, note }
  const pointers = new Map();
  const kbMoves = new Map();
  let ctx = { uid: null, timeZone: 'Asia/Seoul', canMove: () => false };
  let maxZ = 0;
  let gesture = null;
  let lastTap = null;
  let anim = 0;
  let edgeRaf = 0;
  let mmRaf = 0;
  let kbTimer = 0;
  let settled = false;
  let flashId = null;

  // ---------- 화면 ↔ 보드 좌표 ----------
  function toWorld(cx, cy) {
    const r = viewport.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.s, y: (cy - r.top - view.y) / view.s };
  }

  function visibleArea() {
    const ins = handlers.insets();
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    return { left: ins.left, top: ins.top, width: Math.max(80, vw - ins.left - ins.right), height: Math.max(80, vh - ins.top - ins.bottom) };
  }

  function visibleCenter() {
    const a = visibleArea();
    return { x: (a.left + a.width / 2 - view.x) / view.s, y: (a.top + a.height / 2 - view.y) / view.s };
  }

  function minScale() {
    const fitAll = Math.min(viewport.clientWidth / WORLD.w, viewport.clientHeight / WORLD.h) * 0.92;
    return Math.min(0.5, Math.max(MIN_SCALE, fitAll));
  }

  function clampView() {
    view.s = clamp(view.s, minScale(), MAX_SCALE);
    const ww = WORLD.w * view.s;
    const wh = WORLD.h * view.s;
    const kx = Math.min(KEEP_VISIBLE, ww);
    const ky = Math.min(KEEP_VISIBLE, wh);
    view.x = clamp(view.x, kx - ww, viewport.clientWidth - kx);
    view.y = clamp(view.y, ky - wh, viewport.clientHeight - ky);
  }

  function apply() {
    world.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`;
    handlers.onView?.(view);
    drawMinimapSoon();
  }

  function setView(target) {
    cancelAnimationFrame(anim);
    Object.assign(view, target);
    clampView();
    apply();
  }

  function animateTo(target, ms = 320) {
    cancelAnimationFrame(anim);
    const to = { ...view, ...target };
    // 목표 위치를 미리 범위 안으로 맞춰 둬요.
    const saved = { ...view };
    Object.assign(view, to);
    clampView();
    const goal = { ...view };
    Object.assign(view, saved);
    if (reducedMotion()) return setView(goal);
    const from = { ...view };
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      view.x = from.x + (goal.x - from.x) * e;
      view.y = from.y + (goal.y - from.y) * e;
      view.s = from.s + (goal.s - from.s) * e;
      apply();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  function centeredOn(wx, wy, s) {
    const a = visibleArea();
    return { s, x: a.left + a.width / 2 - wx * s, y: a.top + a.height / 2 - wy * s };
  }

  function zoomAt(scale, cx, cy, animate = false) {
    const r = viewport.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    const wx = (px - view.x) / view.s;
    const wy = (py - view.y) / view.s;
    const s = clamp(scale, minScale(), MAX_SCALE);
    const target = { s, x: px - wx * s, y: py - wy * s };
    if (animate) animateTo(target, 220);
    else setView(target);
  }

  function zoomBy(factor) {
    const a = visibleArea();
    const r = viewport.getBoundingClientRect();
    zoomAt(view.s * factor, r.left + a.left + a.width / 2, r.top + a.top + a.height / 2, true);
  }

  function noteRect(item, pos = item.note) {
    return { x: pos.x, y: pos.y, w: item.el.offsetWidth, h: item.el.offsetHeight };
  }

  function contentBox() {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const item of items.values()) {
      const r = noteRect(item);
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // 글이 있으면 글이 모두 보이게, 없으면 보드 한가운데를 보여 줘요.
  function fit({ animate = true, whole = false } = {}) {
    const a = visibleArea();
    let target;
    if (whole) {
      const s = Math.min(a.width / WORLD.w, a.height / WORLD.h);
      target = centeredOn(WORLD.w / 2, WORLD.h / 2, s);
    } else if (items.size) {
      const b = contentBox();
      const pad = 64;
      const s = clamp(Math.min(a.width / (b.w + pad * 2), a.height / (b.h + pad * 2)), minScale(), 1);
      target = centeredOn(b.x + b.w / 2, b.y + b.h / 2, s);
    } else {
      const s = clamp(Math.min(a.width / 1100, a.height / 640), 0.45, 1);
      target = centeredOn(WORLD.w / 2, WORLD.h / 2, s);
    }
    if (animate) animateTo(target);
    else setView(target);
  }

  // 화면 밖에 있는 글이 보이도록 보드를 옮겨요.
  function reveal(rect) {
    const a = visibleArea();
    const m = 24;
    const sx = rect.x * view.s + view.x;
    const sy = rect.y * view.s + view.y;
    const sw = rect.w * view.s;
    const shh = rect.h * view.s;
    let dx = 0; let dy = 0;
    if (sw + m * 2 > a.width || shh + m * 2 > a.height) {
      return animateTo(centeredOn(rect.x + rect.w / 2, rect.y + rect.h / 2, view.s));
    }
    if (sx < a.left + m) dx = a.left + m - sx;
    else if (sx + sw > a.left + a.width - m) dx = a.left + a.width - m - (sx + sw);
    if (sy < a.top + m) dy = a.top + m - sy;
    else if (sy + shh > a.top + a.height - m) dy = a.top + a.height - m - (sy + shh);
    if (dx || dy) animateTo({ x: view.x + dx, y: view.y + dy });
  }

  // ---------- 글 그리기 ----------
  function place(el, x, y) {
    el.style.translate = `${x}px ${y}px`;
  }

  function glide(el) {
    if (reducedMotion()) return;
    el.classList.add('is-gliding');
    clearTimeout(el._glide);
    el._glide = setTimeout(() => el.classList.remove('is-gliding'), 450);
  }

  function setNotes(notes, nextCtx) {
    ctx = nextCtx;
    const seen = new Set();
    maxZ = 0;
    for (const note of notes) {
      seen.add(note.id);
      maxZ = Math.max(maxZ, Number(note.z) || 0);
      let item = items.get(note.id);
      const isNew = !item;
      if (isNew) {
        item = { el: createNoteElement(note), note };
        items.set(note.id, item);
        layer.append(item.el);
        if (settled && !reducedMotion()) {
          item.el.classList.add('is-arriving');
          item.el.addEventListener('animationend', () => item.el.classList.remove('is-arriving'), { once: true });
        }
      }
      const moved = !isNew && (item.note.x !== note.x || item.note.y !== note.y);
      item.note = note;
      paintNote(item.el, note, ctx);
      const busy = (gesture?.type === 'note' && gesture.id === note.id) || kbMoves.has(note.id);
      if (!busy) {
        if (moved) glide(item.el);
        place(item.el, note.x, note.y);
        item.el.style.zIndex = String(Number(note.z) || 0);
      }
      if (flashId === note.id) {
        flashId = null;
        flash(item.el);
      }
    }
    for (const [id, item] of items) {
      if (!seen.has(id)) {
        item.el.remove();
        items.delete(id);
      }
    }
    settled = true;
    drawMinimapSoon();
  }

  function flash(el) {
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 1600);
  }

  function reset() {
    for (const item of items.values()) item.el.remove();
    items.clear();
    kbMoves.clear();
    settled = false;
    maxZ = 0;
    drawMinimapSoon();
  }

  // ---------- 빈자리 찾기 ----------
  function clampPos(x, y, w, h) {
    return {
      x: Math.round(clamp(x, 0, WORLD.w - w)),
      y: Math.round(clamp(y, 0, WORLD.h - Math.min(h, 160))),
    };
  }

  function findSpot(w, h, near = visibleCenter()) {
    const rects = [...items.values()].map((item) => noteRect(item));
    const pad = 18;
    const free = (x, y) => x >= 0 && y >= 0 && x + w <= WORLD.w && y + h <= WORLD.h
      && rects.every((r) => x + w + pad <= r.x || r.x + r.w + pad <= x || y + h + pad <= r.y || r.y + r.h + pad <= y);
    for (let i = 0; i < 1200; i++) {
      const radius = 48 * Math.sqrt(i);
      const angle = i * 2.39996;
      const x = Math.round(near.x - w / 2 + Math.cos(angle) * radius);
      const y = Math.round(near.y - h / 2 + Math.sin(angle) * radius * 0.72);
      if (free(x, y)) return { x, y };
    }
    return clampPos(near.x - w / 2, near.y - h / 2, w, h);
  }

  // ---------- 옮기기 저장 ----------
  function commitMove(item, pos) {
    maxZ += 1;
    const next = { x: Math.round(pos.x), y: Math.round(pos.y), z: maxZ };
    place(item.el, next.x, next.y);
    item.el.style.zIndex = String(next.z);
    Promise.resolve(handlers.onMove(item.note, next)).catch(() => {
      place(item.el, item.note.x, item.note.y);
      item.el.style.zIndex = String(Number(item.note.z) || 0);
    });
  }

  // ---------- 포인터: 둘러보기 / 글 옮기기 / 두 손가락 확대 ----------
  function itemFromTarget(target) {
    const el = target.closest?.('.note');
    return el ? items.get(el.dataset.id) : null;
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    if (gesture?.type === 'note' && gesture.moved) return;
    if (gesture?.type === 'note') gesture.item.el.classList.remove('is-dragging');
    gesture = {
      type: 'pinch',
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: { ...view },
    };
  }

  function updatePinch() {
    const [a, b] = [...pointers.values()];
    const r = viewport.getBoundingClientRect();
    const g = gesture;
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const m = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    const wx = (g.mid.x - r.left - g.view.x) / g.view.s;
    const wy = (g.mid.y - r.top - g.view.y) / g.view.s;
    const s = clamp(g.view.s * (d / g.dist), minScale(), MAX_SCALE);
    setView({ s, x: m.x - wx * s, y: m.y - wy * s });
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    cancelAnimationFrame(anim);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { viewport.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터 */ }
    if (pointers.size === 2) return startPinch();
    if (pointers.size > 2) return;
    const item = itemFromTarget(e.target);
    const start = { x: e.clientX, y: e.clientY };
    if (item && e.button === 0 && ctx.canMove(item.note)) {
      const w = toWorld(e.clientX, e.clientY);
      gesture = {
        type: 'note', pid: e.pointerId, id: item.note.id, item, start, moved: false, pointer: start,
        grab: { x: w.x - item.note.x, y: w.y - item.note.y }, pos: { x: item.note.x, y: item.note.y },
      };
    } else {
      gesture = { type: 'pan', pid: e.pointerId, start, origin: { x: view.x, y: view.y }, item, moved: false };
    }
  }

  function positionDragged() {
    const g = gesture;
    const w = toWorld(g.pointer.x, g.pointer.y);
    const el = g.item.el;
    g.pos = {
      x: clamp(w.x - g.grab.x, 0, WORLD.w - el.offsetWidth),
      y: clamp(w.y - g.grab.y, 0, WORLD.h - Math.min(el.offsetHeight, 160)),
    };
    place(el, g.pos.x, g.pos.y);
  }

  // 글을 화면 가장자리로 끌고 가면 보드가 따라 움직여요.
  function edgeLoop() {
    const g = gesture;
    if (g?.type !== 'note' || !g.moved) { edgeRaf = 0; return; }
    const r = viewport.getBoundingClientRect();
    const zone = 56;
    const speed = 16;
    const px = g.pointer.x - r.left;
    const py = g.pointer.y - r.top;
    let vx = 0; let vy = 0;
    if (px < zone) vx = speed * (1 - px / zone);
    else if (px > r.width - zone) vx = -speed * (1 - (r.width - px) / zone);
    if (py < zone) vy = speed * (1 - py / zone);
    else if (py > r.height - zone) vy = -speed * (1 - (r.height - py) / zone);
    if (vx || vy) {
      setView({ x: view.x + vx, y: view.y + vy });
      positionDragged();
    }
    edgeRaf = requestAnimationFrame(edgeLoop);
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const g = gesture;
    if (!g) return;
    if (g.type === 'pinch') return pointers.size >= 2 && updatePinch();
    if (g.type === 'idle' || g.pid !== e.pointerId) return;
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < (e.pointerType === 'touch' ? 9 : 4)) return;
      g.moved = true;
      if (g.type === 'note') {
        g.item.el.classList.add('is-dragging');
        g.item.el.style.zIndex = String(maxZ + 1);
      } else {
        viewport.classList.add('is-panning');
      }
    }
    if (g.type === 'pan') {
      setView({ x: g.origin.x + dx, y: g.origin.y + dy });
    } else {
      g.pointer = { x: e.clientX, y: e.clientY };
      positionDragged();
      if (!edgeRaf) edgeRaf = requestAnimationFrame(edgeLoop);
    }
  }

  function onUp(e) {
    if (!pointers.delete(e.pointerId)) return;
    const g = gesture;
    if (!g) return;
    if (g.type === 'pinch' || g.type === 'idle') {
      gesture = pointers.size ? { type: 'idle' } : null;
      return;
    }
    if (g.pid !== e.pointerId) return;
    gesture = null;
    viewport.classList.remove('is-panning');
    if (g.type === 'note') {
      g.item.el.classList.remove('is-dragging');
      if (g.moved) commitMove(g.item, g.pos);
      else handlers.onOpen(g.item.note);
      return;
    }
    if (g.moved) return;
    if (g.item) return handlers.onOpen(g.item.note);
    // 빈 곳을 두 번 누르면 그 자리에 글을 남겨요.
    const now = performance.now();
    if (lastTap && now - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = null;
      handlers.onEmptyActivate(toWorld(e.clientX, e.clientY));
    } else {
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  }

  function onCancel(e) {
    pointers.delete(e.pointerId);
    const g = gesture;
    if (g?.type === 'note') {
      g.item.el.classList.remove('is-dragging');
      place(g.item.el, g.item.note.x, g.item.note.y);
      g.item.el.style.zIndex = String(Number(g.item.note.z) || 0);
    }
    viewport.classList.remove('is-panning');
    gesture = pointers.size ? { type: 'idle' } : null;
  }

  viewport.addEventListener('pointerdown', onDown);
  viewport.addEventListener('pointermove', onMove);
  viewport.addEventListener('pointerup', onUp);
  viewport.addEventListener('pointercancel', onCancel);

  // 휠: 그냥 굴리면 이동, Ctrl(또는 트랙패드 두 손가락 오므리기)과 함께면 확대/축소
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    if (e.ctrlKey || e.metaKey) {
      zoomAt(view.s * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      return;
    }
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? viewport.clientHeight : 1;
    const horizontal = e.shiftKey && !e.deltaX;
    setView({
      x: view.x - (horizontal ? e.deltaY : e.deltaX) * unit,
      y: view.y - (horizontal ? 0 : e.deltaY) * unit,
    });
  }, { passive: false });

  // macOS Safari 트랙패드 확대/축소
  let gestureScale = 1;
  viewport.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = view.s; });
  viewport.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    if (!pointers.size) zoomAt(gestureScale * e.scale, e.clientX, e.clientY);
  });

  // ---------- 키보드 ----------
  layer.addEventListener('keydown', (e) => {
    const item = itemFromTarget(e.target);
    if (!item) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handlers.onOpen(item.note);
      return;
    }
    const d = ARROWS[e.key];
    if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (!ctx.canMove(item.note)) {
      setView({ x: view.x - d[0] * 80, y: view.y - d[1] * 80 });
      return;
    }
    const step = e.shiftKey ? 64 : 16;
    const cur = kbMoves.get(item.note.id) ?? { x: item.note.x, y: item.note.y };
    const pos = {
      x: clamp(cur.x + d[0] * step, 0, WORLD.w - item.el.offsetWidth),
      y: clamp(cur.y + d[1] * step, 0, WORLD.h - Math.min(item.el.offsetHeight, 160)),
    };
    kbMoves.set(item.note.id, pos);
    place(item.el, pos.x, pos.y);
    item.el.style.zIndex = String(maxZ + 1);
    reveal(noteRect(item, pos));
    clearTimeout(kbTimer);
    kbTimer = setTimeout(() => {
      for (const [id, p] of kbMoves) {
        const it = items.get(id);
        if (it) commitMove(it, p);
      }
      kbMoves.clear();
    }, 500);
  });

  layer.addEventListener('focusin', (e) => {
    const item = itemFromTarget(e.target);
    if (item && item.el.matches(':focus-visible')) reveal(noteRect(item));
  });

  // ---------- 미니맵 ----------
  function drawMinimapSoon() {
    if (!mmRaf) mmRaf = requestAnimationFrame(drawMinimap);
  }

  function drawMinimap() {
    mmRaf = 0;
    if (!minimap || !minimap.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = minimap.clientWidth;
    const ch = minimap.clientHeight;
    if (minimap.width !== Math.round(cw * dpr)) {
      minimap.width = Math.round(cw * dpr);
      minimap.height = Math.round(ch * dpr);
    }
    const g = minimap.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const k = cw / WORLD.w;
    const style = getComputedStyle(minimap);
    for (const item of items.values()) {
      const r = noteRect(item);
      const hue = TINTS.find((t) => t.id === item.note.color)?.hue;
      g.fillStyle = '#ffffff';
      if (hue != null) g.fillStyle = `oklch(0.8 0.12 ${hue})`;
      g.globalAlpha = item.note.ownerId === ctx.uid ? 1 : 0.85;
      g.fillRect(r.x * k, r.y * k, Math.max(2, r.w * k), Math.max(2, r.h * k));
    }
    g.globalAlpha = 1;
    const vr = viewport.getBoundingClientRect();
    g.strokeStyle = style.getPropertyValue('--minimap-frame').trim() || '#1e2440';
    g.lineWidth = 1.5;
    g.strokeRect((-view.x / view.s) * k, (-view.y / view.s) * k, (vr.width / view.s) * k, (vr.height / view.s) * k);
  }

  if (minimap) {
    let mmDrag = false;
    const jump = (e) => {
      const r = minimap.getBoundingClientRect();
      const wx = ((e.clientX - r.left) / r.width) * WORLD.w;
      const wy = ((e.clientY - r.top) / r.height) * WORLD.h;
      setView(centeredOn(wx, wy, view.s));
    };
    minimap.addEventListener('pointerdown', (e) => {
      mmDrag = true;
      minimap.setPointerCapture(e.pointerId);
      jump(e);
    });
    minimap.addEventListener('pointermove', (e) => mmDrag && jump(e));
    minimap.addEventListener('pointerup', () => { mmDrag = false; });
    minimap.addEventListener('pointercancel', () => { mmDrag = false; });
  }

  window.addEventListener('resize', () => {
    clampView();
    apply();
  });

  apply();

  return {
    view,
    setNotes,
    reset,
    fit,
    zoomBy,
    zoomTo: (s) => {
      const a = visibleArea();
      const r = viewport.getBoundingClientRect();
      zoomAt(s, r.left + a.left + a.width / 2, r.top + a.top + a.height / 2, true);
    },
    panBy: (dx, dy) => animateTo({ x: view.x + dx, y: view.y + dy }, 200),
    toWorld,
    findSpot,
    clampPos,
    reveal,
    visibleCenter,
    flashWhenReady(id) {
      const item = items.get(id);
      if (item) flash(item.el);
      else flashId = id;
    },
    rectOf(id) {
      const item = items.get(id);
      return item ? noteRect(item) : null;
    },
    get maxZ() {
      return maxZ;
    },
    redrawMinimap: drawMinimapSoon,
  };
}
