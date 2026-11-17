/**
 * Development and test data (spec §11). Never runs in production; passwords and authenticator secrets are
 * throwaway. Everything goes through the real services (entries, sharing, comments, voice notes, admin
 * changes), so it is encrypted and checked exactly like real data, and dated over the past two weeks so
 * calendars and month lists have something to show.
 *
 * Usernames say what each account is for: `<role>.<situation>`. Together they cover every state a screen can
 * show: each entry state, sharing and a leader's unshare, history, photos, the length counter, comments in
 * draft, new, seen and from a deleted leader, voice notes submitted and pending, a demoted leader, a locked
 * account and empty diaries. The e2e projects sign in
 * as some of these (web/playwright.config.ts); docs/DEVELOPING.md lists them all.
 */
import { readFile } from 'node:fs/promises';
import { eq, ne, sql } from 'drizzle-orm';
import type { Access, Profile, Role } from '@diary/shared';
import type { AppContext } from '../context.js';
import { comments, countRecitations, users } from '../db/schema.js';
import { generateTotpSecret } from '../domain/auth/totp.js';
import type { AlertRule } from '../domain/limits/attention.js';
import { raiseAlert } from './activity.js';
import { AdminToolError, enableTotp } from './admin-tools.js';
import { adminDeleteUser, adminUpdateUser } from './admin-users.js';
import { addAudio, removeAudio } from './diary/audio.js';
import { saveMyComment } from './diary/comments.js';
import { createDocument, saveDraft, submitDocument } from './diary/documents.js';
import { changeAccess, setPinned } from './sharing.js';
import { submitCount, updateCountSettings } from './count.js';
import { createUser, type UserRow } from './users.js';

export const SEED_PASSWORD = 'password123';

interface SeedUser {
  readonly username: string;
  readonly role: Role;
  readonly profile: Profile;
  /** What this account shows, printed by the seed command. */
  readonly note: string;
  readonly resetPending?: boolean;
  /** Made a NORMAL_USER after the seed has written their entries as a leader (D35: notes stay). */
  readonly demotedAfterSeed?: boolean;
  /** Deleted after the seed has written their comments (D18: submitted ones stay, as a former leader). */
  readonly deletedAfterSeed?: boolean;
}

const person = (familyName: string, givenName: string, more: Partial<Profile> = {}): Profile => ({
  familyName,
  givenName,
  address: '',
  phone: '',
  photo: null,
  ...more,
});

export const SEED_USERS: readonly SeedUser[] = [
  {
    username: 'admin.main',
    role: 'SYS_ADMIN',
    profile: person('李', '志強'),
    note: 'signs in through the form in e2e (auth.spec)',
  },
  {
    username: 'admin.backup',
    role: 'SYS_ADMIN',
    profile: person('陳', '志強'),
    note: "the e2e tests' shared admin session; sees the other admin's alerts",
  },
  {
    username: 'leader.voice',
    role: 'COURSE_LEADER',
    profile: person('林', '慧君'),
    note: 'own entries with voice notes (shared, pending add/remove, draft); comments',
  },
  {
    username: 'leader.reviewer',
    role: 'COURSE_LEADER',
    profile: person('黃', '志遠'),
    note: 'no diary of their own; comments and unshares',
  },
  {
    username: 'leader.departed',
    role: 'COURSE_LEADER',
    profile: person('趙', '德明'),
    note: 'deleted after commenting: their comment shows as from a former leader',
    deletedAfterSeed: true,
  },
  {
    username: 'student.full',
    role: 'NORMAL_USER',
    profile: person('陳', '明德', { address: '[地址 1]', phone: '+852 5555 0101' }),
    note: 'every entry state: draft, shared, unshared, history, photos, long, comments',
  },
  {
    username: 'student.shared',
    role: 'NORMAL_USER',
    profile: person('張', '淑芬', { address: '[地址 2]' }),
    note: 'shares entries with the class',
  },
  {
    username: 'student.commented',
    role: 'NORMAL_USER',
    profile: person('王', '大同'),
    note: 'a private entry with a submitted and a draft comment',
  },
  {
    username: 'student.daily',
    role: 'NORMAL_USER',
    profile: person('吳', '美玲'),
    note: 'reports 1080 every day; one shared entry',
  },
  {
    username: 'student.new',
    role: 'NORMAL_USER',
    profile: person('林', '佳穎'),
    note: 'no entries yet (empty diary); one count',
  },
  {
    username: 'student.exleader',
    role: 'NORMAL_USER',
    profile: person('李', '建國'),
    note: 'a former leader: a shared entry keeps its voice note',
    demotedAfterSeed: true,
  },
  {
    username: 'student.locked',
    role: 'NORMAL_USER',
    profile: person('陳', '美華'),
    note: "waiting for a password reset: can't sign in",
    resetPending: true,
  },
];

