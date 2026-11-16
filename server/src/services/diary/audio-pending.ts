/**
 * The voice-note changes waiting for 提交/更新 (D35): kept apart so the entry lifecycle (documents.ts) can ask
 * about them without depending on the upload and playback code.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { documentAudio, documents } from '../../db/schema.js';
import type { Tx } from './usage.js';

/** Whether the entry has voice notes added or removed since it was last submitted. */
export async function hasPendingAudio(db: Db | Tx, documentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: documentAudio.id })
    .from(documentAudio)
    .where(and(eq(documentAudio.documentId, documentId), isNotNull(documentAudio.pending)))
    .limit(1);
  return row !== undefined;
}

/** The same question inside a list query over `documents`. */
export const pendingAudioExists = sql<boolean>`EXISTS (
  SELECT 1 FROM ${documentAudio}
  WHERE ${documentAudio.documentId} = ${documents.id} AND ${documentAudio.pending} IS NOT NULL
)`;

/** Makes the pending changes part of the submitted entry: removals go, additions stay. Inside 提交/更新. */
export async function applyPendingAudio(tx: Tx, documentId: string): Promise<void> {
  await tx
    .delete(documentAudio)
    .where(and(eq(documentAudio.documentId, documentId), eq(documentAudio.pending, 'remove')));
  await tx
    .update(documentAudio)
    .set({ pending: null })
    .where(and(eq(documentAudio.documentId, documentId), eq(documentAudio.pending, 'add')));
}
