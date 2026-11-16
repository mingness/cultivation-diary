/** Where sign-in lands (spec §4.1): the role's home. */
import type { Role } from '@diary/shared';

const HOME: Record<Role, string> = {
  NORMAL_USER: '/diary',
  COURSE_LEADER: '/review',
  SYS_ADMIN: '/admin',
};

/** The home page for this role. */
export function landingPath(role: Role): string {
  return HOME[role];
}
