/**
 * One compact player per voice note (FRONTEND.md §4.4): play/pause and elapsed / length. The recording is
 * downloaded only when play is first pressed, kept in memory while the player is on screen, and never
 * cached to disk (the server sends it `no-store`).
 */
import { useEffect, useRef, useState } from 'react';
import type { AudioNote } from '@diary/shared';
import { ApiError } from '../../api/client.js';
import { fetchAudio } from '../../api/audio.js';
import { Button } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { useI18n } from '../../i18n/index.js';
import { clock } from '../../lib/recording.js';
import styles from './VoiceNotes.module.css';

/** A play button for a local recording (the recorder's 試聽) or a saved note. */
export function AudioPlayer({
  label,
  durationMs,
  load,
}: {
  /** Names the note for screen readers ("第 2 段錄音"). */
  label: string;
  durationMs: number;
  /** Gets the recording the first time play is pressed. */
  load: () => Promise<Blob>;
}) {
  const { t, tError } = useI18n();
  const audio = useRef<HTMLAudioElement>(null);
  const url = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (playing) {
      element.pause();
      return;
    }
    setError(null);
    try {
      if (!url.current) {
        setLoading(true);
        url.current = URL.createObjectURL(await load());
        element.src = url.current;
      }
      await element.play();
    } catch (e) {
      setError(e instanceof ApiError ? tError(e.code) : t('voice.playFailed'));
    } finally {
      setLoading(false);
    }
  }

  const name = loading ? t('voice.loading') : t(playing ? 'voice.pause' : 'voice.play');
  return (
    <span className={styles.player}>
      <Button
        small
        variant="secondary"
        aria-label={`${name} ${label}`}
        disabled={loading}
        onClick={() => void toggle()}
      >
        <Icon name={playing ? 'pause' : 'play'} />
      </Button>
      <span className={styles.time}>
        {clock(elapsed)} / {clock(durationMs, { up: true })}
      </span>
      {error && <span className={styles.error}>{error}</span>}
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime * 1000)}
      />
    </span>
  );
}

/** A note's mark beside its player: 待更新 for one kept since the last 更新, or one to be removed by it. */
export type NoteMark = 'add' | 'remove' | null;

/** The notes of an entry as a reader sees them, under the body. */
export function VoiceNoteList({
  documentId,
  notes,
}: {
  documentId: string;
  notes: (AudioNote & { pending?: NoteMark })[];
}) {
  const { t } = useI18n();
  if (notes.length === 0) return null;
  return (
    <ul className={styles.list} aria-label={t('voice.heading')}>
      {notes.map((note, i) => (
        <li key={note.id} className={styles.item}>
          <AudioPlayer
            label={t('voice.note', { n: i + 1 })}
            durationMs={note.durationMs}
            load={() => fetchAudio(documentId, note.id)}
          />
          <PendingMark mark={note.pending ?? null} />
        </li>
      ))}
    </ul>
  );
}

export function PendingMark({ mark }: { mark: NoteMark }) {
  const { t } = useI18n();
  if (!mark) return null;
  return (
    <span className={styles.mark}>
      {t(mark === 'add' ? 'voice.pending' : 'voice.pendingRemove')}
    </span>
  );
}
