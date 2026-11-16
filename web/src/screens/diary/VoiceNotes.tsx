/**
 * Voice notes in the editor (FRONTEND.md §4.3, D35): the entry's notes with their 待更新 marks, 刪除, and
 * for leaders the 錄音 button. Notes go up as soon as they're kept, but students hear them only after
 * 提交/更新, like the rest of the entry.
 */
import { useState } from 'react';
import type { z } from 'zod';
import { DAILY_LIMITS, ENTRY_LIMITS, ErrorCode, type OwnAudioNote } from '@diary/shared';
import { ApiError } from '../../api/client.js';
import { fetchAudio, useAddAudio, useRemoveAudio } from '../../api/audio.js';
import { Button } from '../../components/Button.js';
import { ConfirmButton } from '../../components/ConfirmButton.js';
import { Icon } from '../../components/Icon.js';
import { Notice } from '../../components/Notice.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { AudioPlayer, PendingMark } from './AudioPlayer.js';
import { unlockAudio } from './mp3Recorder.js';
import { VoiceRecorder, type KeepResult } from './VoiceRecorder.js';
import styles from './VoiceNotes.module.css';

type OwnNote = z.infer<typeof OwnAudioNote>;

export function EditorVoiceNotes({
  documentId,
  notes,
  canRecord,
  ensureEntry,
}: {
  /** Null for a new entry not saved yet. */
  documentId: string | null;
  notes: OwnNote[];
  /** Leaders only (D35); a former leader can still remove their old notes. */
  canRecord: boolean;
  /** Saves a new entry so a note has somewhere to go; the entry's ID, or null if that failed. */
  ensureEntry: () => Promise<string | null>;
}) {
  const { t, tError } = useI18n();
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<{ text: string; requestId: string | null } | null>(null);
  const add = useAddAudio();
  const remove = useRemoveAudio(documentId ?? '');

  // The cap counts what the entry will have after the next 更新, as the server does.
  const kept = notes.filter((n) => n.pending !== 'remove').length;
  const full = kept >= ENTRY_LIMITS.audioNotes;
  if (!canRecord && notes.length === 0) return null;

  function explain(error: unknown): { text: string; requestId: string | null } {
    const apiError = error instanceof ApiError ? error : null;
    if (apiError?.code === ErrorCode.LimitReached) {
      const limit = String(apiError.details.limit ?? '');
      if (limit === 'audioNotes') {
        return { text: t('limit.audioNotes', { max: ENTRY_LIMITS.audioNotes }), requestId: null };
      }
      if (limit === 'audio') {
        return {
          text: `${t('limit.audio', { max: DAILY_LIMITS.audio })} ${t('limit.resets')}`,
          requestId: null,
        };
      }
    }
    return {
      text: tError(apiError?.code ?? ErrorCode.Internal),
      requestId: apiError?.requestId ?? null,
    };
  }

  async function keep(file: Blob, durationMs: number): Promise<KeepResult> {
    const id = documentId ?? (await ensureEntry());
    if (!id) return { ok: false, message: tError(ErrorCode.Internal), requestId: null };
    try {
      await add.mutateAsync({ documentId: id, file, durationMs });
      toast.show(t('voice.kept'));
      return { ok: true };
    } catch (error) {
      const { text, requestId } = explain(error);
      return { ok: false, message: text, requestId };
    }
  }

  return (
    <section className={styles.section} aria-labelledby="voice-heading">
      <h2 id="voice-heading" className={styles.heading}>
        {t('voice.heading')}
      </h2>
      {notes.length > 0 && documentId && (
        <ul className={styles.list}>
          {notes.map((note, i) => (
            <li key={note.id} className={styles.item}>
              <AudioPlayer
                label={t('voice.note', { n: i + 1 })}
                durationMs={note.durationMs}
                load={() => fetchAudio(documentId, note.id)}
              />
              <PendingMark mark={note.pending} />
              {note.pending !== 'remove' && (
                <ConfirmButton
                  small
                  label={
                    <>
                      <Icon name="trash" />
                      <span className="visually-hidden">
                        {t('voice.remove')} {t('voice.note', { n: i + 1 })}
                      </span>
                    </>
                  }
                  confirmLabel={t('voice.remove')}
                  title={t('voice.removeTitle')}
                  body={t('voice.removeBody')}
                  disabled={remove.isPending}
                  onConfirm={() => {
                    setProblem(null);
                    remove.mutate(note.id, { onError: (e) => setProblem(explain(e)) });
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canRecord && (
        <div className={styles.recordRow}>
          <Button
            disabled={full}
            aria-describedby={full ? 'voice-full' : undefined}
            onClick={() => {
              setProblem(null);
              unlockAudio();
              setRecording(true);
            }}
          >
            <Icon name="mic" />
            {t('voice.record')}
          </Button>
          {full && (
            <span id="voice-full" className={styles.help}>
              {t('voice.limit', { max: ENTRY_LIMITS.audioNotes })}
            </span>
          )}
        </div>
      )}
      {problem && (
        <Notice kind="warning" requestId={problem.requestId}>
          {problem.text}
        </Notice>
      )}
      <VoiceRecorder open={recording} onClose={() => setRecording(false)} onKeep={keep} />
    </section>
  );
}