const p = (...lines: string[]) => lines.map((l) => `<p>${l}</p>`).join('');

/** A small real PNG, so photo entries show something and count toward the 2-photo limit. */
const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mM4siCPJMQwqmFUw/DVAAAS5tIQr5CYVAAAAABJRU5ErkJggg==';

/** Paragraphs of exactly `chars` visible characters (spec §5.5 counts no whitespace). */
function longText(chars: number): string {
  const sentence = '今天靜坐時妄念紛飛，每次發現了，就輕輕回到佛號上。';
  const all = [...sentence.repeat(Math.ceil(chars / [...sentence].length))].slice(0, chars);
  const paragraphs: string[] = [];
  for (let i = 0; i < all.length; i += 250) paragraphs.push(all.slice(i, i + 250).join(''));
  return p(...paragraphs);
}

interface SeedEntry {
  readonly owner: string;
  readonly daysAgo: number;
  readonly title: string;
  /** Bodies submitted in order: the last is what leaders see, earlier ones become history versions. */
  readonly submissions: readonly string[];
  /** A pending draft after the submissions (or the only content, for an entry never submitted). */
  readonly draft?: string;
  readonly access?: Access;
  /** Shared by its author, then unshared by a leader, so the author's notice shows. */
  readonly unsharedByLeader?: boolean;
  readonly comments?: readonly SeedComment[];
  /** The owner has already opened the submitted comments (no 有新批注). */
  readonly commentsSeen?: boolean;
  /** Pinned to the top of 開放日記 (D36; a leader's own shared entry). */
  readonly pinned?: boolean;
  /** Voice notes (D35; the owner must be a leader when the seed writes them). */
  readonly audio?: {
    /** How many are recorded before the submissions, so they are part of the submitted entry. */
    readonly submitted?: number;
    /** How many of those the owner then removes, waiting for 更新 (readers still hear them). */
    readonly removeAfter?: number;
    /** How many are recorded after the submissions, waiting for 提交/更新. */
    readonly pending?: number;
  };
}

interface SeedComment {
  readonly leader: string;
  readonly state: 'draft' | 'submitted';
  readonly body: string;
}

