/** The audience and comment chips used on entry cards and the entry view (FRONTEND.md §4.2). */
import type { Access } from '@diary/shared';
import type { MyDocumentRow } from '../../api/diary.js';
import { Chip } from '../../components/Chip.js';
import { useT } from '../../i18n/index.js';

/**
 * Who can read an entry (D37): 只有我 until it is sent, then the leaders, or the leaders and the class; plus
 * 有未發佈的修改 while the owner has saved changes readers haven't seen.
 */
export function AudienceChips({
  state,
  access,
}: {
  state: MyDocumentRow['state'];
  access: Access;
}) {
  const t = useT();
  if (state === 'draft') return <Chip tone="amber">{t('chip.me')}</Chip>;
  return (
    <>
      {access === 'private' ? (
        <Chip>{t('chip.leaders')}</Chip>
      ) : (
        <Chip tone="green">{t('chip.class')}</Chip>
      )}
      {state === 'submitted_with_draft' && <Chip tone="primary">{t('chip.pending')}</Chip>}
    </>
  );
}

export function CommentChip({ count, unseen = false }: { count: number; unseen?: boolean }) {
  const t = useT();
  if (unseen) {
    return (
      <Chip tone="blue" strong>
        {t('chip.newComment')}
      </Chip>
    );
  }
  if (count === 0) return <Chip>{t('chip.noComment')}</Chip>;
  return <Chip tone="blue">{t(count === 1 ? 'chip.comment' : 'chip.comments', { n: count })}</Chip>;
}
