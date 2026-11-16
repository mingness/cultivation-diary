/** Leaders' voice notes on their own entries (D35, docs/ARCHITECTURE.md §8.14) against a real database. */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AdminDocumentList,
  DAILY_LIMITS,
  ENTRY_LIMITS,
  EntryView,
  ErrorBody,
  MeResponse,
  MyDocumentList,
  OwnAudioNote,
  OwnDocument,
  type Role,
} from '@diary/shared';
import { alerts, users } from '../../src/db/schema.js';
import { addAudio } from '../../src/services/diary/audio.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  login,
  MINUTE,
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
async function person(role: Role) {
  const username = `v${++n}x${Date.now() % 10000}`;
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role,
    profile: EMPTY_PROFILE,
  });
  return { ...(await login(t.app, username)), id: user.id, username, role };
}

type Who = Pick<Signin, 'cookie' | 'csrf'>;
const MONTH = '2026-10';

/** A recording's first bytes (an MP3 frame header, as the app records) followed by noise. */
const mp3 = (bytes = 2_000) => Buffer.concat([Buffer.from('fffb38c4', 'hex'), randomBytes(bytes)]);

const upload = (
  who: Who,
  id: string,
  file: Buffer | string,
  durationMs: number | string = 30_000,
) =>
  t.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/audio?durationMs=${durationMs}`,
    headers: {
      ...as(who),
      'content-type': typeof file === 'string' ? 'application/json' : 'audio/mpeg',
    },
    payload: file,
  });
const play = (who: Who, id: string, audioId: string) =>
  t.app.inject({ method: 'GET', url: `/api/documents/${id}/audio/${audioId}`, headers: as(who) });
const remove = (who: Who, id: string, audioId: string) =>
  t.app.inject({
    method: 'DELETE',
    url: `/api/documents/${id}/audio/${audioId}`,
    headers: as(who),
  });
const create = async (who: Who, title = 'entry') =>
  OwnDocument.parse(
    (
      await t.app.inject({
        method: 'POST',
        url: '/api/documents',
        headers: as(who),
        payload: { title, body: '<p>text</p>' },
      })
    ).json(),
  );
const submit = (who: Who, id: string, body = '<p>text</p>', title = 'entry') =>
  t.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/submit`,
    headers: as(who),
    payload: { title, body },
  });
const share = (who: Who, id: string) =>
  t.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/access`,
    headers: as(who),
    payload: { action: 'share', scope: 'course' },
  });
const unshare = (who: Who, id: string) =>
  t.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/access`,
    headers: as(who),
    payload: { action: 'unshare' },
  });
const read = async (who: Who, id: string) =>
  EntryView.parse(
    (await t.app.inject({ method: 'GET', url: `/api/documents/${id}`, headers: as(who) })).json(),
  );
const heard = async (who: Who, id: string) => (await read(who, id)).audio.map((a) => a.id);
const note = (res: { json: () => unknown }) => OwnAudioNote.parse(res.json());
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json());

