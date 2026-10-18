import type { AuthUser, Module } from '@crm/shared';
import { can } from './permissions';
import { hasWorkspace } from '@/components/finance/workspace';

/**
 * Where a member of staff starts. Someone with a caseload starts on the
 * caseload dashboard; an accountant or a trainer (a role that takes no
 * clients) starts on their own work instead of a dashboard of empty
 * caseload figures.
 */
export function deskHome(user: AuthUser, modules: Set<Module>): '/desk' | '/desk/finance' | '/desk/courses' {
  if (user.takesClients) return '/desk';
  if (modules.has('billing') && hasWorkspace(user)) return '/desk/finance';
  if (can(user, 'course.teach') || can(user, 'course.view')) return '/desk/courses';
  return '/desk';
}
