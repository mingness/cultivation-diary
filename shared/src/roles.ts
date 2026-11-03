import { z } from 'zod';

/**
 * Account roles. Each account has exactly one (docs/project_prompt.md §2). COUNT_USER reaches 報數 and the
 * account page only (D30): it is what self-registration on the mantra site creates.
 */
export const Role = z.enum(['COUNT_USER', 'NORMAL_USER', 'COURSE_LEADER', 'SYS_ADMIN']);
export type Role = z.infer<typeof Role>;

/**
 * Whether a SYS_ADMIN may move an account from one role to another (D30). Roles only move up: a diary member
 * (NORMAL_USER, COURSE_LEADER) keeps entries a COUNT_USER could never reach, so they are never made one.
 * The last-SYS_ADMIN rule is separate, since it depends on the other accounts.
 */
export function canChangeRole(from: Role, to: Role): boolean {
  return !(to === 'COUNT_USER' && (from === 'NORMAL_USER' || from === 'COURSE_LEADER'));
}

/**
 * Who can read a diary entry besides its owner and the course leaders (§5.3). The author decides; a leader
 * may only take an entry back to private. `course` reaches the author's own class; `everyone` reaches every
 * signed-in user. There is only one class for now, so the two reach the same people, and only `course` can
 * be chosen (ShareScope); `everyone` is in the type so offering it later needs no migration.
 */
export const Access = z.enum(['private', 'course', 'everyone']);
export type Access = z.infer<typeof Access>;

/** The sharing levels an author can choose today. Add `everyone` here once there are several classes. */
export const ShareScope = z.enum(['course']);
export type ShareScope = z.infer<typeof ShareScope>;
