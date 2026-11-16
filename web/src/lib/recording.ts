/**
 * Small pure helpers for voice notes (D35, FRONTEND.md §4.3–4.4): the m:ss clock shown by the recorder
 * and the players, and the length sent to the server.
 */
import { ENTRY_LIMITS } from '@diary/shared';

/** Whole seconds as m:ss. `up` rounds up, for a countdown that should reach 0:00 only at the very end. */
export function clock(ms: number, { up = false }: { up?: boolean } = {}): string {
  const total = Math.max(0, up ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A measured length as the server accepts it: at least 1 ms and never over the 2-minute cap. */
export function noteLength(ms: number): number {
  return Math.min(ENTRY_LIMITS.audioMs, Math.max(1, Math.round(ms)));
}

/**
 * A microphone's first second can be clicks and silence while the device starts up (measured 2026-11-16:
 * full-scale pops for about a second from a 16 kHz headset), so that much is thrown away before the recording
 * proper begins, and the start fades in so nothing left over clicks.
 */
export const WARM_UP_MS = 1000;
export const FADE_IN_MS = 20;

/**
 * The part of `chunk` to keep, given that `seen` samples arrived before it: nothing from the first `skip`
 * samples, then a linear fade over the next `fade`, then the samples unchanged.
 */
export function afterWarmUp(
  chunk: Float32Array,
  seen: number,
  skip: number,
  fade: number,
): Float32Array {
  const from = Math.max(0, skip - seen);
  if (from >= chunk.length) return new Float32Array(0);
  const kept = chunk.slice(from);
  const keptBefore = Math.max(0, seen - skip);
  for (let i = 0; i < kept.length && keptBefore + i < fade; i++) {
    kept[i] = (kept[i] ?? 0) * ((keptBefore + i) / fade);
  }
  return kept;
}
