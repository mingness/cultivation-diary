/**
 * Where sign-in lands (spec §4.1): on the diary site, the role's diary home; on the mantra site (D31), the
 * 報數 page. A COUNT_USER has no diary, so they land on 報數 either way.
 */
import type { Role } from '@diary/shared';
import { SITE, type Site } from '../site.js';

const DIARY_HOME: Record<Role, string> = {
  COUNT_USER: '/count',
  NORMAL_USER: '/diary',
  COURSE_LEADER: '/review',
  SYS_ADMIN: '/admin',
};

/** The home page for this role on this site. */
export function landingPath(role: Role, site: Site = SITE): string {
  return site === 'mantra' ? '/count' : DIARY_HOME[role];
}
