/**
 * The recorder sheet (FRONTEND.md §4.3, D35): it starts recording (as MP3, `mp3Recorder.ts`) as it opens, counts down from 2:00 and
 * stops itself at the limit; then 試聽 / 保留 / 重錄 / 捨棄. A recording not yet kept or discarded counts as
 * unsaved writing, so neither closing the sheet nor leaving the page drops it without asking.
 */
import { useEffect, useRef, useState } from 'react';
import { ENTRY_LIMITS } from '@diary/shared';
import { Button } from '../../components/Button.js';
import { Sheet } from '../../components/Dialog.js';
import { Icon } from '../../components/Icon.js';
import { Notice } from '../../components/Notice.js';
import { useI18n } from '../../i18n/index.js';
import { clock, noteLength } from '../../lib/recording.js';
import { useReportUnsaved } from '../../lib/unsaved.js';
import { AudioPlayer } from './AudioPlayer.js';
import {
  canRecord,
  MicrophoneDenied,
  startMp3Recording,
  unlockAudio,
  type Mp3Recording,
} from './mp3Recorder.js';
import styles from './VoiceNotes.module.css';

type Phase =
  | { kind: 'starting' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'recorded'; file: Blob; durationMs: number }
  | { kind: 'keeping'; file: Blob; durationMs: number }
  | { kind: 'failed'; reason: 'micDenied' | 'unsupported' | 'failed' };

/** What keeping a recording reported: nothing on success, else the words to show (the recording stays). */
export type KeepResult = { ok: true } | { ok: false; message: string; requestId: string | null };

export function VoiceRecorder({
  open,
  onClose,
  onKeep,
}: {
  open: boolean;
  onClose: () => void;
  onKeep: (file: Blob, durationMs: number) => Promise<KeepResult>;
}) {
  const { t } = useI18n();
  const [held, setHeld] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => {
    setHeld(false);
    setConfirmDiscard(false);
    onClose();
  };
  return (
    <Sheet
      open={open}
      title={t('voice.heading')}
      onClose={() => (held ? setConfirmDiscard(true) : close())}
    >
      {/* Mounted only while open, so each opening starts a fresh recording. */}
      {open && (
        <RecorderBody
          onClose={close}
          onKeep={onKeep}
          onHeld={setHeld}
          confirmDiscard={confirmDiscard}
          setConfirmDiscard={setConfirmDiscard}
        />
      )}
    </Sheet>
  );
}