export const SEED_ENTRIES: readonly SeedEntry[] = [
  // student.full: one of everything an owner can see.
  {
    owner: 'student.full',
    daysAgo: 0,
    title: '晨起靜坐',
    submissions: [],
    draft: p('清晨五點半起床，在佛堂靜坐四十分鐘。', '明天想試試先拜佛再靜坐。'),
  },
  {
    owner: 'student.full',
    daysAgo: 1,
    title: '念佛一小時',
    submissions: [p('晚上在家念佛一小時，用計數器記了一千零八十聲。')],
    access: 'course',
    comments: [
      {
        leader: 'leader.voice',
        state: 'submitted',
        body: p('能夠持續一小時很好，數目之外，也留意心是否清楚。'),
      },
      {
        leader: 'leader.reviewer',
        state: 'submitted',
        body: p('隨喜。可以試試聽著自己的念佛聲。'),
      },
    ],
  },
  {
    owner: 'student.full',
    daysAgo: 3,
    title: '佛堂的花',
    submissions: [
      p(
        '今天換了佛堂的花。',
        `<img src="${PHOTO}">`,
        '母親說黃色的比較好看。',
        `<img src="${PHOTO}">`,
      ),
    ],
  },
  {
    owner: 'student.full',
    daysAgo: 5,
    title: '與家人的對話',
    submissions: [p('和父親談起學佛的事，他第一次沒有反對。')],
    unsharedByLeader: true,
  },
  {
    owner: 'student.full',
    daysAgo: 7,
    title: '長篇反思（字數提示）',
    submissions: [longText(4_300)],
  },
  {
    owner: 'student.full',
    daysAgo: 8,
    title: '太長的草稿（不能提交）',
    submissions: [],
    draft: longText(5_200),
  },
  {
    owner: 'student.full',
    daysAgo: 9,
    title: '早課心得',
    submissions: [
      p('早課時一直打瞌睡。'),
      p('早課時一直打瞌睡，後來站起來繞佛才清醒。'),
      p('早課時一直打瞌睡，後來站起來繞佛才清醒。<b>明天早點睡。</b>'),
      p('早課時一直打瞌睡，後來站起來繞佛才清醒。<b>明天早點睡。</b>', '（第四版）'),
      p(
        '早課時一直打瞌睡，後來站起來繞佛才清醒。<b>明天早點睡。</b>',
        '（第五版：最早的一版已不在歷史中）',
      ),
    ],
    comments: [
      {
        leader: 'leader.voice',
        state: 'submitted',
        body: p('繞佛是好方法。早睡早起，功課自然穩定。'),
      },
    ],
    commentsSeen: true,
  },
  {
    owner: 'student.full',
    daysAgo: 12,
    title: '第一次參加共修',
    submissions: [p('第一次參加共修，人很多，有點緊張。')],
    draft: p('第一次參加共修，人很多，有點緊張。結束後師兄請我喝茶。'),
    comments: [{ leader: 'leader.reviewer', state: 'draft', body: p('歡迎你來共修，') }],
  },
  {
    owner: 'student.full',
    daysAgo: 13,
    title: '放生',
    submissions: [p('跟著師兄們去海邊放生，看著魚游走，心裡很安靜。')],
    comments: [
      { leader: 'leader.departed', state: 'submitted', body: p('放生要發慈悲心，不只是儀式。') },
    ],
    commentsSeen: true,
  },

  // Other students.
  {
    owner: 'student.shared',
    daysAgo: 0,
    title: '照顧母親的一天',
    submissions: [p('母親住院第三天。整天在病房，只能在走廊默念佛號。')],
    access: 'course',
  },
  {
    owner: 'student.shared',
    daysAgo: 4,
    title: '病房裡的念佛',
    submissions: [p('隔壁床的阿婆聽到我念佛，也跟著念了幾句。')],
    access: 'course',
    comments: [
      { leader: 'leader.voice', state: 'submitted', body: p('在病房也不忘功課，很難得。') },
    ],
  },
  {
    owner: 'student.commented',
    daysAgo: 0,
    title: '讀經筆記',
    submissions: [p('今天讀《心經》，對「心無罣礙」有新的體會。')],
    comments: [
      { leader: 'leader.voice', state: 'draft', body: p('可以多寫一些體會的內容') },
      { leader: 'leader.reviewer', state: 'submitted', body: p('讀經後能有體會，很難得。') },
    ],
  },
  {
    owner: 'student.daily',
    daysAgo: 1,
    title: '共修後的反省',
    submissions: [p('共修時一直在意旁邊的人念得太大聲。回家後想想，其實是自己的心不夠靜。')],
    access: 'course',
  },

  // Leaders' own entries (D19), with voice notes (D35).
  {
    owner: 'leader.voice',
    daysAgo: 0,
    title: '今晚共修的提醒',
    submissions: [p('今晚共修前，請大家先聽這兩段錄音。')],
    access: 'course',
    audio: { submitted: 2 },
    comments: [{ leader: 'leader.reviewer', state: 'submitted', body: p('多聆聽，說得好。') }],
  },
  {
    // leader.reviewer: leader.voice serves three e2e projects, which each pin one entry at once (cap 3).
    owner: 'leader.reviewer',
    daysAgo: 40,
    title: '共修須知（置頂）',
    submissions: [p('每晚八點共修，請提早五分鐘到。日記每週至少寫兩篇。')],
    access: 'course',
    // Written last month, so it shows the pin heading every month (D36).
    pinned: true,
  },
  {
    owner: 'leader.voice',
    daysAgo: 2,
    title: '給新同學的話（錄音待更新）',
    submissions: [p('歡迎新同學。錄音裡有幾句叮嚀。')],
    // Other leaders hear the two submitted notes until 更新 swaps the first for the pending one.
    audio: { submitted: 2, removeAfter: 1, pending: 1 },
  },
  {
    owner: 'leader.voice',
    daysAgo: 4,
    title: '錄音草稿',
    submissions: [],
    draft: p('還沒想好要怎麼說，先錄一段。'),
    audio: { pending: 1 },
  },
  {
    owner: 'student.exleader',
    daysAgo: 6,
    title: '帶班的最後一週',
    submissions: [p('這是我帶班的最後一週，錄了一段話給大家。')],
    access: 'course',
    audio: { submitted: 1 },
  },
];

