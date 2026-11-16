/**
 * One entry in full, as the reader may see it (spec §6.1, FRONTEND.md §4.4, §4.7), used wherever an entry is
 * read: full screen, in the leader's reading pane, and in the continuous reading feed.
 *
 * - The owner (context `own`): their newest writing, 編輯, the share request, and submitted comments.
 * - A leader in review: the submitted version, sharing decisions, the other leaders' comments and the comment
 *   editor for their own. Elsewhere (開放日記) the entry is read-only and their own comment is listed with the
 *   others. A leader's own entry seen in review gets the review treatment.
 * - Anyone else, for an open entry: the submitted version and its submitted comments.
 *
 * A leader's entry is framed and tinted in the leader's own colour, which also marks their name (D36); the
 * reader's own entry, met outside 我的日記, is framed in the primary colour and marked 我的, so both stand out
 * from the class's.
 */
import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { DAILY_LIMITS, ENTRY_LIMITS, ErrorCode, personName, type EntryView } from '@diary/shared';
import { ApiError } from '../../api/client.js';
import { saveEntry, storeOwnDocument } from '../../api/diary.js';
import { refreshAfterRead } from '../../api/leader.js';
import { useSession } from '../../api/session.js';
import { buttonClass } from '../../components/Button.js';
import { Chip } from '../../components/Chip.js';
import { Icon } from '../../components/Icon.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { formatDiaryDate } from '../../lib/dates.js';
import { leaderStyle } from '../../lib/leaders.js';
import { StopSharing } from '../review/StopSharing.js';
import { CommentEditor } from '../review/CommentEditor.js';
import { VoiceNoteList } from './AudioPlayer.js';
import { AudienceChips, CommentChip } from './chips.js';
import { AudienceControl } from './AudienceControl.js';
import { CommentList } from './CommentList.js';
import { PinToggle } from './PinToggle.js';
import { RichContent } from './RichContent.js';
import { TranslateBlock } from './TranslateBlock.js';
import styles from './EntryArticle.module.css';

