import { DEFAULT_ROLE_TEMPLATES, defaultRoleEffects } from '@crm/shared';
import { staffRoles } from '../db/schema';

/**
 * The rows a consultancy's built-in roles start as. Inserted when a
 * consultancy is created (inside the same transaction), by the seeds, and by
 * migration 0007 for consultancies that already existed.
 */
export function defaultRoleRows(tenantId: string): (typeof staffRoles.$inferInsert)[] {
  return DEFAULT_ROLE_TEMPLATES.map((r) => ({
    tenantId,
    name: r.name,
    description: r.description,
    effects: defaultRoleEffects(r) as Record<string, string>,
    takesClients: r.takesClients,
    systemKey: r.key,
  }));
}
