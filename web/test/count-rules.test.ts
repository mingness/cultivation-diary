import { describe, expect, it } from 'vitest';
import { dateState, noticeKeys, parseGoal } from '../src/screens/count/countRules.js';

const mine = [
  { countDate: '2026-10-15', count: 30, manualReports: 2 },
  { countDate: '2026-10-14', count: 50, manualReports: 20 },
  { countDate: '2026-10-13', count: null, manualReports: 0 },
];

describe('dateState (spec §7.2)', () => {
  it('knows the number a new report would replace, and when the date has reached its 20 reports', () => {
    expect(dateState(mine, '2026-10-15')).toEqual({ existing: 30, atLimit: false });
    expect(dateState(mine, '2026-10-14')).toEqual({ existing: 50, atLimit: true });
    expect(dateState(mine, '2026-10-13')).toEqual({ existing: null, atLimit: false });
    expect(dateState([], '2026-10-12')).toEqual({ existing: null, atLimit: false });
  });
});

describe('noticeKeys', () => {
  it('keeps the order normalising reported', () => {
    expect(noticeKeys(['non_digits_removed', 'clamped_to_max'])).toEqual([
      'count.notice.non_digits_removed',
      'count.notice.clamped_to_max',
    ]);
  });
});

describe('parseGoal (spec §7.5)', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['10,000,000', 10_000_000],
    ['１０８', 108],
    ['1 000', 1000],
    ['1', 1],
    ['1000000000', 1_000_000_000],
  ])('reads %j as %j', (raw, goal) => expect(parseGoal(raw)).toBe(goal));

  it.each(['0', '1000000001', '99999999999999999999', '-5', '1e6', '十'])('refuses %j', (raw) =>
    expect(parseGoal(raw)).toBe('invalid'),
  );
});
