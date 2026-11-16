/**
 * Display names for lists that show other people (leader screens, comment authors). Names live in the
 * encrypted profile, so each one is decrypted here; the app is small enough that doing so per request is fine.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { displayName, openProfile } from './profiles.js';

export interface Person {
  readonly id: string;
  readonly username: string;
  /** "family given", or the username when no name is set. */
  readonly name: string;
  /**
   * For a COURSE_LEADER, their place among the leaders in the order the accounts were made (0, 1, …), which
   * the app turns into the leader's own colour; null for everyone else. Numbering rather than hashing the ID
   * keeps a handful of leaders from sharing a colour.
   */
  readonly leaderColour: number | null;
}

const columns = {
  id: users.id,
  username: users.username,
  profileCt: users.profileCt,
  profileNonce: users.profileNonce,
  profileDekWrapped: users.profileDekWrapped,
};

function toPerson(
  ctx: AppContext,
  leaders: ReadonlyMap<string, number>,
  row: { id: string; username: string } & Parameters<typeof openProfile>[2],
): Person {
  return {
    id: row.id,
    username: row.username,
    leaderColour: leaders.get(row.id) ?? null,
    name: displayName(openProfile(ctx.config.profileKeyring, row.id, row), row.username),
  };
}

/** Every current leader's colour number, by user ID (see `Person.leaderColour`). */
async function leaderColours(ctx: AppContext): Promise<Map<string, number>> {
  const rows = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'COURSE_LEADER'))
    .orderBy(asc(users.createdAt), asc(users.id));
  return new Map(rows.map((r, i) => [r.id, i]));
}

/** One user's leader colour number, or null if they aren't a leader. */
export async function leaderColourOf(ctx: AppContext, userId: string): Promise<number | null> {
  return (await leaderColours(ctx)).get(userId) ?? null;
}

/** The people with these IDs, keyed by ID. Unknown IDs (e.g. deleted accounts) are simply absent. */
export async function peopleByIds(
  ctx: AppContext,
  ids: Iterable<string>,
): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const [rows, leaders] = await Promise.all([
    ctx.db.select(columns).from(users).where(inArray(users.id, unique)),
    leaderColours(ctx),
  ]);
  return new Map(rows.map((r) => [r.id, toPerson(ctx, leaders, r)]));
}

/** Everyone who keeps a diary (NORMAL_USER and COURSE_LEADER), ordered by username. */
export async function diaryKeepers(ctx: AppContext): Promise<Person[]> {
  const [rows, leaders] = await Promise.all([
    ctx.db
      .select(columns)
      .from(users)
      .where(inArray(users.role, ['NORMAL_USER', 'COURSE_LEADER']))
      .orderBy(users.username),
    leaderColours(ctx),
  ]);
  return rows.map((r) => toPerson(ctx, leaders, r));
}
