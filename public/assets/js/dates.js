// 날짜 계산. 보드의 '하루'는 설정한 시간대의 자정을 기준으로 바뀌어요.
// 날짜 키는 'YYYY-MM-DD' 문자열이라 문자열 비교만으로 앞뒤를 알 수 있어요.

const DAY_MS = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const formatters = new Map();

function formatter(locale, timeZone, options) {
  const id = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let f = formatters.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    formatters.set(id, f);
  }
  return f;
}

function zonedParts(date, timeZone) {
  const parts = {};
  const f = formatter('en-CA', timeZone, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (const p of f.formatToParts(date)) parts[p.type] = p.value;
  return parts;
}

export function dayKey(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function isDayKey(value) {
  const m = KEY_RE.exec(typeof value === 'string' ? value : '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function keyToUTC(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(key, n) {
  return new Date(keyToUTC(key) + n * DAY_MS).toISOString().slice(0, 10);
}

export function monthKeys(year, month) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return Array.from({ length: days }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, '0')}`);
}

export function describeDay(key) {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day, weekday: WEEKDAYS[new Date(keyToUTC(key)).getUTCDay()] };
}

export function weekdayIndex(key) {
  return new Date(keyToUTC(key)).getUTCDay();
}

// 다음 자정까지 남은 시간(ms)
export function msUntilNextDay(timeZone, now = new Date()) {
  const p = zonedParts(now, timeZone);
  const elapsed = ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 + now.getMilliseconds();
  return Math.max(1000, DAY_MS - elapsed);
}

export function formatTime(ms, timeZone) {
  return formatter('ko-KR', timeZone, { hour: 'numeric', minute: '2-digit' }).format(ms);
}

export function formatDateTime(ms, timeZone) {
  return formatter('ko-KR', timeZone, {
    month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit',
  }).format(ms);
}

// 날마다 다른 빛깔. 황금각만큼 색상을 돌려서 이웃한 날끼리 색이 겹치지 않게 해요.
// 탁해 보이는 연두 구간(112~138)은 건너뛰어요.
export function dayHue(key) {
  const n = Math.round(keyToUTC(key) / DAY_MS);
  const raw = (((n * 137.508) % 334) + 334) % 334;
  return raw < 112 ? raw : raw + 26;
}