export function EntryArticle({
  entry,
  context,
  level,
}: {
  entry: EntryView;
  /**
   * `own`: the owner's diary (編輯, sharing, state). `review`: the leader's review (decisions, my comment).
   * `read`: 開放日記, just for reading: text, author, translation and comments, nothing to change.
   */
  context: 'own' | 'review' | 'read';
  /** The title's heading level: 1 full screen, 2 in a pane, 3 in a feed under a list heading. */
  level: 1 | 2 | 3;
}) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isLeader = session?.status === 'ready' && session.me.role === 'COURSE_LEADER';

  // Opening the entry marked its new comments seen on the server; the list's markers must follow.
  const hadNew = entry.view === 'owner' && entry.comments.some((c) => c.isNew);
  useEffect(() => {
    if (hadNew) void queryClient.invalidateQueries({ queryKey: ['documents', 'mine'] });
  }, [hadNew, queryClient]);
  // A leader's read is recorded by the server: their 未讀 count and 未讀 marks follow.
  const leaderRead = entry.view === 'leader';
  useEffect(() => {
    if (leaderRead) refreshAfterRead(queryClient);
  }, [leaderRead, entry.id, queryClient]);

  const ownView = entry.view === 'owner' && context === 'own' ? entry : null;
  const shown =
    entry.view !== 'owner'
      ? { title: entry.title, body: entry.body }
      : ownView
        ? (entry.draft ?? entry.submitted ?? { title: '', body: '' })
        : // Leaders review, and 開放日記 shows, what was submitted, the reader's own entries included.
          { title: entry.submitted?.title ?? '', body: entry.submitted?.body ?? '' };
  const submitted = entry.view !== 'owner' || entry.submitted !== null;
  // Voice notes follow the text (D35): the owner's diary shows the newest, with 待更新 on notes kept since the
  // last 更新; everywhere else shows what was submitted.
  const notes =
    entry.view !== 'owner'
      ? entry.audio
      : ownView
        ? entry.audio.filter((n) => n.pending !== 'remove')
        : entry.audio.filter((n) => n.pending !== 'add').map((n) => ({ ...n, pending: null }));
  // Not a reader's view: the leader's own comment and sharing state are known.
  const withMine = entry.view === 'reader' ? null : entry;
  const reviewing = context === 'review' && entry.view !== 'reader';
  // Leaders write comments in review (批閱); elsewhere their own shows with the others, read-only.
  const commenting = isLeader && submitted && context === 'review';
  const myName =
    session?.status === 'ready'
      ? personName(session.me.profile.familyName, session.me.profile.givenName) ||
        session.me.username
      : null;
  const myColour = session?.status === 'ready' ? session.me.leaderColour : null;
  const mine =
    !commenting && withMine?.myComment?.state === 'submitted' && withMine.myComment.submittedAt
      ? [
          {
            id: `mine-${entry.id}`,
            authorColour: myColour,
            authorName: myName,
            submittedAt: withMine.myComment.submittedAt,
            body: withMine.myComment.body,
          },
        ]
      : [];
  const comments = [...entry.comments, ...mine].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  );
  const Title = `h${level}` as const;
  const toast = useToast();

  /** The first 提交 from the read view (D37): what the owner last saved goes to the leaders as it is. */
  async function sendDraft({ quiet }: { quiet: boolean }): Promise<string | null> {
    if (!ownView) return null;
    const content = ownView.draft ?? ownView.submitted ?? { title: '', body: '' };
    try {
      const saved = await saveEntry.submit(ownView.id, {
        title: content.title,
        body: content.body,
      });
      storeOwnDocument(queryClient, saved);
      if (!quiet) toast.show(t(isLeader ? 'editor.submittedLeader' : 'editor.submitted'));
      return saved.id;
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.LimitReached) {
        const limit = String(error.details.limit ?? '');
        if (limit === 'submit') {
          toast.show(`${t('limit.submit', { max: DAILY_LIMITS.submit })} ${t('limit.resets')}`);
          return null;
        }
        if (limit === 'chars') {
          toast.show(t('limit.chars', { max: ENTRY_LIMITS.chars }));
          return null;
        }
      }
      toast.showError(error);
      return null;
    }
  }
  // The reader's own entry shows their colour too, as the class sees it.
  const authorColour = entry.view !== 'owner' ? entry.author.leaderColour : myColour;
  const mineElsewhere = entry.view === 'owner' && context !== 'own';

  return (
    <article
      className={[
        styles.article,
        authorColour !== null && styles.leaderEntry,
        mineElsewhere && styles.ownEntry,
      ]
        .filter(Boolean)
        .join(' ')}
      style={leaderStyle(authorColour)}
      // Lets the feed's card step aside, so the frame is the card rather than a box inside it.
      data-framed={authorColour !== null || mineElsewhere || undefined}
    >
      <div className={styles.titleRow}>
        <Title className={level === 1 ? styles.title : styles.titleSmall}>
          {shown.title || t('entry.untitled')}
        </Title>
        {ownView && (
          <Link to={`/diary/${entry.id}/edit`} className={buttonClass('quiet', { small: true })}>
            <Icon name="pen" />
            {t('entry.edit')}
          </Link>
        )}
      </div>
      <div className={styles.meta}>
        <span>{formatDiaryDate(entry.diaryDate, lang)}</span>
        {entry.view !== 'owner' ? (
          authorColour !== null ? (
            <span className={styles.leaderName}>
              {t('entry.leader', { name: entry.author.name || entry.author.username })}
            </span>
          ) : (
            <span>{entry.author.name || entry.author.username}</span>
          )
        ) : (
          context === 'read' &&
          (authorColour !== null ? (
            <span className={styles.leaderName}>{t('entry.leader', { name: myName ?? '' })}</span>
          ) : (
            <span>{myName}</span>
          ))
        )}
        {mineElsewhere && <Chip tone="primary">{t('entry.mine')}</Chip>}
        {/* For reading, the comments speak for themselves and everything shown is open. */}
        {context !== 'read' && withMine && (
          <AudienceChips state={ownView?.state ?? 'submitted'} access={withMine.access} />
        )}
        {/* A leader's own entry has the author's share box below instead. */}
        {reviewing && entry.view === 'leader' && entry.access !== 'private' && (
          <StopSharing documentId={entry.id} />
        )}
        {context !== 'read' && <CommentChip count={comments.length} />}
      </div>
      {/* Quiet lines, not boxes: the entry itself should be the most visible thing here. */}
      {ownView && !ownView.submitted && (
        <p className={styles.note}>{t(isLeader ? 'entry.draftNoteLeader' : 'entry.draftNote')}</p>
      )}
      {ownView?.submitted && ownView.draft && (
        <p className={styles.note}>{t('entry.pendingNote')}</p>
      )}
      <div className={styles.body}>
        {shown.body ? <RichContent html={shown.body} /> : t('entry.empty')}
      </div>
      <VoiceNoteList documentId={entry.id} notes={notes} />
      <TranslateBlock source={{ documentId: entry.id }} />
      {ownView && (
        <AudienceControl
          documentId={ownView.id}
          sent={submitted}
          access={ownView.access}
          unsharedByLeader={ownView.unsharedByLeader}
          hasComments={ownView.comments.length > 0}
          canSend
          send={sendDraft}
        />
      )}
      {ownView && (isLeader || ownView.pinned) && (
        <PinToggle
          documentId={ownView.id}
          pinned={ownView.pinned}
          shared={ownView.access !== 'private'}
        />
      )}
      <CommentList comments={comments} />
      {commenting && withMine && (
        <CommentEditor key={entry.id} documentId={entry.id} saved={withMine.myComment} />
      )}
    </article>
  );
}
