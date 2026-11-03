/**
 * Which site this build is (docs/ARCHITECTURE.md §8.11, D31): the diary, or the mantra site, which has only
 * 報數 and the account page, plus registration. Set at build time by Vite's mode (web/vite.config.ts), so the
 * other site's screens are left out of the bundle; tests run as the diary.
 */
import type { MessageKey } from './i18n/index.js';

export type Site = 'diary' | 'mantra';

export const SITE: Site = import.meta.env.VITE_SITE === 'mantra' ? 'mantra' : 'diary';

/** The site's name, for the header and sign-in screens. */
export const SITE_TITLE: MessageKey = SITE === 'mantra' ? 'app.titleMantra' : 'app.title';