describe('a note is part of the entry (D35)', () => {
  it('goes out with 提交/更新, is removed by one, and reaches exactly the entry’s readers', async () => {
    const leader = await person('COURSE_LEADER');
    const otherLeader = await person('COURSE_LEADER');
    const student = await person('NORMAL_USER');
    const { id } = await create(leader);

    // Recorded before the first 提交: only the owner has it.
    const first = mp3();
    const a = note(await upload(leader, id, first, 95_000));
    expect(a).toMatchObject({ durationMs: 95_000, pending: 'add' });
    expect((await play(otherLeader, id, a.id)).statusCode).toBe(404);

    // 提交: other leaders hear it, byte for byte, never cached. The student can't, until it is shared.
    expect((await submit(leader, id)).statusCode).toBe(200);
    expect(await read(leader, id)).toMatchObject({ audio: [{ id: a.id, pending: null }] });
    const played = await play(otherLeader, id, a.id);
    expect(played.statusCode).toBe(200);
    expect(played.headers['content-type']).toBe('audio/mpeg');
    expect(played.headers['cache-control']).toBe('no-store');
    expect(played.rawPayload.equals(first)).toBe(true);
    expect((await play(student, id, a.id)).statusCode).toBe(404);
    expect((await share(leader, id)).statusCode).toBe(200);
    expect(await heard(student, id)).toEqual([a.id]);
    expect((await play(student, id, a.id)).statusCode).toBe(200);

    // A second note and the first one's removal both wait for 更新, like changed text. (Notes are listed
    // oldest first; the test clock stands still unless moved.)
    t.clock.advance(MINUTE);
    const b = note(await upload(leader, id, mp3()));
    expect((await remove(leader, id, a.id)).statusCode).toBe(200);
    expect(await read(leader, id)).toMatchObject({
      state: 'submitted_with_draft',
      audio: [
        { id: a.id, pending: 'remove' },
        { id: b.id, pending: 'add' },
      ],
    });
    const mine = MyDocumentList.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/documents/mine?month=${MONTH}`,
          headers: as(leader),
        })
      ).json(),
    );
    expect(mine.documents.find((d) => d.id === id)?.state).toBe('submitted_with_draft');
    expect(await heard(student, id)).toEqual([a.id]);
    expect(await heard(otherLeader, id)).toEqual([a.id]);
    expect((await play(student, id, b.id)).statusCode).toBe(404);

    // 更新 with the same text applies them; history keeps text only, so no version is added.
    const updated = OwnDocument.parse((await submit(leader, id)).json());
    expect(updated.state).toBe('submitted');
    expect(await heard(student, id)).toEqual([b.id]);
    expect((await play(student, id, a.id)).statusCode).toBe(404);
    const versions = await t.app.inject({
      method: 'GET',
      url: `/api/documents/${id}/versions`,
      headers: as(leader),
    });
    expect(versions.json().versions).toEqual([]);
  });

  it('an 更新 that only changes voice notes counts as an update and lifts a leader’s unshare', async () => {
    const leader = await person('COURSE_LEADER');
    const otherLeader = await person('COURSE_LEADER');
    const { id } = await create(leader);
    await submit(leader, id);
    await share(leader, id);
    expect((await unshare(otherLeader, id)).statusCode).toBe(200);
    expect(code(await share(leader, id)).code).toBe('unshared_by_leader');

    // An unchanged 更新 doesn't lift it; one that adds a note does.
    await submit(leader, id);
    expect(code(await share(leader, id)).code).toBe('unshared_by_leader');
    await upload(leader, id, mp3());
    await submit(leader, id);
    expect((await share(leader, id)).statusCode).toBe(200);
  });

  it('counts towards the owner’s storage and shows as a pending change in the admin list', async () => {
    const leader = await person('COURSE_LEADER');
    const storage = async () =>
      MeResponse.parse(
        (await t.app.inject({ method: 'GET', url: '/api/me', headers: as(leader) })).json(),
      ).user.storageBytes;
    const { id } = await create(leader);
    await submit(leader, id);
    const before = await storage();
    await upload(leader, id, mp3(50_000));
    expect((await storage()) - before).toBeGreaterThan(50_000);

    const admin = await signedInAdmin(t);
    const list = AdminDocumentList.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/api/admin/documents?username=${leader.username}`,
          headers: as(admin),
        })
      ).json(),
    );
    expect(list.documents.map((d) => d.state)).toEqual(['submitted_with_draft']);
  });
});

describe('who may record, remove and play', () => {
  it('only a leader on their own entry records; others are refused without learning more', async () => {
    const leader = await person('COURSE_LEADER');
    const otherLeader = await person('COURSE_LEADER');
    const student = await person('NORMAL_USER');
    const admin = await signedInAdmin(t);
    const own = await create(student);
    const leaders = await create(leader);

    // Students can't, even on their own entry.
    expect(code(await upload(student, own.id, mp3())).code).toBe('forbidden');
    // Another leader's entry: invisible before 提交, read-only after.
    expect((await upload(otherLeader, leaders.id, mp3())).statusCode).toBe(404);
    await submit(leader, leaders.id);
    await share(leader, leaders.id);
    expect((await upload(otherLeader, leaders.id, mp3())).statusCode).toBe(403);
    expect((await upload(student, leaders.id, mp3())).statusCode).toBe(403);
    expect((await upload(admin, leaders.id, mp3())).statusCode).toBe(403);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: `/api/documents/${leaders.id}/audio?durationMs=1000`,
          headers: { 'content-type': 'audio/mpeg' },
          payload: mp3(),
        })
      ).statusCode,
    ).toBe(401);

    // Removing is the owner's alone; playing follows reading.
    const a = note(await upload(leader, leaders.id, mp3()));
    await submit(leader, leaders.id);
    expect((await remove(otherLeader, leaders.id, a.id)).statusCode).toBe(403);
    expect((await remove(student, leaders.id, a.id)).statusCode).toBe(403);
    expect((await play(admin, leaders.id, a.id)).statusCode).toBe(403);
    // A note can't be fetched through another entry's address.
    expect((await play(student, own.id, a.id)).statusCode).toBe(404);
  });

  it('a leader made a NORMAL_USER keeps their notes and may remove them, but not add more', async () => {
    const leader = await person('COURSE_LEADER');
    const { id } = await create(leader);
    const a = note(await upload(leader, id, mp3()));
    await t.ctx.db.update(users).set({ role: 'NORMAL_USER' }).where(eq(users.id, leader.id));
    expect((await play(leader, id, a.id)).statusCode).toBe(200);
    expect((await upload(leader, id, mp3())).statusCode).toBe(403);
    expect((await remove(leader, id, a.id)).statusCode).toBe(200);
  });
});

