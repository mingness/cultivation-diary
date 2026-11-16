/**
 * Diary entries for their owner (spec §5). Every body is sanitised before it's stored, encrypted with the
 * entry's DEK, and bound to its place (content, draft, or version N) so ciphertexts can't be moved around.
 *
 * Writes that count toward a daily limit do so inside their transaction (usage.ts). Each function returns the
 * activity it caused, for the route to record after the transaction has committed.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  ENTRY_LIMITS,
  ErrorCode,
  MAX_VERSIONS,
  type ActivityKind,
  type OwnDocument,
} from '@diary/shared';
import type { AppContext } from '../../context.js';
import { comments, documentAudio, documents, documentVersions } from '../../db/schema.js';
import { openText, sealText } from '../../domain/crypto/aead.js';
import { fieldAad } from '../../domain/crypto/contexts.js';
import { beijingDate, monthDates } from '../../domain/count/schedule.js';
import { inspectBody, type InspectedBody } from '../../domain/diary/sanitize.js';
import { HttpError } from '../../http-errors.js';
import { applyPendingAudio, hasPendingAudio, pendingAudioExists } from './audio-pending.js';
import { documentKey, newDocumentKey } from './keys.js';
import { consumeDaily, LimitReachedError, type Elevated, type Tx } from './usage.js';

export type DocumentRow = typeof documents.$inferSelect;

export interface Written {
  readonly document: OwnDocument;
  /** What to record once the write has committed; null when nothing changed. */
  readonly activity: ActivityKind | null;
  /** A daily warning level this write reached, to flag once it has committed. */
  readonly elevated: Elevated | null;
}

export const notFound = () => new HttpError(404, ErrorCode.NotFound, 'No such entry');

/** Per-entry checks that apply to drafts and submissions alike. */
export function checkSize(body: InspectedBody): void {
  if (body.imageBytes.length > ENTRY_LIMITS.images) throw new LimitReachedError('images');
  if (body.imageBytes.some((b) => b > ENTRY_LIMITS.imageBytes)) {
    throw new HttpError(413, ErrorCode.TooLarge, 'An image is too large', {
      maxImageBytes: ENTRY_LIMITS.imageBytes,
    });
  }
  if (body.bodyBytes > ENTRY_LIMITS.bodyBytes) {
    throw new HttpError(413, ErrorCode.TooLarge, 'The entry is too large', {
      maxBodyBytes: ENTRY_LIMITS.bodyBytes,
    });
  }
}

function seal(dek: Buffer, html: string, aad: string) {
  const { ciphertext, nonce } = sealText(dek, html, aad);
  return { ct: ciphertext, nonce };
}

function stateOf(row: DocumentRow, pendingAudio: boolean): OwnDocument['state'] {
  if (!row.firstSubmittedAt) return 'draft';
  return row.draftCt || pendingAudio ? 'submitted_with_draft' : 'submitted';
}

/**
 * The owner's view of an entry row. `pendingAudio`: whether voice notes were added or removed since the last
 * submission (D35), which counts as a pending change like a text draft.
 */