/** 報數 over the past week: [username, counts for 6 days ago … today (0: none), auto-submit]. */
export const SEED_COUNTS: readonly [string, readonly number[], boolean][] = [
  ['student.full', [108, 108, 216, 108, 0, 108, 108], true],
  ['student.shared', [540, 0, 0, 1080, 540, 540, 0], true],
  ['student.commented', [0, 0, 27, 54, 108, 0, 216], false],
  ['student.daily', [1080, 1080, 1080, 1080, 1080, 1080, 1080], false],
  ['student.new', [0, 0, 0, 0, 0, 21, 0], false],
  ['leader.voice', [108, 108, 108, 108, 108, 108, 108], true],
];

/** Open Attention flags: at least one per e2e project, since each handles one (web/e2e/admin.spec.ts). */
const SEED_ALERTS: readonly (readonly [string, AlertRule])[] = [
  ['student.full', 'elevated_activity'],
  ['student.shared', 'login_failures'],
  ['student.commented', 'new_devices'],
  ['student.daily', 'limit_reached'],
  ['student.new', 'elevated_activity'],
  ['student.locked', 'login_failures'],
];

/** The seed's recording: a 6-second tone as MP3, the format the app records (§8.14). */
const RECORDING = new URL('../../seed-assets/voice-note.mp3', import.meta.url);

async function loadRecording(): Promise<Buffer | null> {
  try {
    return await readFile(RECORDING);
  } catch {
    // The production image doesn't ship them (and refuses to seed anyway).
    return null;
  }
}
const RECORDING_MS = 6_000;

export interface SeedResult {
  readonly users: {
    username: string;
    role: Role;
    note: string;
    totpSecret?: string;
    resetPending: boolean;
    deleted: boolean;
  }[];
  readonly entries: number;
  /** False when the recordings weren't found, so entries have no voice notes. */
  readonly voiceNotes: boolean;
}

/**
 * Loads development users and entries. Refuses in production, and refuses a database that already has users
 * unless `reset` is set (which deletes everything first).
 */
