/**
 * Voice notes on a leader's own entry (D35, docs/ARCHITECTURE.md §8.14). A note is part of the entry like its
 * text: a new one waits (`pending = add`) and a removed one stays audible (`pending = remove`) until the next
 * 提交/更新 (documents.ts), so readers and other leaders only ever hear the submitted set. Recordings are
 * sealed with the entry's DEK and bound to their note, and never logged.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull, or } from 'drizzle-orm';
import {
  ENTRY_LIMITS,
  ErrorCode,
  type AudioMime,
  type AudioNote,
  type OwnAudioNote,
} from '@diary/shared';
import type { AppContext } from '../../context.js';
import { documentAudio, documents } from '../../db/schema.js';
import {
  canOnDocument,
  documentView,
  DocumentAction,
  type Actor,
} from '../../domain/authz/policy.js';
import { open, seal } from '../../domain/crypto/aead.js';
import { fieldAad } from '../../domain/crypto/contexts.js';
import { audioMimeOf } from '../../domain/diary/audio.js';
import { forbidden, HttpError } from '../../http-errors.js';
import { notFound, type DocumentRow } from './documents.js';
import { documentKey } from './keys.js';
import { consumeDaily, LimitReachedError, type Elevated, type Tx } from './usage.js';

type AudioRow = typeof documentAudio.$inferSelect;

const audioNotFound = () => new HttpError(404, ErrorCode.NotFound, 'No such voice note');

const factsOf = (row: DocumentRow) => ({
  ownerId: row.ownerId,
  submitted: row.firstSubmittedAt !== null,
  access: row.access,
});

/** Locks the entry, so uploads, removals and 提交/更新 on it happen one at a time (the cap counts rows). */
async function lockDocument(tx: Tx, id: string): Promise<DocumentRow> {
  const [row] = await tx.select().from(documents).where(eq(documents.id, id)).for('update');
  if (!row) throw notFound();
  return row;
}

/** In the owner's working set: what the entry will hold after the next 提交/更新. */
const inWorkingSet = or(isNull(documentAudio.pending), eq(documentAudio.pending, 'add'));
/** In the submitted entry: what readers and other leaders hear. */
const inSubmittedSet = or(isNull(documentAudio.pending), eq(documentAudio.pending, 'remove'));

function toOwnNote(
  row: Pick<AudioRow, 'id' | 'durationMs' | 'createdAt' | 'pending'>,
): OwnAudioNote {
  return {
    id: row.id,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    pending: row.pending,
  };
}

export interface AddedAudio {
  readonly note: OwnAudioNote;
  readonly activity: null;
  /** The daily upload warning level, when this upload is the one that reaches it. */
  readonly elevated: Elevated | null;
}

/**
 * Stores a new voice note on the leader's own entry, waiting for the next 提交/更新. 404 if the actor can't see
 * the entry, 403 unless they own it and are a COURSE_LEADER, 400 if it isn't MP4 or WebM audio, 413 if too
 * large, 409 at the per-entry or daily cap.
 */
export async function addAudio(
  ctx: AppContext,
  actor: Actor,
  documentId: string,
  file: Buffer,
  durationMs: number,
): Promise<AddedAudio> {
  if (file.length > ENTRY_LIMITS.audioBytes) {
    throw new HttpError(413, ErrorCode.TooLarge, 'The voice note is too large', {
      maxAudioBytes: ENTRY_LIMITS.audioBytes,
    });
  }
  const mime = audioMimeOf(file);
  let elevated: Elevated | null = null;
  const row = await ctx.db.transaction(async (tx) => {
    const doc = await lockDocument(tx, documentId);
    const facts = factsOf(doc);
    if (documentView(actor, facts) === null) throw notFound();
    if (!canOnDocument(actor, DocumentAction.RecordAudio, facts)) throw forbidden();
    // Checked after the permission, so a student learns nothing about formats.
    if (!mime) throw new HttpError(400, ErrorCode.ValidationFailed, 'Not an MP4 or WebM recording');
    const [held] = await tx
      .select({ n: count() })
      .from(documentAudio)
      .where(and(eq(documentAudio.documentId, documentId), inWorkingSet));
    if ((held?.n ?? 0) >= ENTRY_LIMITS.audioNotes) throw new LimitReachedError('audioNotes');
    elevated = await consumeDaily(tx, ctx, actor.id, 'audio');

    const id = randomUUID();
    const now = ctx.clock();
    const dek = documentKey(ctx, documentId, doc.dekWrapped);
    const sealed = seal(dek, file, fieldAad.documentAudio(documentId, id));
    const [inserted] = await tx
      .insert(documentAudio)
      .values({
        id,
        documentId,
        audioCt: sealed.ciphertext,
        audioNonce: sealed.nonce,
        mime,
        durationMs,
        bytes: file.length,
        pending: 'add',
        createdAt: now,
      })
      .returning();
    await tx.update(documents).set({ updatedAt: now }).where(eq(documents.id, documentId));
    if (!inserted) throw new Error('insert returned no row');
    return inserted;
  });
  return { note: toOwnNote(row), activity: null, elevated };
}