export function toOwnDocument(
  ctx: AppContext,
  row: DocumentRow,
  pendingAudio: boolean,
): OwnDocument {
  const dek = documentKey(ctx, row.id, row.dekWrapped);
  const submitted =
    row.contentCt && row.contentNonce && row.lastSubmittedAt
      ? {
          title: row.title,
          body: openText(
            dek,
            { ciphertext: row.contentCt, nonce: row.contentNonce },
            fieldAad.documentContent(row.id),
          ),
          at: row.lastSubmittedAt.toISOString(),
        }
      : null;
  const draft =
    row.draftCt && row.draftNonce && row.draftSavedAt
      ? {
          title: row.draftTitle ?? row.title,
          body: openText(
            dek,
            { ciphertext: row.draftCt, nonce: row.draftNonce },
            fieldAad.documentDraft(row.id),
          ),
          savedAt: row.draftSavedAt.toISOString(),
        }
      : null;
  return {
    id: row.id,
    diaryDate: row.diaryDate,
    state: stateOf(row, pendingAudio),
    access: row.access,
    unsharedByLeader: row.unsharedByLeaderAt !== null,
    pinned: row.pinnedAt !== null,
    submitted,
    draft,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The owner's entry, locked for update; 404 for anyone else's, so existence isn't revealed. */
async function lockOwn(tx: Tx, ownerId: string, id: string): Promise<DocumentRow> {
  const [row] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
    .for('update');
  if (!row) throw notFound();
  return row;
}

/** Creates an entry dated today (Beijing), holding the first draft. Counts toward the daily create limit. */
export async function createDocument(
  ctx: AppContext,
  ownerId: string,
  input: { title: string; body: string },
): Promise<Written> {
  const body = inspectBody(input.body);
  checkSize(body);
  let elevated: Elevated | null = null;
  const row = await ctx.db.transaction(async (tx) => {
    elevated = await consumeDaily(tx, ctx, ownerId, 'create');
    const now = ctx.clock();
    const id = randomUUID();
    const { dek, dekWrapped, keyVersion } = newDocumentKey(ctx, id);
    const draft = seal(dek, body.html, fieldAad.documentDraft(id));
    const [inserted] = await tx
      .insert(documents)
      .values({
        id,
        ownerId,
        title: input.title,
        draftTitle: input.title,
        diaryDate: beijingDate(now),
        draftCt: draft.ct,
        draftNonce: draft.nonce,
        draftSavedAt: now,
        dekWrapped,
        keyVersion,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!inserted) throw new Error('insert returned no row');
    return inserted;
  });
  return { document: toOwnDocument(ctx, row, false), activity: 'entry_created', elevated };
}

/**
 * Saves the owner's working copy (暫存). Leaders keep seeing the last submission. A draft identical to what was
 * submitted clears the pending draft instead, so the entry doesn't look changed. Drafts may exceed the
 * character limit (nothing is ever lost at a limit), but not the photo limit.
 */
export async function saveDraft(
  ctx: AppContext,
  ownerId: string,
  id: string,
  input: { title: string; body: string },
): Promise<Written> {
  const body = inspectBody(input.body);
  checkSize(body);
  const row = await ctx.db.transaction(async (tx) => {
    const current = await lockOwn(tx, ownerId, id);
    const dek = documentKey(ctx, id, current.dekWrapped);
    const now = ctx.clock();
    const sameAsSubmitted =
      current.contentCt &&
      current.contentNonce &&
      input.title === current.title &&
      openText(
        dek,
        { ciphertext: current.contentCt, nonce: current.contentNonce },
        fieldAad.documentContent(id),
      ) === body.html;
    const draft = sameAsSubmitted ? null : seal(dek, body.html, fieldAad.documentDraft(id));
    const [updated] = await tx
      .update(documents)
      .set({
        draftTitle: draft ? input.title : null,
        draftCt: draft?.ct ?? null,
        draftNonce: draft?.nonce ?? null,
        draftSavedAt: draft ? now : null,
        // Before the first submission the title is the working title.
        ...(current.firstSubmittedAt ? {} : { title: input.title }),
        updatedAt: now,
      })
      .where(eq(documents.id, id))
      .returning();
    if (!updated) throw notFound();
    return { updated, pendingAudio: await hasPendingAudio(tx, id) };
  });
  return {
    document: toOwnDocument(ctx, row.updated, row.pendingAudio),
    activity: null,
    elevated: null,
  };
}

/**
 * 提交 the first time, 更新 afterwards (spec §5.2). An update archives the previously submitted body as a
 * history version, keeping the newest 3. Submitting exactly what's already submitted changes nothing and
 * counts nothing, so a double click is harmless.
 */
export async function submitDocument(
  ctx: AppContext,
  ownerId: string,
  id: string,
  input: { title: string; body: string },
): Promise<Written> {
  const body = inspectBody(input.body);
  checkSize(body);
  if (body.visibleChars > ENTRY_LIMITS.chars) throw new LimitReachedError('chars');

  let activity: ActivityKind | null = null;
  let elevated: Elevated | null = null;
  const row = await ctx.db.transaction(async (tx) => {
    const current = await lockOwn(tx, ownerId, id);
    const dek = documentKey(ctx, id, current.dekWrapped);
    const now = ctx.clock();
    const content = seal(dek, body.html, fieldAad.documentContent(id));
    const clearDraft = { draftTitle: null, draftCt: null, draftNonce: null, draftSavedAt: null };

    // Voice notes added or removed since the last submission (D35) are a change, like changed text.
    const audioChanged = await hasPendingAudio(tx, id);
    if (!current.firstSubmittedAt) {
      elevated = await consumeDaily(tx, ctx, ownerId, 'submit');
      activity = 'entry_submitted';
    } else {
      const previous = openText(
        dek,
        {
          ciphertext: current.contentCt ?? Buffer.alloc(0),
          nonce: current.contentNonce ?? Buffer.alloc(0),
        },
        fieldAad.documentContent(id),
      );
      const textChanged = previous !== body.html || current.title !== input.title;
      if (!textChanged && !audioChanged) {
        const [unchanged] = await tx
          .update(documents)
          .set(clearDraft)
          .where(eq(documents.id, id))
          .returning();
        return unchanged ?? current;
      }
      elevated = await consumeDaily(tx, ctx, ownerId, 'update');
      activity = 'entry_updated';
      // History keeps text only, so an update that changes only voice notes adds no version.
      if (textChanged) await archiveVersion(tx, id, dek, previous, now);
    }
    await applyPendingAudio(tx, id);

    const [updated] = await tx
      .update(documents)
      .set({
        title: input.title,
        contentCt: content.ct,
        contentNonce: content.nonce,
        firstSubmittedAt: current.firstSubmittedAt ?? now,
        lastSubmittedAt: now,
        // An update with a change (text or voice notes) is what a leader's unshare waits for (an unchanged
        // 更新 returned above).
        unsharedByLeaderAt: null,
        ...clearDraft,
        updatedAt: now,
      })
      .where(eq(documents.id, id))
      .returning();
    if (!updated) throw notFound();
    return updated;
  });
  // Every pending voice-note change was applied above, or there was none.
  return { document: toOwnDocument(ctx, row, false), activity, elevated };
}

/**
 * Takes a sent entry back to "only me" (D37): leaders and the class stop seeing it, and what was sent becomes
 * the owner's draft again (a pending draft, if there is one, wins, so no writing is lost). Refused with 409
 * has_comments once someone else has sent a comment: it is a conversation then. A leader's unsent comment
 * doesn't count; it stays with them, hidden, and returns if the entry is sent again. Sharing and a pin go;
 * voice notes become pending additions again, and those waiting to be removed are removed. History versions
 * stay with the entry. The entry row is locked, as comment writes lock it, so a comment can't slip in.
 */
export async function withdrawDocument(
  ctx: AppContext,
  ownerId: string,
  id: string,
): Promise<Written> {
  const row = await ctx.db.transaction(async (tx) => {
    const current = await lockOwn(tx, ownerId, id);
    if (!current.firstSubmittedAt || !current.contentCt || !current.contentNonce) {
      throw new HttpError(409, ErrorCode.InvalidTransition, 'Only a sent entry can be taken back');
    }
    const [comment] = await tx
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.documentId, id),
          eq(comments.state, 'submitted'),
          or(isNull(comments.authorId), ne(comments.authorId, ownerId)),
        ),
      )
      .limit(1);
    if (comment) {
      throw new HttpError(409, ErrorCode.HasComments, 'Someone has commented on this entry');
    }
    const dek = documentKey(ctx, id, current.dekWrapped);
    const now = ctx.clock();
    // Before the first 提交 an entry's text lives in the draft fields and `title` is the working title.
    const draft =
      current.draftCt && current.draftNonce
        ? { ct: current.draftCt, nonce: current.draftNonce }
        : seal(
            dek,
            openText(
              dek,
              { ciphertext: current.contentCt, nonce: current.contentNonce },
              fieldAad.documentContent(id),
            ),
            fieldAad.documentDraft(id),
          );
    const title = current.draftCt ? (current.draftTitle ?? current.title) : current.title;
    await tx
      .delete(documentAudio)
      .where(and(eq(documentAudio.documentId, id), eq(documentAudio.pending, 'remove')));
    await tx
      .update(documentAudio)
      .set({ pending: 'add' })
      .where(and(eq(documentAudio.documentId, id), isNull(documentAudio.pending)));
    const [updated] = await tx
      .update(documents)
      .set({
        title,
        draftTitle: title,
        draftCt: draft.ct,
        draftNonce: draft.nonce,
        draftSavedAt: current.draftSavedAt ?? now,
        contentCt: null,
        contentNonce: null,
        firstSubmittedAt: null,
        lastSubmittedAt: null,
        access: 'private',
        accessDecidedBy: ownerId,
        accessDecidedAt: now,
        pinnedAt: null,
        updatedAt: now,
      })
      .where(eq(documents.id, id))
      .returning();
    if (!updated) throw notFound();
    return updated;
  });
  return { document: toOwnDocument(ctx, row, false), activity: null, elevated: null };
}

