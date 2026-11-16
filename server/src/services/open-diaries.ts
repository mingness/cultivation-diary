/**
 * The 開放日記 list (spec §5.3, §6.1): entries their authors chose to share, and the ones leaders pinned
 * (D36). Titles are plaintext by design (spec §3) and names come from profiles, so this never touches diary
 * content; each entry's content is read through `GET /api/documents/:id`, which checks access again.
 */
import { and, desc, gte, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { documents } from '../db/schema.js';
import { monthDates } from '../domain/count/schedule.js';
import { peopleByIds } from './people.js';

// Everyone is in the one class for now, so both levels reach every reader (sharedWithReader).
const shared = inArray(documents.access, ['course', 'everyone']);

async function openRows(ctx: AppContext, where: SQL | undefined, order: SQL[]) {
  return ctx.db
    .select({
      id: documents.id,
      title: documents.title,
      diaryDate: documents.diaryDate,
      ownerId: documents.ownerId,
      pinned: sql<boolean>`${documents.pinnedAt} IS NOT NULL`,
      commentCount: sql<number>`(
        SELECT count(*)::int FROM comments c
         WHERE c.document_id = documents.id AND c.state = 'submitted')`,
    })
    .from(documents)
    .where(where)
    .orderBy(...order);
}

/**
 * Shared entries dated in the Beijing month, newest first, and every pinned entry whatever its date, most
 * recently pinned first; both with their submitted-comment counts.
 */
export async function listOpenMonth(ctx: AppContext, month: string) {
  const { first, next } = monthDates(month);
  const [monthRows, pinnedRows] = await Promise.all([
    openRows(ctx, and(shared, gte(documents.diaryDate, first), lt(documents.diaryDate, next)), [
      desc(documents.diaryDate),
      desc(documents.lastSubmittedAt),
    ]),
    // A pin can only stand on a shared entry (a database check), but the filter keeps this list honest alone.
    openRows(ctx, and(shared, isNotNull(documents.pinnedAt)), [desc(documents.pinnedAt)]),
  ]);
  const people = await peopleByIds(
    ctx,
    [...monthRows, ...pinnedRows].map((r) => r.ownerId),
  );
  const withAuthors = (rows: typeof monthRows) =>
    rows.flatMap(({ ownerId, ...r }) => {
      const author = people.get(ownerId);
      return author ? [{ ...r, author }] : [];
    });
  return { documents: withAuthors(monthRows), pinned: withAuthors(pinnedRows) };
}
