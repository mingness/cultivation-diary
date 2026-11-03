/**
 * Where sign-in lands (spec §4.1): the 報數 page, or the role's diary home. The choice is remembered on the
 * device, and 報數 is the default. A COUNT_USER has no diary, so both choices land on 報數.
 */
import type { Role } from '@diary/shared';
import { SITE, type Site } from '../site.js';
import { readPref, writePref } from './storage.js';

export type Destination = 'diary' | 'count';

const DIARY_HOME: Record<Role, string> = {
  COUNT_USER: '/count',
  NORMAL_USER: '/diary',
  COURSE_LEADER: '/review',
  SYS_ADMIN: '/admin',
};

/** The mantra site (D31) has nothing but 報數 to land on. */
export function landingPath(role: Role, destination: Destination, site: Site = SITE): string {
  return destination === 'count' || site === 'mantra' ? '/count' : DIARY_HOME[role];
}

export function rememberedDestination(): Destination {
  return readPref('destination') === 'diary' ? 'diary' : 'count';
}

export function rememberDestination(destination: Destination): void {
  writePref('destination', destination);
}
