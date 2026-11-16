import { describe, expect, it } from 'vitest';
import { isPhone, type MeResponse } from '@diary/shared';
import { ApiError } from '../src/api/client.js';
import { sessionFromMe } from '../src/api/session.js';
import { parseAppearance } from '../src/lib/appearance.js';
import { shouldRetry } from '../src/lib/query.js';
import { secretFromUri } from '../src/screens/auth/EnrolScreen.js';

describe('parseAppearance', () => {
  it('keeps valid cached values and replaces anything else with the defaults', () => {
    expect(parseAppearance('22', 'dark')).toEqual({ fontSize: 22, theme: 'dark' });
    expect(parseAppearance('19', 'blue')).toEqual({ fontSize: 18, theme: 'system' });
    expect(parseAppearance(null, null)).toEqual({ fontSize: 18, theme: 'system' });
  });
});

describe('shouldRetry', () => {
  it('retries network and server failures twice, and never a 4xx answer', () => {
    expect(shouldRetry(0, new ApiError(0, 'network_error', null))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'not_ready', null))).toBe(true);
    expect(shouldRetry(2, new ApiError(503, 'not_ready', null))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, 'not_found', null))).toBe(false);
    expect(shouldRetry(0, new ApiError(429, 'rate_limited', null))).toBe(false);
  });
});

describe('sessionFromMe', () => {
  const me = (role: MeResponse['user']['role'], totpEnabled: boolean): MeResponse => ({
    user: {
      id: '00000000-0000-4000-8000-000000000000',
      username: 'u',
      role,
      fontSize: 18,
      theme: 'system',
      email: null,
      profile: { familyName: '', givenName: '', address: '', phone: '', photo: null },
      totpEnabled,
      storageBytes: 0,
      leaderColour: null,
    },
    features: { translation: false },
    csrfToken: 't',
  });

  it('holds a SYS_ADMIN without an authenticator at setup; others may go without one', () => {
    expect(sessionFromMe(me('SYS_ADMIN', false)).status).toBe('enrol');
    expect(sessionFromMe(me('SYS_ADMIN', true)).status).toBe('ready');
    expect(sessionFromMe(me('COURSE_LEADER', false)).status).toBe('ready');
  });
});

describe('isPhone (spec §4.2)', () => {
  it.each([
    ['+61 412 345 678', true],
    ['0412-345-678', true],
    ['+852 9123 4567', true],
    ['13812345678', true],
    ['123456', true],
    ['12345', false], // fewer than 6 digits
    ['+1 234 567 890 123 456 789 01', false], // more than 20 digits
    ['412 345 678 ext 2', false],
    ['++61 412 345 678', false],
    ['(07) 5555 1234', true],
    ['+61 (7) 5555 1234', true],
    ['412 345 678 ', false], // the schema trims first; the rule itself doesn't
  ])('%s → %s', (value, expected) => {
    expect(isPhone(value)).toBe(expected);
  });
});

describe('secretFromUri', () => {
  it('reads the key from an otpauth link, and gives nothing for a malformed one', () => {
    expect(secretFromUri('otpauth://totp/Diary:admin?secret=JBSWY3DPEHPK3PXP&issuer=Diary')).toBe(
      'JBSWY3DPEHPK3PXP',
    );
    expect(secretFromUri('not a uri')).toBe('');
  });
});
