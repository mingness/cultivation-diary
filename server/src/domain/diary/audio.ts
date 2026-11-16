/**
 * Recognising a voice note's format from its first bytes (D35). The request's Content-Type is the client's
 * claim; the stored type, which is what the player is told, comes from here. The app records MP3 in every
 * browser, so MP3 is the only format accepted.
 */
import type { AudioMime } from '@diary/shared';

/**
 * `audio/mpeg` for an MP3: an ID3 tag first (most encoders' files), or an MPEG Layer III frame header (11 sync
 * bits, then layer bits 01), which is how the app's own recordings start. Null for anything else.
 */
export function audioMimeOf(file: Buffer): AudioMime | null {
  if (file.length >= 10 && file.toString('latin1', 0, 3) === 'ID3') return 'audio/mpeg';
  const [first = 0, second = 0] = file;
  if (file.length >= 4 && first === 0xff && (second & 0xe6) === 0xe2) return 'audio/mpeg';
  return null;
}
