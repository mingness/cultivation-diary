import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.js';
import { errorKey, format, switchOptions, type MessageKey } from '../src/i18n/messages.js';
import { vi } from '../src/i18n/vi.js';
import { zhHant } from '../src/i18n/zh-Hant.js';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('string tables', () => {
  // The type check guarantees the same keys; this catches a translation that drops or renames a placeholder,
  // which would show "{id}" to the user in one language only.
  it('use the same placeholders in every language', () => {
    for (const key of Object.keys(zhHant) as MessageKey[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(zhHant[key]));
      expect(placeholders(vi[key]), key).toEqual(placeholders(zhHant[key]));
    }
  });
});

describe('switchOptions', () => {
  // A language waiting for review must not appear for everyone, yet a reviewer previewing it must be able to
  // switch away to compare and come back.
  it('offers the offered languages, plus the one in use and the previewed one', () => {
    const offered = ['zh-Hant', 'en'] as const;
    expect(switchOptions('en', null, offered)).toEqual(['zh-Hant', 'en']);
    expect(switchOptions('vi', null, offered)).toEqual(['zh-Hant', 'en', 'vi']);
    expect(switchOptions('en', 'vi', offered)).toEqual(['zh-Hant', 'en', 'vi']);
    expect(switchOptions('vi', 'vi', [...offered, 'vi'])).toEqual(['zh-Hant', 'en', 'vi']);
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones as written', () => {
    expect(format(zhHant, 'common.errorRef', { id: 'abc123' })).toBe('錯誤代碼：abc123');
    expect(format(en, 'common.errorRef')).toBe('Error ref: {id}');
  });
});

describe('errorKey', () => {
  it('maps known codes and treats unknown ones as a server error', () => {
    expect(errorKey('captcha_failed')).toBe('error.captcha_failed');
    expect(errorKey('something_new')).toBe('error.internal_error');
  });
});
