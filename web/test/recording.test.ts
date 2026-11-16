import { describe, expect, it } from 'vitest';
import { afterWarmUp, clock, noteLength } from '../src/lib/recording.js';

describe('voice-note helpers (D35)', () => {
  it('counts down to 0:00 only when the time is up, and shows lengths as m:ss', () => {
    expect(clock(120_000, { up: true })).toBe('2:00');
    expect(clock(119_001, { up: true })).toBe('2:00');
    expect(clock(400, { up: true })).toBe('0:01');
    expect(clock(0, { up: true })).toBe('0:00');
    expect(clock(-50, { up: true })).toBe('0:00');
    expect(clock(65_900)).toBe('1:05');
  });

  it('sends a length the server accepts, even when the stop came a moment late', () => {
    expect(noteLength(120_180)).toBe(120_000);
    expect(noteLength(0.2)).toBe(1);
    expect(noteLength(6_000.4)).toBe(6_000);
  });
});

describe('afterWarmUp', () => {
  const ones = (n: number) => new Float32Array(n).fill(1);

  it('drops the warm-up, even when it ends inside a chunk, then fades in across chunks', () => {
    // skip 4, fade 4: samples 0–3 dropped, 4–7 rise 0, ¼, ½, ¾, then 1.
    expect([...afterWarmUp(ones(3), 0, 4, 4)]).toEqual([]);
    expect([...afterWarmUp(ones(3), 3, 4, 4)]).toEqual([0, 0.25]);
    expect([...afterWarmUp(ones(3), 6, 4, 4)]).toEqual([0.5, 0.75, 1]);
    expect([...afterWarmUp(ones(2), 9, 4, 4)]).toEqual([1, 1]);
  });

  it('leaves the microphone’s own samples alone', () => {
    const chunk = ones(2);
    afterWarmUp(chunk, 4, 4, 4);
    expect([...chunk]).toEqual([1, 1]);
  });
});
