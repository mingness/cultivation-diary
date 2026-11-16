/** Diary entries (spec §5): the owner's, leader's and reader's views, comments and sharing. */
import { z } from 'zod';
import { Access, ShareScope } from './roles.js';
import { ENTRY_LIMITS } from './limits.js';

export const DocumentTitle = z.string().trim().max(ENTRY_LIMITS.titleChars);
/** Rich text from the editor. The server sanitises it; anything outside the editor's allowlist is dropped. */
export const DocumentBody = z.string().max(ENTRY_LIMITS.bodyBytes);

export const CreateDocumentRequest = z.object({
  title: DocumentTitle.default(''),
  body: DocumentBody.default(''),
});

export const SaveDocumentRequest = z.object({ title: DocumentTitle, body: DocumentBody });

export const DocumentIdParams = z.object({ id: z.uuid() });

/**
 * - draft: never submitted; only the owner can see it.
 * - submitted: leaders see it; nothing pending.
 * - submitted_with_draft: submitted, and the owner has changes leaders don't see yet (text or voice notes;
 *   their 更新 is pending).
 */
export const DocumentState = z.enum(['draft', 'submitted', 'submitted_with_draft']);

/** The format voice notes are stored in (D35): MP3, which the app records in every browser and every phone plays. */
export const AudioMime = z.enum(['audio/mpeg']);
export type AudioMime = z.infer<typeof AudioMime>;

