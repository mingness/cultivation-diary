/**
 * The editor's rules as pure functions, so they can be tested exactly (spec §5.2, §5.5; ARCHITECTURE §8.3).
 */
import { ENTRY_LIMITS } from '@diary/shared';

export interface ButtonInput {
  /** The editor differs from what was last saved. */
  dirty: boolean;
  /** A save or send is in flight. */
  busy: boolean;
  /** Leaders have the entry (it was submitted at least once), so changes wait for 發佈修改. */
  submittedOnce: boolean;
  /** Saved changes readers haven't seen yet (the server's `draft`, or pending voice notes). */
  pendingDraft: boolean;
  /** Visible characters, whitespace excluded. */
  chars: number;
}

export type SubmitBlock = 'unchanged' | 'tooLong' | null;

export interface Buttons {
  /** 儲存, or once sent 儲存，暫不發佈. */
  save: boolean;
  saveLabel: 'save' | 'saveForLater';
  /** 發佈修改: only once sent (null hides it); the first send is a 誰可以閱讀 choice instead (D37). */
  publish: boolean | null;
  /** Why 發佈修改 is off when there is something to publish. */
  publishBlockedBy: SubmitBlock;
  /** Whether choosing leaders or the class can send the writing now. */
  canSend: boolean;
}

/**
 * Saving is on while there are unsaved changes. Before an entry is sent, saving is all there is: whatever is
 * saved is only the author's. Once sent, saving keeps changes for later and 發佈修改 shows them to readers; it is
 * on while there is anything they haven't seen and the entry is within the length limit. A draft over the
 * limit still saves, so writing is never lost.
 */
export function editorButtons(input: ButtonInput): Buttons {
  const hasNews = input.dirty || input.pendingDraft;
  const tooLong = input.chars > ENTRY_LIMITS.chars;
  return {
    save: input.dirty && !input.busy,
    saveLabel: input.submittedOnce ? 'saveForLater' : 'save',
    publish: input.submittedOnce ? hasNews && !tooLong && !input.busy : null,
    publishBlockedBy: input.submittedOnce && hasNews && tooLong ? 'tooLong' : null,
    canSend: !tooLong && !input.busy,
  };
}

export type CounterTone = 'hidden' | 'quiet' | 'near' | 'over';

/** The length counter appears from 4,000 characters and turns amber near the limit; never red (FRONTEND §4.3). */
export function counterTone(chars: number): CounterTone {
  if (chars < ENTRY_LIMITS.charsCounterFrom) return 'hidden';
  if (chars > ENTRY_LIMITS.chars) return 'over';
  if (chars >= ENTRY_LIMITS.chars * 0.95) return 'near';
  return 'quiet';
}

/** Photos over this size or long edge are made smaller before they're inserted (ARCHITECTURE §8.3). */
export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_TARGET_BYTES = 500_000;
/** JPEG qualities tried in turn until the photo is under the target size. */
export const IMAGE_QUALITIES = [0.8, 0.7, 0.6] as const;

/**
 * The size a photo is drawn at. Every photo is re-encoded, even a small one, because that is what removes its
 * metadata (location included); only large ones are scaled down.
 */
export function plannedSize(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= IMAGE_MAX_EDGE) return { width, height };
  const scale = IMAGE_MAX_EDGE / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
