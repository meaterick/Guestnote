// 날짜 계산 단위 테스트
// 실행: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, isDayKey, addDays, monthKeys, describeDay, msUntilNextDay, dayHue } from '../public/assets/js/dates.js';
import { accountAuthor } from '../public/assets/js/notes.js';

test('계정 이름은 공백을 빼고 20자로 줄이고, 없으면 방문자로 표시해요', () => {
  assert.equal(accountAuthor('  앨리스  '), '앨리스');
  assert.equal(accountAuthor(), '방문자');
  assert.equal(accountAuthor('   '), '방문자');
  assert.equal(accountAuthor('가'.repeat(21)), '가'.repeat(20));
  assert.equal(accountAuthor('😀'.repeat(21)), '😀'.repeat(10));
});

const TZ = 'Asia/Seoul';

test('한국 시간 자정을 기준으로 날짜가 바뀌어요', () => {
  assert.equal(dayKey(new Date('2026-10-29T14:59:59Z'), TZ), '2026-10-29');
  assert.equal(dayKey(new Date('2026-10-29T15:00:00Z'), TZ), '2026-10-30');
  assert.equal(dayKey(new Date('2026-12-31T15:00:00Z'), TZ), '2027-01-01');
  assert.equal(dayKey(new Date('2026-10-29T15:00:00Z'), 'UTC'), '2026-10-29');
});

test('자정까지 남은 시간을 계산해요', () => {
  assert.equal(msUntilNextDay(TZ, new Date('2026-10-29T14:59:00Z')), 60_000);
  assert.equal(msUntilNextDay(TZ, new Date('2026-10-29T15:00:00Z')), 86_400_000);
  assert.equal(msUntilNextDay(TZ, new Date('2026-10-29T03:00:00Z')), 12 * 3_600_000);
});

test('날짜 키를 검사하고 더해요', () => {
  assert.equal(isDayKey('2026-02-28'), true);
  assert.equal(isDayKey('2026-02-29'), false);
  assert.equal(isDayKey('2028-02-29'), true);
  assert.equal(isDayKey('2026-1-01'), false);
  assert.equal(isDayKey(20261029), false);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('달력용 날짜와 요일을 만들어요', () => {
  const feb = monthKeys(2028, 2);
  assert.equal(feb.length, 29);
  assert.equal(feb[0], '2028-02-01');
  assert.equal(feb.at(-1), '2028-02-29');
  assert.deepEqual(describeDay('2026-10-29'), { year: 2026, month: 10, day: 29, weekday: '목' });
});

test('그날의 빛깔은 날마다 다르고 탁한 연두색은 건너뛰어요', () => {
  const hues = Array.from({ length: 400 }, (_, i) => dayHue(addDays('2026-01-01', i)));
  for (const h of hues) {
    assert.ok(h >= 0 && h < 360);
    assert.ok(h < 112 || h >= 138, `연두 구간: ${h}`);
  }
  for (let i = 1; i < hues.length; i++) {
    const diff = Math.abs(hues[i] - hues[i - 1]);
    assert.ok(Math.min(diff, 360 - diff) > 25, `이웃한 날 색 차이가 너무 작아요: ${hues[i - 1]} → ${hues[i]}`);
  }
});