/** Stores the outgoing body as the next version and drops all but the newest MAX_VERSIONS. */
async function archiveVersion(tx: Tx, documentId: string, dek: Buffer, html: string, now: Date) {
  const [last] = await tx
    .select({ no: sql<number>`coalesce(max(${documentVersions.versionNo}), 0)::int` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  const versionNo = (last?.no ?? 0) + 1;
  const sealed = seal(dek, html, fieldAad.documentVersion(documentId, versionNo));
  await tx.insert(documentVersions).values({
    id: randomUUID(),
    documentId,
    versionNo,
    contentCt: sealed.ct,
    contentNonce: sealed.nonce,
    createdAt: now,
  });
  await tx
    .delete(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        lt(documentVersions.versionNo, versionNo - MAX_VERSIONS + 1),
      ),
    );
}

/** The owner's entries for one Beijing month, newest first, with their comment counts (spec §6.1). */
export async function listOwnMonth(ctx: AppContext, ownerId: string, month: string) {
  const { first, next } = monthDates(month);
  const rows = await ctx.db
    .select({
      id: documents.id,
      title: sql<string>`coalesce(${documents.draftTitle}, ${documents.title})`,
      diaryDate: documents.diaryDate,
      firstSubmittedAt: documents.firstSubmittedAt,
      hasDraft: sql<boolean>`${documents.draftCt} IS NOT NULL OR ${pendingAudioExists}`,
      access: documents.access,
      commentCount: sql<number>`(count(${comments.id}) FILTER (WHERE ${comments.state} = 'submitted'))::int`,
      unseen: sql<number>`(count(${comments.id}) FILTER (WHERE ${comments.state} = 'submitted' AND ${comments.seenByOwnerAt} IS NULL))::int`,
    })
    .from(documents)
    .leftJoin(comments, eq(comments.documentId, documents.id))
    .where(
      and(
        eq(documents.ownerId, ownerId),
        gte(documents.diaryDate, first),
        lt(documents.diaryDate, next),
      ),
    )
    .groupBy(documents.id)
    .orderBy(desc(documents.diaryDate), desc(documents.createdAt));
  return {
    documents: rows.map((r) => ({
      id: r.id,
      title: r.title,
      diaryDate: r.diaryDate,
      state: !r.firstSubmittedAt
        ? ('draft' as const)
        : r.hasDraft
          ? ('submitted_with_draft' as const)
          : ('submitted' as const),
      access: r.access,
      commentCount: r.commentCount,
      hasUnseenComment: r.unseen > 0,
    })),
  };
}
