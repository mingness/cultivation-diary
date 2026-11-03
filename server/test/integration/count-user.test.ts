/**
 * The mantra-only account (D30): a COUNT_USER reaches 報數 and its own account, and every other API route
 * refuses it. Routes are discovered from the API's own OpenAPI document, so a new diary, leader, translate or
 * admin route that forgets its capability guard fails here without anyone remembering to add it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_DOCS_PATH } from '../../src/app.js';
import { changeAccess } from '../../src/services/sharing.js';
import { createDocument, submitDocument } from '../../src/services/diary/documents.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  login,
  TEST_PASSWORD,
  type Signin,
  type TestApp,
} from '../helpers/app.js';

/** What a COUNT_USER may call: signing in and out, its own account, and 報數. */
const ALLOWED_PREFIXES = ['/api/auth/', '/api/me', '/api/count'];

let t: TestApp;
let countUser: Signin;
let ownerId: string;
let documentId: string;

beforeAll(async () => {
  t = await createTestApp();
  const owner = await createUser(t.ctx, {
    username: 'cu_owner',
    password: TEST_PASSWORD,
    role: 'NORMAL_USER',
    profile: EMPTY_PROFILE,
  });
  await createUser(t.ctx, {
    username: 'cu_mantra',
    password: TEST_PASSWORD,
    role: 'COUNT_USER',
    profile: EMPTY_PROFILE,
  });
  ownerId = owner.id;
  // A shared entry: the case where "every signed-in user" used to include everyone.
  const { document } = await createDocument(t.ctx, ownerId, { title: 'shared', body: '' });
  documentId = document.id;
  await submitDocument(t.ctx, ownerId, documentId, { title: 'shared', body: '<p>text</p>' });
  await changeAccess(t.ctx, owner, documentId, { kind: 'share', scope: 'course' });
  countUser = await login(t.app, 'cu_mantra');
});
afterAll(async () => {
  await t?.close();
});

describe('COUNT_USER', () => {
  it('reports and sees 報數, and has its account', async () => {
    const report = await t.app.inject({
      method: 'POST',
      url: '/api/count',
      headers: as(countUser),
      payload: { count: 108 },
    });
    expect(report.statusCode).toBe(201);
    const summary = await t.app.inject({
      method: 'GET',
      url: '/api/count/summary',
      headers: as(countUser),
    });
    expect(summary.statusCode).toBe(200);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: as(countUser) });
    expect(me.json().user.role).toBe('COUNT_USER');
  });

  it('is refused every other API route, a shared entry included', async () => {
    const spec = (await t.app.inject({ method: 'GET', url: `${API_DOCS_PATH}/json` })).json() as {
      paths: Record<string, Record<string, unknown>>;
    };
    const calls: { method: string; url: string }[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (!path.startsWith('/api/') || ALLOWED_PREFIXES.some((p) => path.startsWith(p))) continue;
      // The shared entry's ID for document routes, the owner's for user routes: real rows, so a missing
      // guard would answer 200 rather than an incidental 404.
      const url = path.replace(/\{(\w+)\}/g, (_, name: string) =>
        /user/i.test(name) ? ownerId : documentId,
      );
      for (const method of Object.keys(methods)) calls.push({ method: method.toUpperCase(), url });
    }

    for (const { method, url } of calls) {
      const res = await t.app.inject({
        method: method as 'GET',
        url,
        headers: as(countUser),
        ...(method === 'GET' ? {} : { payload: {} }),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    // Guard against a vacuous pass: the diary, leader, translate and admin routes were all there.
    for (const area of ['/api/documents', '/api/leader', '/api/translate', '/api/admin']) {
      expect(
        calls.some((c) => c.url.startsWith(area)),
        area,
      ).toBe(true);
    }
  });
});
