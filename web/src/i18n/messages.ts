/**
 * The typed key set and the pure lookup behind `useT()`. Kept free of React so it can be unit-tested.
 */
import type { ErrorCode } from '@diary/shared';
import type { NETWORK_ERROR } from '../api/client.js';
import { zhHant } from './zh-Hant.js';

export type MessageKey = keyof typeof zhHant;
export type Messages = Record<MessageKey, string>;
/** Every language with a string table. */
export const LANGS = ['zh-Hant', 'en', 'vi'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * The languages the switch offers. A language with a table can be left out of this list while its wording
 * waits for review; `?lang=` still opens it on that device (ARCHITECTURE.md §8.10). Vietnamese is offered
 * ahead of its review (D34, changed 2026-11-14).
 */
export const OFFERED_LANGS: readonly Lang[] = ['zh-Hant', 'en', 'vi'];

/** The locale for dates and numbers in each language. */
export const LOCALES: Record<Lang, string> = { 'zh-Hant': 'zh-Hant-TW', en: 'en-GB', vi: 'vi-VN' };

/** `value` as a language, or null if it isn't one. */
export function parseLang(value: string | null | undefined): Lang | null {
  return LANGS.find((lang) => lang === value) ?? null;
}

/**
 * The switch's buttons: the offered languages, plus the one in use and the one this device previewed with
 * `?lang=` when they aren't offered, so a reviewer can switch away to compare and back again.
 */
export function switchOptions(
  current: Lang,
  preview: Lang | null,
  offered: readonly Lang[] = OFFERED_LANGS,
): Lang[] {
  const options = [...offered];
  for (const extra of [preview, current]) {
    if (extra && !options.includes(extra)) options.push(extra);
  }
  return options;
}

// Every error code the server can send needs words in the table; this line fails the type check otherwise.
type ErrorKeys = `error.${ErrorCode | typeof NETWORK_ERROR}`;
const _everyErrorCodeTranslated: Record<ErrorKeys, string> = zhHant;
void _everyErrorCodeTranslated;

export type Vars = Readonly<Record<string, string | number>>;

/** Looks up `key` and fills `{name}` placeholders; an unknown placeholder is left as written. */
export function format(messages: Messages, key: MessageKey, vars: Vars = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** The message for an API error code. Codes the app doesn't know yet read as a generic server error. */
export function errorKey(code: string): MessageKey {
  const key = `error.${code}`;
  return key in zhHant ? (key as MessageKey) : 'error.internal_error';
}
