/**
 * What is recited, the goal and starting again (spec §7.5, D40) against a real database. Its own file, because a
 * restart changes every app-wide figure the other 報數 tests read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import {
  CountLatest,
  CountSettings,
  CountSummary,
  ErrorBody,
  SetRecitationResult,
  type Role,
  type SetRecitationRequest,
} from '@diary/shared';
import { countEntries, countRecitations } from '../../src/db/schema.js';
import { runAutoSubmit, setRecitation } from '../../src/services/count.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  DAY,
  login,
  signedInAdmin,
  TEST_PASSWORD,
  type Signin,
  type TestApp,
} from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

let n = 0;
/** Remembered devices, because these tests move the clock days ahead. */
async function signedIn(role: Exclude<Role, 'SYS_ADMIN'>) {
  const username = `rec${++n}x${Date.now() % 10000}`;
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role,
    profile: EMPTY_PROFILE,
  });
  return { ...(await login(t.app, username, TEST_PASSWORD, { remember: true })), id: user.id };
}
type Who = Pick<Signin, 'cookie' | 'csrf'>;

const call = (who: Who | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: who ? as(who) : {}, ...(payload ? { payload } : {}) });
const recite = (who: Who | null, body: SetRecitationRequest | Record<string, unknown>) =>
  call(who, 'PUT', '/api/count/recitation', body);
const report = (who: Who, count: number, countDate?: string) =>
  call(who, 'POST', '/api/count', { count, ...(countDate ? { countDate } : {}) });
const summary = async (who: Who) =>
  CountSummary.parse((await call(who, 'GET', '/api/count/summary')).json());
const settings = async (who: Who) =>
  CountSettings.parse((await call(who, 'GET', '/api/count/settings')).json());
const rows = () => t.ctx.db.select().from(countRecitations).orderBy(asc(countRecitations.startsOn));

// The test clock starts at 2026-10-14 10:00 in Beijing; each describe moves on to days of its own.
describe('who may change it', () => {
  it('COURSE_LEADERs and SYS_ADMINs may; students and anonymous callers may not', async () => {
    const body = { recitation: 'great_compassion_mantra', goal: 10_000_000, restart: false };
    expect((await recite(null, body)).statusCode).toBe(401);
    const student = await signedIn('NORMAL_USER');
    expect(ErrorBody.parse((await recite(student, body)).json()).code).toBe('forbidden');
    const leader = await signedIn('COURSE_LEADER');
    // Nothing differs from migration 0014's row, so nothing is written.
    expect((await recite(leader, body)).json()).toEqual({ changed: false, autoStopped: 0 });
    const admin = await signedInAdmin(t, { remember: true });
    expect((await recite(admin, { ...body, goal: null })).json()).toEqual({
      changed: true,
      autoStopped: 0,
    });
    expect((await summary(student)).goal).toBeNull();
  });

  it.each([
    // Only the keys in the code's list: the web app has no name in any language for anything else.
    [{ recitation: '大悲咒', goal: null, restart: false }],
    [{ recitation: '', goal: null, restart: false }],
    [{ recitation: 'great_compassion_mantra', goal: 0, restart: false }],
  ])('refuses %j', async (body) => {
    const leader = await signedIn('COURSE_LEADER');
    expect((await recite(leader, body)).statusCode).toBe(400);
  });
});