/** A voice note on a leader's entry (D35), as readers and other leaders get it: part of the submitted entry. */
export const AudioNote = z.object({
  id: z.uuid(),
  durationMs: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type AudioNote = z.infer<typeof AudioNote>;

/**
 * A voice note as its owner sees it. `pending` says what the next 提交/更新 does with it: `add` makes it part
 * of the entry, `remove` takes it out; null means it is already part of the submitted entry and stays.
 */
export const OwnAudioNote = AudioNote.extend({ pending: z.enum(['add', 'remove']).nullable() });
export type OwnAudioNote = z.infer<typeof OwnAudioNote>;

/** `POST /api/documents/:id/audio?durationMs=`: the recording's length, as the recorder measured it. */
export const AudioUploadQuery = z.object({
  durationMs: z.coerce.number().int().min(1).max(ENTRY_LIMITS.audioMs),
});

export const AudioIdParams = z.object({ id: z.uuid(), audioId: z.uuid() });

/** The owner's view of one entry. */
export const OwnDocument = z.object({
  id: z.uuid(),
  /** The Beijing date the entry was created (spec §5.1: no backdating). */
  diaryDate: z.iso.date(),
  state: DocumentState,
  access: Access,
  /**
   * A leader stopped sharing this entry and it hasn't been updated since; sharing it again waits for the
   * next 更新 with a change.
   */
  unsharedByLeader: z.boolean(),
  /** What leaders currently see; null until the first 提交. */
  submitted: z.object({ title: z.string(), body: z.string(), at: z.iso.datetime() }).nullable(),
  /** The owner's working copy, if it differs from what was submitted; null when there's nothing pending. */
  draft: z.object({ title: z.string(), body: z.string(), savedAt: z.iso.datetime() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OwnDocument = z.infer<typeof OwnDocument>;

/** A submitted comment, as the owner, other leaders and (for shared entries) readers see it (spec §5.4). */
export const SubmittedComment = z.object({
  id: z.uuid(),
  /** "family given", or the username without a name; null when the leader's account has been deleted. */
  authorName: z.string().nullable(),
  submittedAt: z.iso.datetime(),
  body: z.string(),
});
export type SubmittedComment = z.infer<typeof SubmittedComment>;

/** The leader's own comment on an entry; only that leader ever sees it while it's a draft. */
export const MyComment = z.object({
  body: z.string(),
  state: z.enum(['draft', 'submitted']),
  submittedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type MyComment = z.infer<typeof MyComment>;

/** `GET /api/documents/:id` for the owner: everything, plus submitted comments with a "new" marker. */
export const OwnerEntryView = OwnDocument.extend({
  view: z.literal('owner'),
  comments: z.array(
    SubmittedComment.extend({
      /** Submitted since the owner last opened the entry (drives the 有新批注 marker). */
      isNew: z.boolean(),
    }),
  ),
  /** A leader's own comment on their own entry (never one of `comments`); null for everyone else. */
  myComment: MyComment.nullable(),
  /** Voice notes (D35), oldest first, including those waiting for 提交/更新. */
  audio: z.array(OwnAudioNote),
});

/** Whose entry it is, as leaders see it. */
export const EntryAuthor = z.object({ id: z.uuid(), username: z.string(), name: z.string() });

/**
 * `GET /api/documents/:id` for a leader (not the owner): the last submitted version only, never the owner's
 * draft; other leaders' submitted comments; and this leader's own comment.
 */
export const LeaderEntryView = z.object({
  view: z.literal('leader'),
  id: z.uuid(),
  diaryDate: z.iso.date(),
  access: Access,
  author: EntryAuthor,
  title: z.string(),
  body: z.string(),
  submittedAt: z.iso.datetime(),
  comments: z.array(SubmittedComment),
  myComment: MyComment.nullable(),
  /** The submitted entry's voice notes (D35), oldest first. */
  audio: z.array(AudioNote),
});

/**
 * `GET /api/documents/:id` for any other signed-in user, when the entry is shared with them (spec §5.3): the last
 * submitted version and the submitted comments. Never drafts, history or draft comments.
 */
export const ReaderEntryView = z.object({
  view: z.literal('reader'),
  id: z.uuid(),
  diaryDate: z.iso.date(),
  author: EntryAuthor,
  title: z.string(),
  body: z.string(),
  submittedAt: z.iso.datetime(),
  comments: z.array(SubmittedComment),
  /** The submitted entry's voice notes (D35), oldest first. */
  audio: z.array(AudioNote),
});

export const EntryView = z.discriminatedUnion('view', [
  OwnerEntryView,
  LeaderEntryView,
  ReaderEntryView,
]);
export type EntryView = z.infer<typeof EntryView>;

/** 暫存 (`draft`) or 提交 (`submitted`) the leader's comment. A submitted comment needs some text or a photo. */
export const SaveCommentRequest = z.object({
  body: DocumentBody,
  state: z.enum(['draft', 'submitted']),
});

/**
 * Sharing changes (spec §5.3, docs/ARCHITECTURE.md §7.2): the author shares or unshares; a leader can only
 * unshare. The server decides who may do which.
 */
export const AccessChangeRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('share'), scope: ShareScope }),
  z.object({ action: z.literal('unshare') }),
]);
export const AccessChangeResponse = z.object({ access: Access });

/** `YYYY-MM`, a Beijing calendar month. */
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const MyDocumentsQuery = z.object({ month: Month });

/** `GET /api/documents/open`: the 開放日記 list for one Beijing month. */
export const OpenDocumentsQuery = z.object({ month: Month });

/** Entries shared with the reader, newest first; content comes from `GET /api/documents/:id` when a row is expanded. */
export const OpenDocumentList = z.object({
  documents: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      diaryDate: z.iso.date(),
      author: EntryAuthor,
      /** Submitted comments (spec §6.1's comment mark). */
      commentCount: z.number().int(),
    }),
  ),
});

export const MyDocumentList = z.object({
  documents: z.array(
    z.object({
      id: z.uuid(),
      /** The newest title the owner wrote (the draft's, if there is one). */
      title: z.string(),
      diaryDate: z.iso.date(),
      state: DocumentState,
      access: Access,
      commentCount: z.number().int(),
      hasUnseenComment: z.boolean(),
    }),
  ),
});

export const DocumentVersions = z.object({
  versions: z.array(
    z.object({ versionNo: z.number().int(), createdAt: z.iso.datetime(), body: z.string() }),
  ),
});

/** SYS_ADMIN document management (spec §6.5.2): metadata only, never content or comments. */
export const AdminDocumentQuery = z.object({
  username: z.string().trim().max(64).optional(),
  date: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});
export const AdminDocumentList = z.object({
  documents: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      diaryDate: z.iso.date(),
      ownerId: z.uuid(),
      ownerUsername: z.string(),
      state: DocumentState,
      access: Access,
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
});
