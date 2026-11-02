/**
 * Sharing changes on an entry (spec §5.3, docs/ARCHITECTURE.md §7.2): the author shares or unshares; a leader
 * can only unshare, on their own entries too. Metadata only; no content.
 */
import { eq } from 'drizzle-orm';
import { ErrorCode, type Access } from '@diary/shared';
import type { AppContext } from '../context.js';
import { documents } from '../db/schema.js';
import { canOnDocument, documentView, DocumentAction, type Actor } from '../domain/authz/policy.js';
import { transitionAccess, type AccessEvent } from '../domain/diary/sharing.js';
import { forbidden, HttpError } from '../http-errors.js';

/**
 * Applies one sharing change and returns the new state. 404 if the actor can't see the entry, 403 if they may
 * not make this kind of change, 409 if the entry's state doesn't allow it (e.g. unsharing a private entry, or
 * sharing one a leader unshared before the author has updated it). The entry row is locked, so an author
 * sharing while a leader unshares can't leave the lock and the state disagreeing.
 */
export async function changeAccess(
  ctx: AppContext,
  actor: Actor,
  documentId: string,
  event: AccessEvent,
): Promise<Access> {
  return ctx.db.transaction(async (tx) => {
    const [doc] = await tx
      .select({
        ownerId: documents.ownerId,
        firstSubmittedAt: documents.firstSubmittedAt,
        access: documents.access,
        unsharedByLeaderAt: documents.unsharedByLeaderAt,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .for('update');
    if (!doc) throw new HttpError(404, ErrorCode.NotFound, 'No such entry');
    const facts = {
      ownerId: doc.ownerId,
      submitted: doc.firstSubmittedAt !== null,
      access: doc.access,
    };
    const view = documentView(actor, facts);
    if (view === null) throw new HttpError(404, ErrorCode.NotFound, 'No such entry');
    const action = event.kind === 'share' ? DocumentAction.Share : DocumentAction.Unshare;
    if (!canOnDocument(actor, action, facts)) throw forbidden();

    // A leader unsharing their own entry acts as its author, so nothing stops them sharing it again.
    const party = view === 'owner' ? 'owner' : 'leader';
    const result = transitionAccess(
      { ...facts, unsharedByLeader: doc.unsharedByLeaderAt !== null },
      event,
      party,
    );
    if (!result.ok) {
      if (result.reason === 'not_submitted') {
        throw new HttpError(409, ErrorCode.NotSubmitted, 'Only a submitted entry can be shared');
      }
      if (result.reason === 'unshared_by_leader') {
        throw new HttpError(
          409,
          ErrorCode.UnsharedByLeader,
          'A leader stopped sharing this entry; update it to share it again',
        );
      }
      throw new HttpError(
        409,
        ErrorCode.InvalidTransition,
        `Can't ${event.kind} from ${doc.access}`,
        {
          access: doc.access,
        },
      );
    }
    const now = ctx.clock();
    await tx
      .update(documents)
      .set({
        access: result.next,
        accessDecidedBy: actor.id,
        accessDecidedAt: now,
        ...(result.unsharedByLeader ? { unsharedByLeaderAt: now } : {}),
      })
      .where(eq(documents.id, documentId));
    return result.next;
  });
}
