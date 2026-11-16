/**
 * A leader pins their own shared entry to the top of 開放日記 (D36), where it stays, whatever month readers
 * look at, until the leader unpins it. Unsharing unpins it too. A former leader still sees the box to unpin.
 */
import { useState } from 'react';
import { ErrorCode, PIN_LIMITS } from '@diary/shared';
import { ApiError } from '../../api/client.js';
import { usePin } from '../../api/diary.js';
import { CheckboxRow } from '../../components/Field.js';
import { useToast } from '../../components/Toast.js';
import { useT } from '../../i18n/index.js';

export function PinToggle({
  documentId,
  pinned,
  shared,
}: {
  documentId: string;
  pinned: boolean;
  shared: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const pin = usePin(documentId);
  // The box follows the click at once; the server's answer (or a refusal) settles it.
  const [pending, setPending] = useState<boolean | null>(null);
  return (
    <CheckboxRow
      label={t('pin.label')}
      hint={shared || pinned ? t('pin.hint') : t('pin.notShared')}
      checked={pending ?? pinned}
      disabled={(!shared && !pinned) || pin.isPending}
      onChange={(e) => {
        const next = e.target.checked;
        setPending(next);
        pin.mutate(next, {
          onSuccess: () => toast.show(t(next ? 'pin.pinned' : 'pin.unpinned')),
          onError: (error) => {
            if (error instanceof ApiError && error.code === ErrorCode.LimitReached) {
              toast.show(t('pin.limit', { max: PIN_LIMITS.perLeader }));
            } else toast.showError(error);
          },
          onSettled: () => setPending(null),
        });
      }}
    />
  );
}