describe('starting again (spec §7.5)', () => {
  it('counts the page from today; earlier dates stay in the old round and nothing is deleted', async () => {
    t.clock.advance(DAY);
    const leader = await signedIn('COURSE_LEADER');
    const [early, late] = [await signedIn('NORMAL_USER'), await signedIn('NORMAL_USER')];
    const yesterday = (await summary(early)).countDates[1] ?? '';
    await report(early, 300, yesterday);
    await report(early, 100);
    const before = await summary(early);

    t.clock.advance(DAY);
    const today = (await summary(early)).today.date;
    const res = await recite(leader, { recitation: 'amitabha', goal: 1_000_000, restart: true });
    expect(SetRecitationResult.parse(res.json()).changed).toBe(true);
    await report(late, 500);
    // A report for a day before the restart belongs to the old round (spec §7.5).
    await report(early, 40, yesterday);

    const after = await summary(late);
    expect(after).toMatchObject({
      recitation: 'amitabha',
      total: 500,
      goal: 1_000_000,
      percent: 0.05,
      roundStartsOn: today,
    });
    const latest = CountLatest.parse((await call(late, 'GET', '/api/count/latest')).json()).rows;
    expect(latest.map((r) => r.userId)).toEqual([late.id]);
    expect(before.total).toBeGreaterThanOrEqual(400);
    const kept = await t.ctx.db
      .select()
      .from(countEntries)
      .where(eq(countEntries.userId, early.id));
    expect(kept).toHaveLength(3);
  });

  it('a change made today is corrected in place, and taking back a restart restores the total', async () => {
    t.clock.advance(DAY);
    const leader = await signedIn('COURSE_LEADER');
    const u = await signedIn('NORMAL_USER');
    await report(u, 7);
    const roundTotal = (await summary(u)).total;

    await recite(leader, { recitation: 'guanyin', goal: null, restart: true });
    expect((await summary(u)).total).toBe(7);
    await recite(leader, { recitation: 'guanyin', goal: 500, restart: false });
    const s = await summary(u);
    expect(s).toMatchObject({ recitation: 'guanyin', goal: 500, total: roundTotal });
    expect((await rows()).filter((r) => r.startsOn === s.today.date)).toHaveLength(1);
  });

  it('on a later day a change is a new setting, so earlier dates keep theirs', async () => {
    const leader = await signedIn('COURSE_LEADER');
    const before = await rows();
    t.clock.advance(DAY);
    // A new goal only: the round and its total carry on.
    const u = await signedIn('NORMAL_USER');
    const total = (await summary(u)).total;
    await recite(leader, { recitation: 'guanyin', goal: 800, restart: false });
    const after = await rows();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toMatchObject({ recitation: 'guanyin', goal: 800, restart: false });
    expect((await summary(u)).total).toBe(total);
  });

  it('two leaders saving at once on a new day leave one setting for it', async () => {
    const leader = await signedIn('COURSE_LEADER');
    for (let round = 0; round < 5; round++) {
      t.clock.advance(DAY);
      await Promise.all(
        (['amitabha', 'guanyin'] as const).map((recitation) =>
          setRecitation(t.ctx, leader.id, { recitation, goal: null, restart: false }),
        ),
      );
      const today = (await summary(leader)).today.date;
      expect((await rows()).filter((r) => r.startsOn === today)).toHaveLength(1);
    }
  });
});

describe('auto-submit when what is recited changes (spec §7.5)', () => {
  it('a new recitation switches everyone’s auto-submit off with a notice; a new goal does not', async () => {
    t.clock.advance(DAY);
    const leader = await signedIn('COURSE_LEADER');
    const u = await signedIn('NORMAL_USER');
    await call(u, 'PUT', '/api/count/settings', { autoSubmit: true, savedCount: 108 });
    const current = (await summary(u)).recitation;

    await recite(leader, { recitation: current, goal: 123, restart: false });
    expect(await settings(u)).toMatchObject({ autoSubmit: true, autoStopped: false });

    const res = SetRecitationResult.parse(
      (
        await recite(leader, { recitation: 'medicine_buddha_mantra', goal: 123, restart: false })
      ).json(),
    );
    expect(res.autoStopped).toBeGreaterThanOrEqual(1);
    expect(await settings(u)).toEqual({ autoSubmit: false, savedCount: 108, autoStopped: true });
    // The 02:00 job leaves them alone until they choose again.
    t.clock.advance(DAY);
    await runAutoSubmit(t.ctx);
    const autos = await t.ctx.db.select().from(countEntries).where(eq(countEntries.userId, u.id));
    expect(autos).toEqual([]);

    // Choosing either way clears the notice.
    await call(u, 'PUT', '/api/count/settings', { autoSubmit: false });
    expect((await settings(u)).autoStopped).toBe(false);
  });
});
