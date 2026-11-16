/** Voice-note formats are decided by the file's first bytes, not the client's Content-Type (D35). */
import { describe, expect, it } from 'vitest';
import { audioMimeOf } from '../../../src/domain/diary/audio.js';

// The first bytes of real recordings: Safari/Chrome MP4 (`ftypM4A ` / `ftypiso5`) and Chrome/Firefox WebM.
const MP4_SAFARI = Buffer.from('00000020667479704d344120', 'hex');
const MP4_CHROME = Buffer.from('0000001c6674797069736f35', 'hex');
const WEBM = Buffer.from('1a45dfa39f4286810142f7810142f2', 'hex');

describe('audioMimeOf', () => {
  it.each([
    ['Safari MP4', MP4_SAFARI, 'audio/mp4'],
    ['Chrome MP4', MP4_CHROME, 'audio/mp4'],
    ['WebM', WEBM, 'audio/webm'],
  ])('recognises %s', (_name, file, mime) => {
    expect(audioMimeOf(Buffer.concat([file, Buffer.alloc(64)]))).toBe(mime);
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['a JPEG', Buffer.from('ffd8ffe000104a4649460001', 'hex')],
    ['an Ogg file', Buffer.from('4f67675300020000000000000000', 'hex')],
    ['HTML labelled as audio', Buffer.from('<html><script>')],
    ['a truncated MP4 header', MP4_SAFARI.subarray(0, 7)],
  ])('refuses %s', (_name, file) => {
    expect(audioMimeOf(file)).toBeNull();
  });
});
