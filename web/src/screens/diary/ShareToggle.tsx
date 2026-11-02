/**
 * The author's sharing choice (spec §5.3): checking shares the entry with their class at once, after a
 * confirmation, since nobody reviews it first; unchecking stops sharing. After a leader has stopped sharing
 * it, the box stays off until the author updates the entry.
 */
import { useState } from 'react';
import type { Access } from '@diary/shared';
import { useAccessChange, type AccessChange } from '../../api/diary.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/Dialog.js';
import { CheckboxRow } from '../../components/Field.js';
import { useToast } from '../../components/Toast.js';
import { useT } from '../../i18n/index.js';

export function ShareToggle({
  documentId,
  access,
  submitted,
  unsharedByLeader,
}: {
  /** Null for a new entry that hasn't been saved yet. */
  documentId: string | null;
  access: Access;
  submitted: boolean;
  unsharedByLeader: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const change = useAccessChange(documentId ?? '');
  const [confirmShare, setConfirmShare] = useState(false);
  // The box follows the click at once; the server's answer (or a refusal) settles it.
  const [pending, setPending] = useState<boolean | null>(null);
  const run = (body: AccessChange, checked: boolean) => {
    setPending(checked);
    change.mutate(body, { onError: toast.showError, onSettled: () => setPending(null) });
  };

  const shared = access !== 'private';
  const hint = !submitted
    ? t('share.notSubmitted')
    : shared
      ? t('share.shared')
      : unsharedByLeader
        ? t('share.unsharedByLeader')
        : undefined;

  return (
    <>
      <CheckboxRow
        label={t('share.label')}
        {...(hint ? { hint } : {})}
        checked={pending ?? shared}
        disabled={!documentId || !submitted || (unsharedByLeader && !shared) || change.isPending}
        onChange={(e) => {
          if (e.target.checked) setConfirmShare(true);
          else run({ action: 'unshare' }, false);
        }}
      />
      <ConfirmDialog
        open={confirmShare}
        title={t('share.confirmTitle')}
        onCancel={() => setConfirmShare(false)}
        actions={
          <>
            <Button onClick={() => setConfirmShare(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmShare(false);
                run({ action: 'share', scope: 'course' }, true);
              }}
            >
              {t('share.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('share.confirmBody')}</p>
      </ConfirmDialog>
    </>
  );
}
