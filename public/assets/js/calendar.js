// 지난 기록 달력. 글이 있는 날에는 그날의 빛깔로 점이 찍혀요.
import { $, h, setupDialog } from './ui.js';
import { monthKeys, weekdayIndex, describeDay, dayHue, addDays } from './dates.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export function createCalendar({ dialog, store, getToday, onPick }) {
  const grid = $('#calGrid', dialog);
  const title = $('#calTitle', dialog);
  const prevBtn = $('#calPrev', dialog);
  const nextBtn = $('#calNext', dialog);
  const todayBtn = $('#calToday', dialog);
  const status = $('#calStatus', dialog);
  const counts = new Map();
  // 글이 처음 남겨진 날. 그 전 날짜는 셀 필요가 없어요. 저장소에서 한 번 불러온 뒤에만 믿어요.
  let firstDay = null;
  let firstDayLoaded = false;
  let month = null;
  let selected = null;
  let ticket = 0;

  const modal = setupDialog(dialog);

  $('#calWeek', dialog).replaceChildren(...WEEK.map((w) => h('span', { text: w })));

  function monthOf(key) {
    const { year, month: m } = describeDay(key);
    return { y: year, m };
  }

  function shiftMonth(delta) {
    let { y, m } = month;
    m += delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    month = { y, m };
    render();
  }

  function dotLevel(n) {
    if (!n) return '0';
    if (n < 3) return '1';
    if (n < 10) return '2';
    return '3';
  }

  async function render(focusKey) {
    const my = ++ticket;
    const today = getToday();
    const keys = monthKeys(month.y, month.m);
    title.textContent = `${month.y}년 ${month.m}월`;
    nextBtn.disabled = keys[keys.length - 1] >= today;
    const lead = weekdayIndex(keys[0]);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'cal__pad', 'aria-hidden': 'true' }));
    for (const key of keys) {
      const { day } = describeDay(key);
      const btn = h('button', {
        type: 'button',
        class: 'cal__day',
        dataset: { key },
        disabled: key > today,
        'aria-current': key === selected ? 'date' : null,
        'aria-label': `${month.m}월 ${day}일`,
      }, h('span', { class: 'cal__num', text: String(day) }), h('span', { class: 'cal__dot', 'aria-hidden': 'true' }));
      btn.style.setProperty('--dh', String(dayHue(key)));
      if (key === today) btn.classList.add('is-today');
      cells.push(btn);
    }
    grid.replaceChildren(...cells);
    paintCounts(keys);
    if (focusKey) grid.querySelector(`[data-key="${focusKey}"]`)?.focus();

    try {
      if (!firstDayLoaded) {
        firstDay = await store.firstDay();
        firstDayLoaded = true;
      }
      if (my !== ticket) return;
      const need = keys.filter((k) => k <= today && firstDay && k >= firstDay && (k === today || !counts.has(k)));
      if (need.length) {
        status.textContent = '기록을 불러오는 중…';
        const fresh = await store.countDays(need);
        for (const [k, n] of fresh) counts.set(k, n);
      }
      if (my !== ticket) return;
      status.textContent = firstDay ? '' : '아직 남겨진 글이 없어요.';
      paintCounts(keys);
    } catch {
      if (my === ticket) status.textContent = '기록을 불러오지 못했어요. 잠시 후 다시 열어 주세요.';
    }
  }

  function paintCounts(keys) {
    for (const key of keys) {
      const btn = grid.querySelector(`[data-key="${key}"]`);
      if (!btn) continue;
      const n = counts.get(key) ?? 0;
      btn.dataset.level = dotLevel(n);
      const { month: m, day } = describeDay(key);
      const label = `${m}월 ${day}일${key === getToday() ? ' 오늘' : ''}${n ? `, 글 ${n}개` : ''}`;
      btn.setAttribute('aria-label', label);
      btn.title = n ? `글 ${n}개` : '';
    }
  }

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.cal__day');
    if (!btn || btn.disabled) return;
    modal.close();
    onPick(btn.dataset.key);
  });

  // 화살표로 날짜 사이를 움직여요.
  grid.addEventListener('keydown', (e) => {
    const btn = e.target.closest('.cal__day');
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!btn || !step) return;
    e.preventDefault();
    const key = addDays(btn.dataset.key, step);
    if (key > getToday()) return;
    const target = monthOf(key);
    if (target.y !== month.y || target.m !== month.m) {
      month = target;
      render(key);
    } else {
      grid.querySelector(`[data-key="${key}"]`)?.focus();
    }
  });

  prevBtn.addEventListener('click', () => shiftMonth(-1));
  nextBtn.addEventListener('click', () => shiftMonth(1));
  todayBtn.addEventListener('click', () => {
    modal.close();
    onPick(getToday());
  });

  return {
    open(viewKey) {
      selected = viewKey;
      month = monthOf(viewKey);
      modal.open();
      render(viewKey);
    },
    // 오늘 글 수가 바뀌면 달력도 새로 세요.
    noteCountChanged(key, n) {
      counts.set(key, n);
      if (firstDayLoaded && n > 0 && (!firstDay || key < firstDay)) firstDay = key;
    },
  };
}
