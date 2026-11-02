/** Every state × event × party × lock combination of the sharing state machine (ARCHITECTURE.md §7.2). */
import { describe, expect, it } from 'vitest';
import type { Access } from '@diary/shared';
import {
  transitionAccess,
  type AccessEvent,
  type Party,
  type TransitionResult,
} from '../../../src/domain/diary/sharing.js';

const STATES: Access[] = ['private', 'course', 'everyone'];
const EVENTS: Record<string, AccessEvent> = {
  share: { kind: 'share', scope: 'course' },
  unshare: { kind: 'unshare' },
};
const PARTIES: Party[] = ['owner', 'leader'];

// The only allowed transitions, written out by hand: "state/event/party/locked" → result. Anything missing
// is invalid_transition.
const ALLOWED: Record<string, TransitionResult> = {
  'private/share/owner/false': { ok: true, next: 'course', unsharedByLeader: false },
  'private/share/owner/true': { ok: false, reason: 'unshared_by_leader' },
  'everyone/share/owner/false': { ok: true, next: 'course', unsharedByLeader: false },
  'everyone/share/owner/true': { ok: false, reason: 'unshared_by_leader' },
  'course/unshare/owner/false': { ok: true, next: 'private', unsharedByLeader: false },
  'course/unshare/leader/false': { ok: true, next: 'private', unsharedByLeader: true },
  'everyone/unshare/owner/false': { ok: true, next: 'private', unsharedByLeader: false },
  'everyone/unshare/leader/false': { ok: true, next: 'private', unsharedByLeader: true },
  // A shared entry can't be locked, but if one were, unsharing must still work.
  'course/unshare/owner/true': { ok: true, next: 'private', unsharedByLeader: false },
  'course/unshare/leader/true': { ok: true, next: 'private', unsharedByLeader: true },
  'everyone/unshare/owner/true': { ok: true, next: 'private', unsharedByLeader: false },
  'everyone/unshare/leader/true': { ok: true, next: 'private', unsharedByLeader: true },
};

const cases = STATES.flatMap((state) =>
  Object.keys(EVENTS).flatMap((event) =>
    PARTIES.flatMap((party) =>
      [false, true].map((locked) => [state, event, party, locked] as const),
    ),
  ),
);

describe('transitionAccess for submitted entries', () => {
  it.each(cases)('%s + %s by %s (locked=%s)', (state, event, party, locked) => {
    const result = transitionAccess(
      { access: state, submitted: true, unsharedByLeader: locked },
      EVENTS[event]!,
      party,
    );
    expect(result).toEqual(
      ALLOWED[`${state}/${event}/${party}/${locked}`] ?? {
        ok: false,
        reason: 'invalid_transition',
      },
    );
  });
});

describe('transitionAccess for never-submitted entries', () => {
  it.each(cases)('%s + %s by %s is refused as not_submitted', (state, event, party, locked) => {
    expect(
      transitionAccess(
        { access: state, submitted: false, unsharedByLeader: locked },
        EVENTS[event]!,
        party,
      ),
    ).toEqual({ ok: false, reason: 'not_submitted' });
  });
});
