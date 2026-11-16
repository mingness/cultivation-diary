/**
 * Back to "only me" (D37): the author takes a sent entry back until someone else has sent a comment on it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorBody, LeaderEntryView, OpenDocumentList, OwnerEntryView } from '@diary/shared';
import { saveMyComment } from '../../src/services/diary/comments.js';
import { withdrawDocument } from '../../src/services/diary/documents.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
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
async function person(role: 'NORMAL_USER' | 'COURSE_LEADER' = 'NORMAL_USER') {
  const username = `w${++n}x${Date.now() % 10000}`;
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role,
    profile: { ...EMPTY_PROFILE, familyName: '周', givenName: `${n}` },
  });
  return { ...(await login(t.app, username, TEST_PASSWORD)), id: user.id, username, role };
}
type Who = Pick<Signin, 'cookie' | 'csrf'>;

const call = (who: Who | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: who ? as(who) : {}, ...(payload ? { payload } : {}) });
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;
const withdraw = (who: Who | null, id: string) =>
  call(who, 'POST', `/api/documents/${id}/withdraw`);
const own = async (who: Who, id: string) =>
  OwnerEntryView.parse((await call(who, 'GET', `/api/documents/${id}`)).json());
const comment = (leader: Who, id: string, state: 'draft' | 'submitted', body = '<p>c</p>') =>
  call(leader, 'PUT', `/api/documents/${id}/comments/mine`, { body, state });

async function sent(owner: Who, title: string, body = '<p>sent</p>'): Promise<string> {
  const { id } = (await call(owner, 'POST', '/api/documents', { title, body })).json();
  expect(
    (await call(owner, 'POST', `/api/documents/${id}/submit`, { title, body })).statusCode,
  ).toBe(200);
  return id;
}

describe('taking an entry back (D37)', () => {
  it('hides it from leaders and the class, and keeps the newest writing as the draft', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const id = await sent(owner, 'sent title', '<p>sent text</p>');
    await call(owner, 'POST', `/api/documents/${id}/access`, { action: 'share', scope: 'course' });
    await call(owner, 'PUT', `/api/documents/${id}/draft`, {
      title: 'newer title',
      body: '<p>newer text</p>',
    });

    const res = await withdraw(owner, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      state: 'draft',
      access: 'private',
      pinned: false,
      submitted: null,
      draft: { title: 'newer title', body: '<p>newer text</p>' },
    });
    expect((await call(leader, 'GET', `/api/documents/${id}`)).statusCode).toBe(404);
    const reader = await person();
    expect((await call(reader, 'GET', `/api/documents/${id}`)).statusCode).toBe(404);
    const month = t.clock.now().toISOString().slice(0, 7);
    const open = OpenDocumentList.parse(
      (await call(reader, 'GET', `/api/documents/open?month=${month}`)).json(),
    );
    expect(open.documents.map((d) => d.id)).not.toContain(id);

    // With no pending draft, what was sent becomes the draft; sending it again works as a first 提交.
    const second = await sent(owner, 'plain', '<p>plain text</p>');
    expect((await withdraw(owner, second)).json()).toMatchObject({
      draft: { title: 'plain', body: '<p>plain text</p>' },
    });
    await call(owner, 'POST', `/api/documents/${second}/submit`, {
      title: 'plain',
      body: '<p>plain text</p>',
    });
    expect(
      LeaderEntryView.parse((await call(leader, 'GET', `/api/documents/${second}`)).json()).body,
    ).toBe('<p>plain text</p>');
  });

  it('is refused once someone else has sent a comment, but not for a draft comment or one’s own', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const commented = await sent(owner, 'commented');
    await comment(leader, commented, 'submitted');
    const refused = await withdraw(owner, commented);
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe('has_comments');
    expect((await own(owner, commented)).state).toBe('submitted');

    // A draft comment stays with its leader and comes back when the entry is sent again.
    const drafted = await sent(owner, 'drafted');
    await comment(leader, drafted, 'draft', '<p>still thinking</p>');
    expect((await withdraw(owner, drafted)).statusCode).toBe(200);
    await call(owner, 'POST', `/api/documents/${drafted}/submit`, {
      title: 'drafted',
      body: '<p>x</p>',
    });
    const back = LeaderEntryView.parse(
      (await call(leader, 'GET', `/api/documents/${drafted}`)).json(),
    );
    expect(back.myComment).toMatchObject({ state: 'draft', body: '<p>still thinking</p>' });

    // A leader's own comment on their own entry is no conversation.
    const leadersOwn = await sent(leader, 'leader’s own');
    await comment(leader, leadersOwn, 'submitted');
    expect((await withdraw(leader, leadersOwn)).statusCode).toBe(200);
  });

  it('only the author takes it back, and only once it was sent', async () => {
    const owner = await person();
    const id = await sent(owner, 'mine');
    const leader = await person('COURSE_LEADER');
    const other = await person();
    const admin = await signedInAdmin(t);
    expect((await withdraw(leader, id)).statusCode).toBe(404);
    expect((await withdraw(other, id)).statusCode).toBe(404);
    expect((await withdraw(admin, id)).statusCode).toBe(403);
    expect((await withdraw(null, id)).statusCode).toBe(401);
    const draft = (await call(owner, 'POST', '/api/documents', { title: 'd', body: '' })).json().id;
    expect(code(await withdraw(owner, draft))).toBe('invalid_transition');
  });

  it('turns voice notes back into pending additions, and drops those waiting to be removed', async () => {
    const leader = await person('COURSE_LEADER');
    const { id } = (
      await call(leader, 'POST', '/api/documents', { title: 'v', body: '<p>v</p>' })
    ).json();
    const upload = () =>
      t.app.inject({
        method: 'POST',
        url: `/api/documents/${id}/audio?durationMs=1000`,
        headers: { ...as(leader), 'content-type': 'audio/mpeg' },
        payload: Buffer.concat([Buffer.from('fffb38c4', 'hex'), randomBytes(2_000)]),
      });
    const kept = (await upload()).json().id;
    const removed = (await upload()).json().id;
    await call(leader, 'POST', `/api/documents/${id}/submit`, { title: 'v', body: '<p>v</p>' });
    await t.app.inject({
      method: 'DELETE',
      url: `/api/documents/${id}/audio/${removed}`,
      headers: as(leader),
    });

    await withdraw(leader, id);
    expect((await own(leader, id)).audio.map((a) => [a.id, a.pending])).toEqual([[kept, 'add']]);
  });

  it('a comment sent at the same moment either lands first and blocks it, or finds the entry gone', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    for (let round = 0; round < 5; round++) {
      const id = await sent(owner, `race ${round}`);
      const [taken, commented] = await Promise.allSettled([
        withdrawDocument(t.ctx, owner.id, id),
        saveMyComment(t.ctx, { id: leader.id, role: 'COURSE_LEADER' }, id, {
          body: '<p>c</p>',
          state: 'submitted',
        }),
      ]);
      // Exactly one wins; never a comment on an entry its leader can no longer see.
      expect([taken.status, commented.status].sort(), `round ${round}`).toEqual([
        'fulfilled',
        'rejected',
      ]);
    }
  });
});