function RecorderBody({
  onClose,
  onKeep,
  onHeld,
  confirmDiscard,
  setConfirmDiscard,
}: {
  onClose: () => void;
  onKeep: (file: Blob, durationMs: number) => Promise<KeepResult>;
  onHeld: (held: boolean) => void;
  confirmDiscard: boolean;
  setConfirmDiscard: (ask: boolean) => void;
}) {
  const { t } = useI18n();
  const [supported] = useState(canRecord);
  const [phase, setPhase] = useState<Phase>(
    supported ? { kind: 'starting' } : { kind: 'failed', reason: 'unsupported' },
  );
  const [now, setNow] = useState(() => performance.now());
  const [problem, setProblem] = useState<Extract<KeepResult, { ok: false }> | null>(null);
  const recording = useRef<Mp3Recording | null>(null);
  /**
   * Bumped whenever the sheet opens or closes, so a microphone granted to an earlier opening (the user took
   * a while to answer the prompt) is let go at once instead of recording unseen.
   */
  const run = useRef(0);

  const held = phase.kind === 'recording' || phase.kind === 'recorded' || phase.kind === 'keeping';
  useReportUnsaved(held);
  useEffect(() => onHeld(held), [held, onHeld]);

  /** From a button (a tap, which iPhones need before audio can start): start over. */
  function start() {
    setProblem(null);
    setConfirmDiscard(false);
    if (!supported) return;
    unlockAudio();
    setPhase({ kind: 'starting' });
    void record();
  }

  async function record() {
    const mine = run.current;
    let started: Mp3Recording;
    try {
      started = await startMp3Recording({
        maxMs: ENTRY_LIMITS.audioMs,
        // The countdown starts once the microphone has settled, not when it opens.
        onLive: () => {
          if (run.current !== mine) return;
          const startedAt = performance.now();
          setNow(startedAt);
          setPhase({ kind: 'recording', startedAt });
        },
        onFull: () => void stop(),
      });
    } catch (error) {
      if (run.current === mine) {
        setPhase({
          kind: 'failed',
          reason: error instanceof MicrophoneDenied ? 'micDenied' : 'failed',
        });
      }
      return;
    }
    if (run.current !== mine) {
      started.cancel();
      return;
    }
    recording.current = started;
  }

  async function stop() {
    const current = recording.current;
    if (!current) return;
    recording.current = null;
    const mine = run.current;
    const { file, durationMs } = await current.stop();
    if (run.current !== mine) return;
    if (file.size === 0 || durationMs < 1) setPhase({ kind: 'failed', reason: 'failed' });
    else setPhase({ kind: 'recorded', file, durationMs: noteLength(durationMs) });
  }

  // Start as the sheet opens (the 錄音 tap unlocked audio); stop the microphone if it closes mid-recording.
  useEffect(() => {
    run.current += 1;
    if (supported) void record();
    return () => {
      run.current += 1;
      recording.current?.cancel();
      recording.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, []);

  // The countdown. The recording itself stops at two minutes of sound (`onFull`).
  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  // The page's own leave warning while a recording is held.
  useEffect(() => {
    if (!held) return;
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [held]);

  async function keep(file: Blob, durationMs: number) {
    setPhase({ kind: 'keeping', file, durationMs });
    setProblem(null);
    const result = await onKeep(file, durationMs);
    if (result.ok) {
      setPhase({ kind: 'starting' });
      onClose();
    } else {
      setPhase({ kind: 'recorded', file, durationMs });
      setProblem(result);
    }
  }

  if (confirmDiscard) {
    return (
      <div className={styles.recorder}>
        <p className={styles.recorderStatus}>{t('voice.discardTitle')}</p>
        <div className={styles.recorderActions}>
          <Button onClick={() => setConfirmDiscard(false)}>{t('voice.keepRecording')}</Button>
          <Button variant="danger" onClick={onClose}>
            {t('voice.discard')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.recorder}>
      {phase.kind === 'starting' && <p className={styles.recorderStatus}>{t('voice.preparing')}</p>}

      {phase.kind === 'recording' && (
        <>
          <p className={styles.recorderStatus} role="timer">
            <span className={styles.dot} aria-hidden="true" />
            {t('voice.recording', {
              time: clock(ENTRY_LIMITS.audioMs - (now - phase.startedAt), { up: true }),
            })}
          </p>
          <div className={styles.recorderActions}>
            <Button variant="primary" onClick={() => void stop()}>
              <Icon name="stop" />
              {t('voice.stop')}
            </Button>
          </div>
        </>
      )}

      {(phase.kind === 'recorded' || phase.kind === 'keeping') && (
        <>
          <p className={styles.recorderStatus}>
            {t('voice.recorded', { time: clock(phase.durationMs, { up: true }) })}
          </p>
          <div className={styles.listen}>
            <span>{t('voice.listen')}</span>
            <AudioPlayer
              key={phase.file.size}
              label={t('voice.listen')}
              durationMs={phase.durationMs}
              load={() => Promise.resolve(phase.file)}
            />
          </div>
          {problem && (
            <Notice kind="warning" requestId={problem.requestId}>
              {problem.message} {t('voice.stillHere')}
            </Notice>
          )}
          <div className={styles.recorderActions}>
            <Button
              disabled={phase.kind === 'keeping'}
              onClick={() => setConfirmDiscard(true)}
              variant="quiet"
            >
              {t('voice.discard')}
            </Button>
            <Button disabled={phase.kind === 'keeping'} onClick={start}>
              {t('voice.redo')}
            </Button>
            <Button
              variant="primary"
              disabled={phase.kind === 'keeping'}
              onClick={() => void keep(phase.file, phase.durationMs)}
            >
              {phase.kind === 'keeping' ? t('voice.uploading') : t('voice.keep')}
            </Button>
          </div>
        </>
      )}

      {phase.kind === 'failed' && (
        <>
          <Notice kind={phase.reason === 'failed' ? 'error' : 'warning'}>
            {t(`voice.${phase.reason}`)}
          </Notice>
          {phase.reason !== 'unsupported' && (
            <div className={styles.recorderActions}>
              <Button variant="primary" onClick={start}>
                <Icon name="mic" />
                {t('voice.start')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
