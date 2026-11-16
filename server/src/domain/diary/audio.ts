/**
 * Recognising a voice note's format from its first bytes (D35). The request's Content-Type is the client's
 * claim; the stored type, which is what the player is told, comes from here.
 */
import type { AudioMime } from '@diary/shared';

const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/** `audio/mp4` (an ISO BMFF `ftyp` box first) or `audio/webm` (an EBML header); null for anything else. */
export function audioMimeOf(file: Buffer): AudioMime | null {
  if (file.length >= 12 && file.toString('latin1', 4, 8) === 'ftyp') return 'audio/mp4';
  if (file.length >= 4 && file.subarray(0, 4).equals(EBML)) return 'audio/webm';
  return null;
}
