/**
 * A leader's one sharing control in review (spec §5.3, F3): a small 取消開放 beside a shared entry's chip,
 * after a confirmation. Sharing is the author's choice, so there is nothing to approve; the author can share
 * again once they have updated the entry.
 */
import { useState } from 'react';
import { useAccessChange } from '../../api/diary.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/Dialog.js';
import { useToast } from '../../components/Toast.js';
import { useT } from '../../i18n/index.js';

export function StopSharing({ documentId }: { documentId: string }) {
  const t = useT();
  const toast = useToast();
  const change = useAccessChange(documentId);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button small variant="quiet" disabled={change.isPending} onClick={() => setConfirming(true)}>
        {t('unshare.button')}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t('unshare.title')}
        onCancel={() => setConfirming(false)}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                change.mutate(
                  { action: 'unshare' },
                  { onSuccess: () => toast.show(t('unshare.done')), onError: toast.showError },
                );
              }}
            >
              {t('unshare.button')}
            </Button>
          </>
        }
      >
        <p>{t('unshare.body')}</p>
      </ConfirmDialog>
    </>
  );
}
