/**
 * Pinned entries (D36): a leader pins their own shared entry to the top of 開放日記 for every month, until they
 * unpin it or it stops being shared. And the leader colours that set leaders' writing apart.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  ErrorBody,
  OpenDocumentList,
  OwnerEntryView,
  PIN_LIMITS,
  ReaderEntryView,
} from '@diary/shared';
import { users } from '../../src/db/schema.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { setPinned } from '../../src/services/sharing.js';
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

type Role = 'NORMAL_USER' | 'COURSE_LEADER' | 'COUNT_USER';
let n = 0;
async function person(role: Role = 'NORMAL_USER') {
  const username = `p${++n}x${Date.now() % 10000}`;
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role,
    profile: { ...EMPTY_PROFILE, familyName: '林', givenName: `${n}`, phone: '12345678' },
  });
  return { ...(await login(t.app, username, TEST_PASSWORD)), id: user.id, username, role };
}
type Who = Pick<Signin, 'cookie' | 'csrf'>;

const call = (who: Who | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: who ? as(who) : {}, ...(payload ? { payload } : {}) });
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;
const pin = (who: Who | null, id: string, pinned = true) =>
  call(who, 'PUT', `/api/documents/${id}/pin`, { pinned });
const open = async (who: Who, month: string) =>
  OpenDocumentList.parse((await call(who, 'GET', `/api/documents/open?month=${month}`)).json());
const month = () => t.clock.now().toISOString().slice(0, 7);

/** A submitted entry by `owner`, shared unless `share` is false. */
async function entry(owner: Who, title: string, share = true): Promise<string> {
  const { id } = (await call(owner, 'POST', '/api/documents', { title, body: '<p>x</p>' })).json();
  await call(owner, 'POST', `/api/documents/${id}/submit`, { title, body: '<p>x</p>' });
  if (share) {
    await call(owner, 'POST', `/api/documents/${id}/access`, { action: 'share', scope: 'course' });
  }
  return id;
}

