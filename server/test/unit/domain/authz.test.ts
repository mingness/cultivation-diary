/**
 * Exhaustive permission tests. The expected results below are written out by hand from
 * docs/ARCHITECTURE.md §7, independently of the implementation, and every combination is checked.
 */
import { describe, expect, it } from 'vitest';
import { canChangeRole, type Access } from '@diary/shared';
import {
  canOnDocument,
  Capability,
  documentView,
  DocumentAction,
  hasCapability,
  type Actor,
  type DocumentFacts,
  type DocumentView,
} from '../../../src/domain/authz/policy.js';

const OWNER_ID = 'owner';
const ACTORS = {
  owner: { id: OWNER_ID, role: 'NORMAL_USER' },
  ownerLeader: { id: OWNER_ID, role: 'COURSE_LEADER' },
  otherUser: { id: 'someone-else', role: 'NORMAL_USER' },
  otherLeader: { id: 'a-leader', role: 'COURSE_LEADER' },
  sysAdmin: { id: 'an-admin', role: 'SYS_ADMIN' },
  countUser: { id: 'a-mantra-user', role: 'COUNT_USER' },
} as const satisfies Record<string, Actor>;
type ActorName = keyof typeof ACTORS;

const ACCESS: readonly Access[] = ['private', 'course', 'everyone'];
const doc = (submitted: boolean, access: Access): DocumentFacts => ({
  ownerId: OWNER_ID,
  submitted,
  access,
});

describe('documentView', () => {
  // [actor, submitted, access, expected view]
  const expected: [ActorName, boolean, Access, DocumentView | null][] = [];
  for (const access of ACCESS) {
    for (const submitted of [false, true]) {
      expected.push(['owner', submitted, access, 'owner']);
      expected.push(['ownerLeader', submitted, access, 'owner']);
      expected.push(['sysAdmin', submitted, access, 'metadata']);
      expected.push(['otherLeader', submitted, access, submitted ? 'leader' : null]);
      expected.push([
        'otherUser',
        submitted,
        access,
        submitted && access !== 'private' ? 'reader' : null,
      ]);
      // Shared entries reach diary members only (D30).
      expected.push(['countUser', submitted, access, null]);
    }
  }

  it.each(expected)('%s, submitted=%s, %s → %s', (actor, submitted, access, view) => {
    expect(documentView(ACTORS[actor], doc(submitted, access))).toBe(view);
  });
});

