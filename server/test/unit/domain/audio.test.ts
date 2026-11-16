/** Voice-note formats are decided by the file's first bytes, not the client's Content-Type (D35). */
import { describe, expect, it } from 'vitest';
import { audioMimeOf } from '../../../src/domain/diary/audio.js';

// The first bytes of real files: the app's recordings (LAME at 48 kHz, and at 24 kHz, an MPEG-2 rate) and
// an MP3 from ffmpeg, which starts with an ID3 tag.
const APP_48K = Buffer.from('fffb38c4', 'hex');
const APP_24K = Buffer.from('fff364c4', 'hex');
const ID3 = Buffer.from('494433040000000000', 'hex');

describe('audioMimeOf', () => {
  it.each([
    ['the app’s recording', APP_48K],
    ['an MPEG-2 rate recording', APP_24K],
    ['an MP3 with an ID3 tag', ID3],
  ])('recognises %s as MP3', (_name, file) => {
    expect(audioMimeOf(Buffer.concat([file, Buffer.alloc(64)]))).toBe('audio/mpeg');
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    // The browsers' own formats, no longer accepted: the app always sends MP3.
    ['an MP4', Buffer.from('00000020667479704d344120', 'hex')],
    ['a WebM', Buffer.from('1a45dfa39f4286810142f7810142f2', 'hex')],
    ['a JPEG', Buffer.from('ffd8ffe000104a4649460001', 'hex')],
    ['an AAC (ADTS) stream, sync bits but layer 00', Buffer.from('fff15080', 'hex')],
    ['HTML labelled as audio', Buffer.from('<html><script>')],
    ['a truncated frame header', APP_48K.subarray(0, 2)],
  ])('refuses %s', (_name, file) => {
    expect(audioMimeOf(file)).toBeNull();
  });
});
