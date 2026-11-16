/**
 * Leaders' colours (D36): the server numbers leaders in the order they were added, and each number picks one
 * of the `--leader-*` tokens, so a leader's name and writing keep one colour everywhere. Colour is never the
 * only sign: the name still says 導師.
 */
import type { CSSProperties } from 'react';

/** How many `--leader-*` tokens tokens.css defines; a seventh leader shares the first one's colour. */
export const LEADER_COLOURS = 6;

/** Sets `--who` to the leader's colour for the element and what's inside it; nothing for a non-leader. */
export function leaderStyle(colour: number | null): CSSProperties | undefined {
  if (colour === null) return undefined;
  return { '--who': `var(--leader-${colour % LEADER_COLOURS})` } as CSSProperties;
}