export async function seed(ctx: AppContext, options: { reset: boolean }): Promise<SeedResult> {
  if (ctx.config.env === 'production') {
    throw new AdminToolError('Refusing to seed a production database.');
  }
  const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(users);
  if (n > 0 && !options.reset) {
    throw new AdminToolError(
      'The database already has users. Run with --reset to wipe and re-seed.',
    );
  }
  if (options.reset) {
    await ctx.db.delete(users);
    // Back to migration 0014's single recitation, so a run that changed it (e2e, trying it out) starts clean.
    await ctx.db.delete(countRecitations).where(ne(countRecitations.startsOn, '2000-01-01'));
    await ctx.db
      .update(countRecitations)
      .set({ recitation: 'great_compassion_mantra', goal: 10_000_000, restart: true, setBy: null })
      .where(eq(countRecitations.startsOn, '2000-01-01'));
  }
  const recording = await loadRecording();

  const created = new Map<string, UserRow>();
  const result: SeedResult['users'] = [];
  for (const spec of SEED_USERS) {
    // Accounts demoted later start as the leaders they were.
    const role: Role = spec.demotedAfterSeed ? 'COURSE_LEADER' : spec.role;
    const user = await createUser(ctx, {
      username: spec.username,
      password: SEED_PASSWORD,
      role,
      profile: spec.profile,
    });
    created.set(spec.username, user);
    let totpSecret: string | undefined;
    if (spec.role === 'SYS_ADMIN') {
      totpSecret = generateTotpSecret();
      await enableTotp(ctx, user, totpSecret, null);
    }
    if (spec.resetPending) {
      await ctx.db.update(users).set({ resetPending: true }).where(eq(users.id, user.id));
    }
    result.push({
      username: spec.username,
      role: spec.role,
      note: spec.note,
      resetPending: spec.resetPending ?? false,
      deleted: spec.deletedAfterSeed ?? false,
      ...(totpSecret ? { totpSecret } : {}),
    });
  }
  const userNamed = (username: string): UserRow => {
    const user = created.get(username);
    if (!user) throw new Error(`seed: unknown user ${username}`);
    return user;
  };

  const now = ctx.clock().getTime();
  for (const entry of SEED_ENTRIES) {
    const owner = userNamed(entry.owner);
    // Write as if on that day, so the entry date and timestamps look real.
    const dayCtx: AppContext = { ...ctx, clock: () => new Date(now - entry.daysAgo * 86_400_000) };
    // A second apart, so an entry's notes keep their order (they are listed oldest first).
    let recorded = 0;
    const record = async () => {
      if (!recording) return null;
      const at = new Date(dayCtx.clock().getTime() + ++recorded * 1000);
      const { note } = await addAudio(
        { ...dayCtx, clock: () => at },
        owner,
        document.id,
        recording,
        RECORDING_MS,
      );
      return note.id;
    };
    const [first = '', ...later] = entry.submissions;
    const { document } = await createDocument(dayCtx, owner.id, {
      title: entry.title,
      body: entry.draft && entry.submissions.length === 0 ? entry.draft : first,
    });
    const submittedNotes: string[] = [];
    for (let i = 0; i < (entry.audio?.submitted ?? 0); i++) {
      const id = await record();
      if (id) submittedNotes.push(id);
    }
    if (entry.submissions.length > 0) {
      await submitDocument(dayCtx, owner.id, document.id, { title: entry.title, body: first });
      for (const body of later) {
        await submitDocument(dayCtx, owner.id, document.id, { title: entry.title, body });
      }
      if (entry.draft) {
        await saveDraft(dayCtx, owner.id, document.id, { title: entry.title, body: entry.draft });
      }
    }
    for (const id of submittedNotes.slice(0, entry.audio?.removeAfter ?? 0)) {
      await removeAudio(dayCtx, owner, document.id, id);
    }
    for (let i = 0; i < (entry.audio?.pending ?? 0); i++) await record();
    if (entry.access === 'course' || entry.unsharedByLeader) {
      await changeAccess(dayCtx, owner, document.id, { kind: 'share', scope: 'course' });
    }
    if (entry.unsharedByLeader) {
      await changeAccess(dayCtx, userNamed('leader.reviewer'), document.id, { kind: 'unshare' });
    }
    if (entry.pinned) await setPinned(dayCtx, owner, document.id, true);
    for (const comment of entry.comments ?? []) {
      const leader = userNamed(comment.leader);
      if (leader.role !== 'COURSE_LEADER') throw new Error(`seed: ${comment.leader} is no leader`);
      await saveMyComment(dayCtx, leader, document.id, {
        body: comment.body,
        state: comment.state,
      });
    }
    if (entry.commentsSeen) {
      await ctx.db
        .update(comments)
        .set({ seenByOwnerAt: dayCtx.clock() })
        .where(eq(comments.documentId, document.id));
    }
  }

  for (const [username, counts, autoSubmit] of SEED_COUNTS) {
    const user = userNamed(username);
    for (const [i, count] of counts.entries()) {
      if (count === 0) continue;
      // Submitted on the day, for that day.
      const at = new Date(now - (counts.length - 1 - i) * 86_400_000);
      await submitCount({ ...ctx, clock: () => at }, user.id, { count });
    }
    await updateCountSettings(ctx, user.id, { autoSubmit });
  }
  // Open flags, so 注意 has something to handle in development and every e2e project finds one.
  for (const [username, rule] of SEED_ALERTS) await raiseAlert(ctx, userNamed(username), rule);

  // Last, so their entries and comments were written by the leaders they were.
  const admin = userNamed('admin.main');
  for (const spec of SEED_USERS) {
    const user = userNamed(spec.username);
    if (spec.demotedAfterSeed) await adminUpdateUser(ctx, user.id, { role: spec.role });
    if (spec.deletedAfterSeed) await adminDeleteUser(ctx, admin.id, user.id);
  }
  return { users: result, entries: SEED_ENTRIES.length, voiceNotes: recording !== null };
}
