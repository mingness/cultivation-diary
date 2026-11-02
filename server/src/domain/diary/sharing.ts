/**
 * Sharing an entry, docs/ARCHITECTURE.md §7.2 and spec §5.3. The author decides; leaders don't approve
 * anything, but any leader can take an entry back to private:
 *
 *   owner:   private ──share(scope)──► scope         (refused while a leader's unshare stands)
 *   owner:   scope ──share(other scope)──► other scope
 *   either:  scope ──unshare──► private              (a leader's unshare stands until the next 更新)
 *
 * Only submitted entries can be shared. Who counts as owner or leader for a given entry is decided by the
 * authorisation policy (canOnDocument); this module only decides which changes each party may make from
 * which state.
 */
import type { Access, ShareScope } from '@diary/shared';

export type AccessEvent =
  { readonly kind: 'share'; readonly scope: ShareScope } | { readonly kind: 'unshare' };
export type Party = 'owner' | 'leader';

/** The facts about an entry that sharing depends on. */
export interface SharingFacts {
  readonly access: Access;
  readonly submitted: boolean;
  /** A leader unshared the entry and it hasn't been updated since. */
  readonly unsharedByLeader: boolean;
}

export type TransitionResult =
  | { readonly ok: true; readonly next: Access; readonly unsharedByLeader: boolean }
  | {
      readonly ok: false;
      readonly reason: 'not_submitted' | 'invalid_transition' | 'unshared_by_leader';
    };

export function transitionAccess(
  facts: SharingFacts,
  event: AccessEvent,
  party: Party,
): TransitionResult {
  if (!facts.submitted) return { ok: false, reason: 'not_submitted' };
  if (event.kind === 'share') {
    // Leaders don't publish other people's writing; that is the author's choice alone.
    if (party !== 'owner' || facts.access === event.scope) {
      return { ok: false, reason: 'invalid_transition' };
    }
    if (facts.unsharedByLeader) return { ok: false, reason: 'unshared_by_leader' };
    return { ok: true, next: event.scope, unsharedByLeader: false };
  }
  if (facts.access === 'private') return { ok: false, reason: 'invalid_transition' };
  // The author taking back their own entry leaves them free to share it again; a leader's decision holds
  // until the author changes the entry.
  return { ok: true, next: 'private', unsharedByLeader: party === 'leader' };
}