describe('canOnDocument', () => {
  const A = DocumentAction;
  // Who may perform each action, by [actor kind][submitted]. Access state doesn't change WHO may act.
  const allowed: Record<
    DocumentAction,
    Record<ActorName, [notSubmitted: boolean, submitted: boolean]>
  > = {
    [A.Edit]: {
      owner: [true, true],
      ownerLeader: [true, true],
      otherUser: [false, false],
      otherLeader: [false, false],
      sysAdmin: [false, false],
      countUser: [false, false],
    },
    [A.Share]: {
      owner: [true, true],
      ownerLeader: [true, true],
      otherUser: [false, false],
      otherLeader: [false, false],
      sysAdmin: [false, false],
      countUser: [false, false],
    },
    [A.ReadVersions]: {
      owner: [true, true],
      ownerLeader: [true, true],
      otherUser: [false, false],
      otherLeader: [false, true],
      sysAdmin: [false, false],
      countUser: [false, false],
    },
    [A.Unshare]: {
      owner: [true, true],
      ownerLeader: [true, true],
      otherUser: [false, false],
      otherLeader: [false, true],
      sysAdmin: [false, false],
      countUser: [false, false],
    },
    [A.Comment]: {
      owner: [false, false],
      ownerLeader: [false, true],
      otherUser: [false, false],
      otherLeader: [false, true],
      sysAdmin: [false, false],
      countUser: [false, false],
    },
    [A.Delete]: {
      owner: [false, false],
      ownerLeader: [false, false],
      otherUser: [false, false],
      otherLeader: [false, false],
      sysAdmin: [true, true],
      countUser: [false, false],
    },
  };

  const cases: [DocumentAction, ActorName, boolean, Access, boolean][] = [];
  for (const [action, byActor] of Object.entries(allowed) as [
    DocumentAction,
    (typeof allowed)[DocumentAction],
  ][]) {
    for (const [actor, [whenDraft, whenSubmitted]] of Object.entries(byActor) as [
      ActorName,
      [boolean, boolean],
    ][]) {
      for (const access of ACCESS) {
        cases.push([action, actor, false, access, whenDraft]);
        cases.push([action, actor, true, access, whenSubmitted]);
      }
    }
  }

  it('the table covers every action', () => {
    expect(Object.keys(allowed).sort()).toEqual(Object.values(DocumentAction).sort());
  });

  it.each(cases)('%s by %s (submitted=%s, %s) → %s', (action, actor, submitted, access, result) => {
    expect(canOnDocument(ACTORS[actor], action, doc(submitted, access))).toBe(result);
  });

  it('denies unknown actions (default deny)', () => {
    expect(canOnDocument(ACTORS.owner, 'publish' as DocumentAction, doc(true, 'course'))).toBe(
      false,
    );
  });

  it('a SYS_ADMIN who somehow owns an entry still gets no owner powers', () => {
    const adminOwned = { ...doc(true, 'private'), ownerId: ACTORS.sysAdmin.id };
    expect(canOnDocument(ACTORS.sysAdmin, A.Edit, adminOwned)).toBe(false);
    expect(documentView(ACTORS.sysAdmin, adminOwned)).toBe('metadata');
  });
});

// The rules the spec states about roles, rather than a copy of the grant table.
describe('role capabilities', () => {
  const C = Capability;
  const ROLES: Actor['role'][] = ['COUNT_USER', 'NORMAL_USER', 'COURSE_LEADER', 'SYS_ADMIN'];
  const rolesWith = (capability: Capability) =>
    ROLES.filter((role) => hasCapability({ id: 'x', role }, capability));

  it('SYS_ADMIN has no capability that can reach diary content', () => {
    for (const contentCapability of [
      C.WriteDiary,
      C.ReadOpenDiaries,
      C.LeaderReview,
      C.Translate,
    ]) {
      expect(hasCapability(ACTORS.sysAdmin, contentCapability)).toBe(false);
    }
  });

  it('COUNT_USER can take part in 報數 and nothing else', () => {
    const all = Object.values(C);
    expect(all.filter((c) => hasCapability(ACTORS.countUser, c))).toEqual([C.Count]);
  });

  it('only COURSE_LEADER can review', () => {
    expect(rolesWith(C.LeaderReview)).toEqual(['COURSE_LEADER']);
  });

  it.each([
    C.ManageUsers,
    C.ManagePasswordResets,
    C.ManageDocuments,
    C.ManageCount,
    C.ReviewActivity,
  ])('only SYS_ADMIN has %s', (capability) => {
    expect(rolesWith(capability)).toEqual(['SYS_ADMIN']);
  });

  it('every role can take part in 報數', () => {
    expect(rolesWith(C.Count)).toEqual(ROLES);
  });
});

describe('canChangeRole (roles only move up, D30)', () => {
  const ROLES = ['COUNT_USER', 'NORMAL_USER', 'COURSE_LEADER', 'SYS_ADMIN'] as const;
  // Only these two moves are refused: a diary member never becomes a COUNT_USER.
  const refused = new Set(['NORMAL_USER→COUNT_USER', 'COURSE_LEADER→COUNT_USER']);
  const cases = ROLES.flatMap((from) =>
    ROLES.map((to) => [from, to, !refused.has(`${from}→${to}`)] as const),
  );

  it.each(cases)('%s → %s: %s', (from, to, allowed) => {
    expect(canChangeRole(from, to)).toBe(allowed);
  });
});
