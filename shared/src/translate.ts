/**
 * Translation (spec §8). The request names an entry or a comment, never free text: the server checks the caller
 * may read it and fetches the text itself, so the endpoint can't be used as a general-purpose LLM.
 */
import { z } from 'zod';

/** The language to translate into: the reader's interface language (D34). The source is detected. */
export const TranslateTarget = z.enum(['zh-Hant', 'en', 'vi']);
export type TranslateTarget = z.infer<typeof TranslateTarget>;

/**
 * The request field before D34: 翻譯 (English → 繁體中文) and Translate (繁體中文 → English). Accepted for one
 * release so an installed app that hasn't reloaded yet keeps working; remove it after that.
 * @deprecated use `target`
 */
export const TranslateDirection = z.enum(['en_to_zh', 'zh_to_en']);
export type TranslateDirection = z.infer<typeof TranslateDirection>;

const target = { target: TranslateTarget };
const direction = { direction: TranslateDirection };

export const TranslateRequest = z.union([
  z.object({ documentId: z.uuid(), ...target }).strict(),
  z.object({ commentId: z.uuid(), ...target }).strict(),
  z.object({ documentId: z.uuid(), ...direction }).strict(),
  z.object({ commentId: z.uuid(), ...direction }).strict(),
]);
export type TranslateRequest = z.infer<typeof TranslateRequest>;

/** The target a request asks for, whichever field it used. */
export function translateTarget(request: TranslateRequest): TranslateTarget {
  if ('target' in request) return request.target;
  return request.direction === 'en_to_zh' ? 'zh-Hant' : 'en';
}

/** Plain text: show it as text below the button, never as HTML (spec §8). */
export const TranslateResponse = z.object({ text: z.string() });
