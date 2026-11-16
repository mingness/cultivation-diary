/** The command-line tool's operations: first admin, recovery, and the development seed. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { MAX_VERSIONS } from '@diary/shared';
import { users } from '../../src/db/schema.js';
import { currentTotpCode, generateTotpSecret } from '../../src/domain/auth/totp.js';
import {
  AdminToolError,
  createSysadmin,
  resetTotp,
  setPassword,
} from '../../src/services/admin-tools.js';
import { seed, SEED_PASSWORD, SEED_USERS } from '../../src/services/seed.js';
import { createContext } from '../../src/context.js';
import { findUserByUsername } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  login,
  MINUTE,
  TEST_PASSWORD,
  testConfig,
  type TestApp,
} from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe('create-sysadmin', () => {
  it('refuses a wrong authenticator code and creates nothing', async () => {
    await expect(
      createSysadmin(t.ctx, {
        username: 'root1',
        password: TEST_PASSWORD,
        totpSecret: generateTotpSecret(),
        totpCode: '000000',
      }),
    ).rejects.toThrow(AdminToolError);
    expect(await findUserByUsername(t.ctx, 'root1')).toBeNull();
  });

  it('creates an admin who signs in with password and authenticator', async () => {
    const secret = generateTotpSecret();
    await createSysadmin(t.ctx, {
      username: 'root2',
      password: TEST_PASSWORD,
      totpSecret: secret,
      totpCode: currentTotpCode(secret, t.clock.now()),
    });
    t.clock.advance(MINUTE);
    const signin = await login(t.app, 'root2');
    expect(signin.res.json().status).toBe('totp_required');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/totp',
      headers: as(signin),
      payload: { code: currentTotpCode(secret, t.clock.now()) },
    });
    expect(res.json().status).toBe('ok');
  });

  it('refuses an existing username', async () => {
    const secret = generateTotpSecret();
    await expect(
      createSysadmin(t.ctx, {
        username: 'ROOT2',
        password: TEST_PASSWORD,
        totpSecret: secret,
        totpCode: currentTotpCode(secret, t.clock.now()),
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('recovery', () => {
  it('reset-totp makes the admin set up a new authenticator at next sign-in', async () => {
    await resetTotp(t.ctx, 'root2');
    expect((await login(t.app, 'root2')).res.json().status).toBe('totp_enrolment_required');
  });

  it('set-password replaces the password, unlocks the account and signs out old sessions', async () => {
    const signin = await login(t.app, 'root2');
    await setPassword(t.ctx, 'root2', 'a brand new password');
    const old = await t.app.inject({ method: 'GET', url: '/api/me', headers: as(signin) });
    expect(old.statusCode).toBe(401);
    expect((await login(t.app, 'root2')).res.statusCode).toBe(401);
    expect((await login(t.app, 'root2', 'a brand new password')).res.statusCode).toBe(200);
  });

  it('report unknown users clearly', async () => {
    await expect(resetTotp(t.ctx, 'nobody-here')).rejects.toThrow(/No user called/);
    await expect(setPassword(t.ctx, 'nobody-here', 'whatever123')).rejects.toThrow(/No user/);
  });
});

describe('seed', () => {
  it('refuses to run in production', async () => {
    const prodCtx = createContext(testConfig({ NODE_ENV: 'production' }), t.ctx.db);
    await expect(seed(prodCtx, { reset: true })).rejects.toThrow(/production/);
  });

  it('refuses a database that already has users, unless asked to reset', async () => {
    await expect(seed(t.ctx, { reset: false })).rejects.toThrow(/--reset/);
  });

  it('loads every role, admins with authenticators, and one locked account', async () => {
    const result = await seed(t.ctx, { reset: true });
    const [{ n } = { n: 0 }] = await t.ctx.db.select({ n: sql<number>`count(*)::int` }).from(users);
    // One leader is deleted after commenting.
    expect(n).toBe(SEED_USERS.length - 1);
    expect(result.voiceNotes).toBe(true);
    expect(result.users.filter((u) => u.role === 'SYS_ADMIN').every((u) => u.totpSecret)).toBe(
      true,
    );

    expect((await login(t.app, 'student.full', SEED_PASSWORD)).res.json().status).toBe('ok');
    expect((await login(t.app, 'leader.voice', SEED_PASSWORD)).res.json().user.role).toBe(
      'COURSE_LEADER',
    );
    expect((await login(t.app, 'student.exleader', SEED_PASSWORD)).res.json().user.role).toBe(
      'NORMAL_USER',
    );
    expect((await login(t.app, 'student.locked', SEED_PASSWORD)).res.statusCode).toBe(401);
    expect((await login(t.app, 'leader.departed', SEED_PASSWORD)).res.statusCode).toBe(401);
    expect((await login(t.app, 'admin.main', SEED_PASSWORD)).res.json().status).toBe(
      'totp_required',
    );
  });
});

describe('seed entries (spec §11)', () => {
  it('include every state the acceptance checklist asks for, encrypted like real entries', async () => {
    const { rows } = await t.testDb.database.pool.query<{
      state: string;
      access: string;
      n: number;
    }>(`
      SELECT CASE WHEN first_submitted_at IS NULL THEN 'draft'
                  WHEN draft_ct IS NOT NULL THEN 'submitted_with_draft'
                  ELSE 'submitted' END AS state,
             access::text AS access, count(*)::int AS n
        FROM documents GROUP BY 1, 2`);
    const count = (state: string | null, access: string | null) =>
      rows
        .filter(
          (r) => (state === null || r.state === state) && (access === null || r.access === access),
        )
        .reduce((sum, r) => sum + r.n, 0);
    expect(count(null, 'course')).toBeGreaterThanOrEqual(3);
    const { rows: unshared } = await t.testDb.database.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM documents WHERE unshared_by_leader_at IS NOT NULL',
    );
    expect(unshared[0]!.n).toBe(1);
    expect(count('draft', null)).toBeGreaterThanOrEqual(1);
    expect(count('submitted_with_draft', null)).toBeGreaterThanOrEqual(1);
    // An entry with more updates than history keeps (spec §5.2).
    const { rows: versions } = await t.testDb.database.pool.query<{ n: number }>(
      'SELECT max(c)::int AS n FROM (SELECT count(*) AS c FROM document_versions GROUP BY document_id) v',
    );
    expect(versions[0]!.n).toBe(MAX_VERSIONS);
    // Leaders may keep a diary too (D19).
    const { rows: leaderEntries } = await t.testDb.database.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM documents d JOIN users u ON u.id = d.owner_id WHERE u.role = 'COURSE_LEADER'`,
    );
    expect(leaderEntries[0]!.n).toBeGreaterThanOrEqual(1);
    // Voice notes (D35) in every state, and one kept by a leader who is now a NORMAL_USER.
    const { rows: notes } = await t.testDb.database.pool.query<{ pending: string; role: string }>(
      `SELECT coalesce(a.pending::text, 'submitted') AS pending, u.role::text AS role
         FROM document_audio a JOIN documents d ON d.id = a.document_id JOIN users u ON u.id = d.owner_id`,
    );
    expect(new Set(notes.map((r) => r.pending))).toEqual(new Set(['submitted', 'add', 'remove']));
    expect(notes.some((r) => r.role === 'NORMAL_USER')).toBe(true);
    const { rows: dump } = await t.testDb.database.pool.query<{ text: string }>(
      "SELECT string_agg(row_to_json(d)::text, '') AS text FROM documents d",
    );
    // Comments in draft and submitted state, from different leaders (spec §11).
    const { rows: seeded } = await t.testDb.database.pool.query<{ state: string; authors: number }>(
      'SELECT state::text, count(DISTINCT author_id)::int AS authors FROM comments GROUP BY state',
    );
    expect(Object.fromEntries(seeded.map((r) => [r.state, r.authors]))).toEqual({
      draft: 2,
      submitted: 2,
    });
    // A deleted leader's submitted comment stays, without an author (D18).
    const { rows: former } = await t.testDb.database.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM comments WHERE author_id IS NULL AND state = 'submitted'",
    );
    expect(former[0]!.n).toBe(1);
    // Titles are plaintext by design (spec §3); bodies never are. 計數器 appears only in a seeded body.
    expect(dump[0]!.text).not.toContain('計數器');
  });
});
