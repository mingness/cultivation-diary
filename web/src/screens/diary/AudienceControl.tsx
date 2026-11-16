/**
 * 誰可以閱讀 (D37): one choice for who reads an entry, in the editor and on the owner's entry. 只有我 keeps it to
 * the author; 導師 sends it (the first 提交), so leaders read and comment; 導師和同班學員 also shares it with the
 * class (spec §5.3). Each change takes effect at once. Sending, sharing and going back to 只有我 ask first;
 * going back is refused once someone else has commented, since it is a conversation by then.
 */
import { useId, useState } from 'react';
import type { Access } from '@diary/shared';
import { useAccessChangeOf, useWithdraw } from '../../api/diary.js';
import { useSession } from '../../api/session.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/Dialog.js';
import { useToast } from '../../components/Toast.js';
import { useT, type MessageKey } from '../../i18n/index.js';
import styles from './AudienceControl.module.css';

export type Audience = 'me' | 'leaders' | 'class';

export function audienceOf(sent: boolean, access: Access): Audience {
  if (!sent) return 'me';
  return access === 'private' ? 'leaders' : 'class';
}

type Confirming = 'send' | 'sendShare' | 'share' | 'back' | null;

export function AudienceControl({
  documentId,
  sent,
  access,
  unsharedByLeader,
  hasComments,
  canSend,
  send,
}: {
  /** Null for a new entry not saved yet; `send` saves it first. */
  documentId: string | null;
  /** Leaders have it (submitted at least once). */
  sent: boolean;
  access: Access;
  unsharedByLeader: boolean;
  /** Someone else has sent a comment, so it can't go back to 只有我. */
  hasComments: boolean;
  /** Whether the writing can be sent now (e.g. within the length limit). */
  canSend: boolean;
  /**
   * The first 提交 of the writing as it stands; resolves to the entry's ID, or null if it didn't go (the
   * caller has said why). `quiet` leaves the notice to this control, when a share follows.
   */
  send: (options: { quiet: boolean }) => Promise<string | null>;
}) {
  const t = useT();
  const toast = useToast();
  const name = useId();
  const { data: session } = useSession();
  const isLeader = session?.status === 'ready' && session.me.role === 'COURSE_LEADER';
  const id = documentId ?? '';
  const accessChange = useAccessChangeOf();
  const withdraw = useWithdraw(id);
  const [confirming, setConfirming] = useState<Confirming>(null);
  // The choice follows the tap at once; the server's answer (or a refusal) settles it.
  const [pending, setPending] = useState<Audience | null>(null);
  const busy = accessChange.isPending || withdraw.isPending || pending !== null;

  const current = audienceOf(sent, access);
  const shown = pending ?? current;
  const settle = () => setPending(null);

  const share = (entryId: string) =>
    accessChange.mutate(
      { id: entryId, change: { action: 'share', scope: 'course' } },
      {
        onSuccess: () => toast.show(t('audience.classDone')),
        onError: toast.showError,
        onSettled: settle,
      },
    );

  function choose(target: Audience) {
    if (target === current || busy) return;
    if (target === 'me') return setConfirming('back');
    if (target === 'class') return setConfirming(current === 'me' ? 'sendShare' : 'share');
    if (current === 'me') return setConfirming('send');
    // From the class back to leaders only: nothing to confirm, as with unticking the old share box.
    setPending('leaders');
    accessChange.mutate(
      { id, change: { action: 'unshare' } },
      {
        onSuccess: () => toast.show(t('audience.leadersDone')),
        onError: toast.showError,
        onSettled: settle,
      },
    );
  }

  async function confirm() {
    const what = confirming;
    setConfirming(null);
    if (what === 'send' || what === 'sendShare') {
      setPending(what === 'send' ? 'leaders' : 'class');
      const newId = await send({ quiet: what === 'sendShare' });
      if (newId && what === 'sendShare') return share(newId);
      return settle();
    }
    if (what === 'share') {
      setPending('class');
      return share(id);
    }
    if (what === 'back') {
      setPending('me');
      withdraw.mutate(undefined, {
        onSuccess: () => toast.show(t('audience.backDone')),
        onError: toast.showError,
        onSettled: settle,
      });
    }
  }

  const options: { value: Audience; label: MessageKey; disabled: boolean }[] = [
    { value: 'me', label: 'audience.me', disabled: sent && hasComments },
    {
      value: 'leaders',
      label: isLeader ? 'audience.otherLeaders' : 'audience.leaders',
      disabled: current === 'me' && !canSend,
    },
    {
      value: 'class',
      label: 'audience.class',
      disabled: (current === 'me' && !canSend) || (unsharedByLeader && current !== 'class'),
    },
  ];
  const hint: MessageKey =
    shown === 'me'
      ? 'audience.meHint'
      : shown === 'class'
        ? 'audience.classHint'
        : isLeader
          ? 'audience.otherLeadersHint'
          : 'audience.leadersHint';
  const hintId = `${name}-hint`;

  const dialog: Record<
    Exclude<Confirming, null>,
    { title: MessageKey; body: MessageKey; ok: MessageKey }
  > = {
    send: {
      title: isLeader ? 'audience.sendTitleLeader' : 'audience.sendTitle',
      body: 'audience.sendBody',
      ok: 'audience.send',
    },
    sendShare: { title: 'share.confirmTitle', body: 'share.confirmBody', ok: 'share.confirm' },
    share: { title: 'share.confirmTitle', body: 'share.confirmBody', ok: 'share.confirm' },
    back: { title: 'audience.backTitle', body: 'audience.backBody', ok: 'audience.back' },
  };
  const open = confirming ? dialog[confirming] : null;

  return (
    <>
      <fieldset className={styles.group} aria-describedby={hintId}>
        <legend className={styles.legend}>{t('audience.label')}</legend>
        <div className={styles.options}>
          {options.map((option) => (
            <label key={option.value} className={styles.option}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={shown === option.value}
                disabled={option.disabled || busy}
                onChange={() => choose(option.value)}
              />
              <span>{t(option.label)}</span>
            </label>
          ))}
        </div>
        <div id={hintId} className={styles.hints}>
          <span>{t(hint)}</span>
          {sent && hasComments && <span>{t('audience.meLocked')}</span>}
          {unsharedByLeader && current !== 'class' && <span>{t('share.unsharedByLeader')}</span>}
        </div>
      </fieldset>
      <ConfirmDialog
        open={open !== null}
        title={open ? t(open.title) : ''}
        onCancel={() => setConfirming(null)}
        actions={
          <>
            <Button onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={() => void confirm()}>
              {open ? t(open.ok) : ''}
            </Button>
          </>
        }
      >
        {open && <p>{t(open.body)}</p>}
      </ConfirmDialog>
    </>
  );
}
