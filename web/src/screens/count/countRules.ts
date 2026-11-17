/** The 報數 form's rules as pure functions (spec §7.2), so they can be tested exactly. */
import {
  COUNT_LIMITS,
  RECITATION_GOAL_MAX,
  type CountNotice,
  type CountSummary,
  type Recitation,
} from '@diary/shared';
import type { z } from 'zod';
import type { MessageKey } from '../../i18n/index.js';

type Mine = z.infer<typeof CountSummary>['mine'][number];

export interface DateState {
  /** The number already reported for the date (a new report replaces it), or null. */
  existing: number | null;
  /** The per-date limit of manual reports has been reached (spec §7.2: 20). */
  atLimit: boolean;
}

export function dateState(mine: readonly Mine[], countDate: string): DateState {
  const found = mine.find((m) => m.countDate === countDate);
  return {
    existing: found?.count ?? null,
    atLimit: (found?.manualReports ?? 0) >= COUNT_LIMITS.manualPerCountDate,
  };
}

const NOTICE: Record<CountNotice, MessageKey> = {
  non_digits_removed: 'count.notice.non_digits_removed',
  clamped_to_max: 'count.notice.clamped_to_max',
  clamped_to_min: 'count.notice.clamped_to_min',
};

/** Message keys for what normalising changed, in the order it happened. */
export function noticeKeys(notices: readonly CountNotice[]): MessageKey[] {
  return notices.map((n) => NOTICE[n]);
}

/**
 * The recitation form's goal box (spec §7.5): empty means no goal; otherwise a whole number from 1 to the
 * maximum. Spaces, thousands separators and full-width digits (Chinese input methods) are accepted.
 */
export function parseGoal(raw: string): number | null | 'invalid' {
  const text = raw
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[\s,，.、']/g, '');
  if (text === '') return null;
  if (!/^\d+$/.test(text) || text.length > String(RECITATION_GOAL_MAX).length) return 'invalid';
  const n = Number(text);
  return n >= 1 && n <= RECITATION_GOAL_MAX ? n : 'invalid';
}

/** The string-table key naming a recitation; the type check fails if a language lacks one. */
export const recitationKey = (r: Recitation): MessageKey => `recitation.${r}`;
