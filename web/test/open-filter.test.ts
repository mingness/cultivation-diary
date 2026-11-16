import { describe, expect, it } from 'vitest';
import type { OpenDocumentRow } from '../src/api/diary.js';
import {
  applyFilter,
  authorsOf,
  dayCounts,
  feedSections,
} from '../src/screens/diary/openFilter.js';

const row = (id: string, diaryDate: string, author: string, name = ''): OpenDocumentRow => ({
  id,
  title: id,
  diaryDate,
  author: { id: author, username: `u-${author}`, name, leaderColour: null },
  commentCount: 0,
  pinned: false,
});

const rows = [
  row('a', '2026-10-01', 'p1', '陳明德'),
  row('b', '2026-10-01', 'p2'),
  row('c', '2026-10-03', 'p1', '陳明德'),
];

describe('open diary filters', () => {
  it('count entries per day for the calendar', () => {
    expect(dayCounts(rows)).toEqual({ '2026-10-01': 2, '2026-10-03': 1 });
  });

  it('list authors with their counts, most first, the username standing in for a missing name', () => {
    expect(authorsOf(rows)).toEqual([
      { id: 'p1', name: '陳明德', entries: 2 },
      { id: 'p2', name: 'u-p2', entries: 1 },
    ]);
  });

  it('narrow by day, by author, or both', () => {
    const ids = (filter: Parameters<typeof applyFilter>[1]) =>
      applyFilter(rows, filter).map((r) => r.id);
    expect(ids({ date: null, user: null })).toEqual(['a', 'b', 'c']);
    expect(ids({ date: '2026-10-01', user: null })).toEqual(['a', 'b']);
    expect(ids({ date: null, user: 'p1' })).toEqual(['a', 'c']);
    expect(ids({ date: '2026-10-01', user: 'p1' })).toEqual(['a']);
  });

  it('put pinned entries on top without repeating them below, and drop the pinned section when filtered', () => {
    const pinned = [row('c', '2026-10-03', 'p1'), row('old', '2026-08-20', 'p1')];
    const ids = (filter: Parameters<typeof applyFilter>[1]) => {
      const s = feedSections(rows, pinned, filter);
      return { pinned: s.pinned.map((r) => r.id), rows: s.rows.map((r) => r.id) };
    };
    expect(ids({ date: null, user: null })).toEqual({ pinned: ['c', 'old'], rows: ['a', 'b'] });
    expect(ids({ date: null, user: 'p1' })).toEqual({ pinned: [], rows: ['a', 'c'] });
  });
});