describe('what is accepted (§8.14)', () => {
  it('refuses what isn’t an MP3, an oversized one, or a length outside 1 ms–2 min', async () => {
    const leader = await person('COURSE_LEADER');
    const { id } = await create(leader);
    expect(
      code(await upload(leader, id, Buffer.from('<html><script>alert(1)</script>'))).code,
    ).toBe('validation_failed');
    expect(code(await upload(leader, id, '{"not":"audio"}')).code).toBe('validation_failed');
    // A browser's own WebM recording, sent as if it were MP3: the bytes decide.
    const webm = Buffer.concat([Buffer.from('1a45dfa3', 'hex'), randomBytes(500)]);
    expect(code(await upload(leader, id, webm)).code).toBe('validation_failed');
    expect((await upload(leader, id, mp3(ENTRY_LIMITS.audioBytes))).statusCode).toBe(413);
    expect((await upload(leader, id, mp3(), ENTRY_LIMITS.audioMs + 1)).statusCode).toBe(400);
    expect((await upload(leader, id, mp3(), 0)).statusCode).toBe(400);
    const ok = await upload(leader, id, mp3(), ENTRY_LIMITS.audioMs);
    expect(ok.statusCode).toBe(201);
  });

  it(`holds ${ENTRY_LIMITS.audioNotes} notes per entry, counting what the next 更新 leaves`, async () => {
    const leader = await person('COURSE_LEADER');
    const { id } = await create(leader);
    const notes = [];
    for (let i = 0; i < ENTRY_LIMITS.audioNotes; i++)
      notes.push(note(await upload(leader, id, mp3())));
    const refused = await upload(leader, id, mp3());
    expect(code(refused)).toMatchObject({
      code: 'limit_reached',
      details: { limit: 'audioNotes' },
    });
    // A note marked for removal no longer counts, though readers hear it until 更新.
    await submit(leader, id);
    await remove(leader, id, notes[0]!.id);
    expect((await upload(leader, id, mp3())).statusCode).toBe(201);
    expect((await upload(leader, id, mp3())).statusCode).toBe(409);
  });

  it('simultaneous uploads never take an entry past its cap', async () => {
    const leader = await person('COURSE_LEADER');
    const actor = { id: leader.id, role: leader.role };
    for (let round = 0; round < 5; round++) {
      const { id } = await create(leader, `race ${round}`);
      for (let i = 0; i < ENTRY_LIMITS.audioNotes - 2; i++)
        await addAudio(t.ctx, actor, id, mp3(), 1000);
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => addAudio(t.ctx, actor, id, mp3(), 1000)),
      );
      expect(
        results.filter((r) => r.status === 'fulfilled'),
        `round ${round}`,
      ).toHaveLength(2);
      expect((await read(leader, id)).audio).toHaveLength(ENTRY_LIMITS.audioNotes);
    }
  });

  it(`allows ${DAILY_LIMITS.audio} uploads a day, re-recordings included; the cap flags the account`, async () => {
    const leader = await person('COURSE_LEADER');
    const { id } = await create(leader);
    for (let i = 0; i < DAILY_LIMITS.audio; i++) {
      const res = await upload(leader, id, mp3(100));
      expect(res.statusCode, `upload ${i + 1}`).toBe(201);
      await remove(leader, id, note(res).id);
    }
    const refused = await upload(leader, id, mp3(100));
    expect(code(refused)).toMatchObject({ code: 'limit_reached', details: { limit: 'audio' } });
    const flags = await t.ctx.db.select().from(alerts).where(eq(alerts.userId, leader.id));
    expect(flags.map((a) => a.rule).sort()).toEqual(['elevated_activity', 'limit_reached']);
  });
});