describe('pinning (D36)', () => {
  it('puts a leader’s shared entry at the top of every month until they unpin it', async () => {
    const leader = await person('COURSE_LEADER');
    const id = await entry(leader, '共修通知');
    const thisMonth = month();
    expect((await pin(leader, id)).json()).toEqual({ pinned: true });

    // A month later the entry is out of the month's list but still pinned for everyone.
    t.clock.advance(40 * DAY);
    const student = await person();
    const author = await login(t.app, leader.username, TEST_PASSWORD); // the old session has expired
    const later = await open(student, month());
    expect(later.documents.map((d) => d.id)).not.toContain(id);
    expect(later.pinned).toMatchObject([{ id, title: '共修通知', pinned: true }]);
    // In its own month it is in both lists.
    const own = await open(student, thisMonth);
    expect(own.documents.find((d) => d.id === id)?.pinned).toBe(true);
    const mine = OwnerEntryView.parse((await call(author, 'GET', `/api/documents/${id}`)).json());
    expect(mine.pinned).toBe(true);

    expect((await pin(author, id, false)).json()).toEqual({ pinned: false });
    expect((await open(student, month())).pinned).toEqual([]);
  });

  it('only the author, a leader, pins; everyone else is refused', async () => {
    const leader = await person('COURSE_LEADER');
    const id = await entry(leader, 'mine to pin');
    const student = await person();
    const studentsOwn = await entry(student, 'a student’s');
    const otherLeader = await person('COURSE_LEADER');
    const admin = await signedInAdmin(t);
    const countUser = await person('COUNT_USER');

    expect((await pin(student, studentsOwn)).statusCode).toBe(403);
    expect((await pin(student, id)).statusCode).toBe(403);
    expect((await pin(otherLeader, id)).statusCode).toBe(403);
    expect((await pin(otherLeader, studentsOwn)).statusCode).toBe(403);
    expect((await pin(admin, id)).statusCode).toBe(403);
    expect((await pin(countUser, id)).statusCode).toBe(403);
    expect((await pin(null, id)).statusCode).toBe(401);
    // Someone else's private entry doesn't exist for a student.
    const privateOne = await entry(leader, 'private', false);
    expect((await pin(student, privateOne)).statusCode).toBe(404);

    // Unpinning is the author's too.
    await pin(leader, id);
    expect((await pin(otherLeader, id, false)).statusCode).toBe(403);
    expect((await open(student, month())).pinned.map((d) => d.id)).toContain(id);
  });

  it('a private entry can’t be pinned, and unsharing unpins for good', async () => {
    const leader = await person('COURSE_LEADER');
    const draft = (await call(leader, 'POST', '/api/documents', { title: 'd', body: '' })).json()
      .id;
    expect(code(await pin(leader, draft))).toBe('not_submitted');
    const privateOne = await entry(leader, 'private', false);
    expect(code(await pin(leader, privateOne))).toBe('invalid_transition');

    // Another leader stopping the sharing also takes the pin away; sharing again doesn't bring it back.
    const id = await entry(leader, 'pinned then unshared');
    await pin(leader, id);
    const otherLeader = await person('COURSE_LEADER');
    await call(otherLeader, 'POST', `/api/documents/${id}/access`, { action: 'unshare' });
    await call(leader, 'POST', `/api/documents/${id}/access`, { action: 'share', scope: 'course' });
    const student = await person();
    expect((await open(student, month())).pinned.map((d) => d.id)).not.toContain(id);
  });

  it(`a leader has at most ${PIN_LIMITS.perLeader} pinned at once`, async () => {
    const leader = await person('COURSE_LEADER');
    const ids: string[] = [];
    for (let i = 0; i <= PIN_LIMITS.perLeader; i++) ids.push(await entry(leader, `p${i}`));
    for (const id of ids.slice(0, PIN_LIMITS.perLeader)) await pin(leader, id);
    const refused = await pin(leader, ids[PIN_LIMITS.perLeader]!);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'limit_reached', details: { limit: 'pins' } });
    // Pinning a pinned entry again keeps it (a double tap), and unpinning frees a place.
    expect((await pin(leader, ids[0]!)).statusCode).toBe(200);
    await pin(leader, ids[0]!, false);
    expect((await pin(leader, ids[PIN_LIMITS.perLeader]!)).statusCode).toBe(200);
  });

  it('simultaneous pins never take a leader past the cap', async () => {
    for (let round = 0; round < 5; round++) {
      const leader = await person('COURSE_LEADER');
      const ids: string[] = [];
      for (let i = 0; i < PIN_LIMITS.perLeader + 2; i++) ids.push(await entry(leader, `r${i}`));
      const actor = { id: leader.id, role: 'COURSE_LEADER' as const };
      const results = await Promise.allSettled(ids.map((id) => setPinned(t.ctx, actor, id, true)));
      expect(
        results.filter((r) => r.status === 'fulfilled'),
        `round ${round}`,
      ).toHaveLength(PIN_LIMITS.perLeader);
    }
  });

  it('a leader made a student may unpin but not pin', async () => {
    const leader = await person('COURSE_LEADER');
    const a = await entry(leader, 'a');
    const b = await entry(leader, 'b');
    await pin(leader, a);
    await t.ctx.db.update(users).set({ role: 'NORMAL_USER' }).where(eq(users.id, leader.id));
    const again = await login(t.app, leader.username, TEST_PASSWORD);
    expect((await pin(again, b)).statusCode).toBe(403);
    expect((await pin(again, a, false)).json()).toEqual({ pinned: false });
  });
});

describe('leader colours', () => {
  it('number leaders in the order they were added, on their entries and comments; students get none', async () => {
    const first = await person('COURSE_LEADER');
    t.clock.advance(60_000);
    const second = await person('COURSE_LEADER');
    const student = await person();
    const id = await entry(student, 'with comments');
    for (const leader of [second, first]) {
      await call(leader, 'PUT', `/api/documents/${id}/comments/mine`, {
        body: '<p>c</p>',
        state: 'submitted',
      });
    }
    const leaderEntry = await entry(second, 'by a leader');

    const reader = await person();
    const seen = ReaderEntryView.parse((await call(reader, 'GET', `/api/documents/${id}`)).json());
    expect(seen.author.leaderColour).toBeNull();
    const [c1, c2] = seen.comments.map((c) => c.authorColour);
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    // `second` commented first and was added later, so has the higher number.
    expect(c1!).toBeGreaterThan(c2!);
    const rows = (await open(reader, month())).documents;
    expect(rows.find((d) => d.id === leaderEntry)?.author.leaderColour).toBe(c1);
  });
});