/**
 * Takes a voice note out of the owner's entry. One never submitted is deleted at once; a submitted one stays
 * audible to readers until the next 提交/更新. Removing one already marked for removal changes nothing.
 */
export async function removeAudio(
  ctx: AppContext,
  actor: Actor,
  documentId: string,
  audioId: string,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const doc = await lockDocument(tx, documentId);
    const facts = factsOf(doc);
    if (documentView(actor, facts) === null) throw notFound();
    if (!canOnDocument(actor, DocumentAction.Edit, facts)) throw forbidden();
    const [note] = await tx
      .select({ pending: documentAudio.pending })
      .from(documentAudio)
      .where(and(eq(documentAudio.id, audioId), eq(documentAudio.documentId, documentId)));
    if (!note) throw audioNotFound();
    if (note.pending === 'remove') return;
    if (note.pending === 'add') {
      await tx.delete(documentAudio).where(eq(documentAudio.id, audioId));
    } else {
      await tx
        .update(documentAudio)
        .set({ pending: 'remove' })
        .where(eq(documentAudio.id, audioId));
    }
    await tx.update(documents).set({ updatedAt: ctx.clock() }).where(eq(documents.id, documentId));
  });
}

/**
 * One recording, for whoever may read the entry (§7.1): the owner any of their notes, everyone else only the
 * submitted entry's. 404 otherwise, so a pending note's existence isn't revealed.
 */
export async function playAudio(
  ctx: AppContext,
  actor: Actor,
  documentId: string,
  audioId: string,
): Promise<{ mime: AudioMime; file: Buffer }> {
  const [doc] = await ctx.db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw notFound();
  const view = documentView(actor, factsOf(doc));
  if (view === null || view === 'metadata') throw notFound();
  const [note] = await ctx.db
    .select()
    .from(documentAudio)
    .where(
      and(
        eq(documentAudio.id, audioId),
        eq(documentAudio.documentId, documentId),
        ...(view === 'owner' ? [] : [inSubmittedSet]),
      ),
    );
  if (!note) throw audioNotFound();
  const dek = documentKey(ctx, documentId, doc.dekWrapped);
  const file = open(
    dek,
    { ciphertext: note.audioCt, nonce: note.audioNonce },
    fieldAad.documentAudio(documentId, audioId),
  );
  return { mime: note.mime, file };
}

/** The owner's notes, oldest first, with what the next 提交/更新 does to each. */
export async function ownAudioNotes(ctx: AppContext, documentId: string): Promise<OwnAudioNote[]> {
  const rows = await ctx.db
    .select({
      id: documentAudio.id,
      durationMs: documentAudio.durationMs,
      createdAt: documentAudio.createdAt,
      pending: documentAudio.pending,
    })
    .from(documentAudio)
    .where(eq(documentAudio.documentId, documentId))
    .orderBy(asc(documentAudio.createdAt), asc(documentAudio.id));
  return rows.map(toOwnNote);
}

/** The submitted entry's notes, oldest first: what a leader or reader hears. */
export async function submittedAudioNotes(
  ctx: AppContext,
  documentId: string,
): Promise<AudioNote[]> {
  const rows = await ctx.db
    .select({
      id: documentAudio.id,
      durationMs: documentAudio.durationMs,
      createdAt: documentAudio.createdAt,
    })
    .from(documentAudio)
    .where(and(eq(documentAudio.documentId, documentId), inSubmittedSet))
    .orderBy(asc(documentAudio.createdAt), asc(documentAudio.id));
  return rows.map((r) => ({
    id: r.id,
    durationMs: r.durationMs,
    createdAt: r.createdAt.toISOString(),
  }));
}
