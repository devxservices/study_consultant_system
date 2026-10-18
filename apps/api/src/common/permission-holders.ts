import { sql } from 'drizzle-orm';
import { PERMISSION_META, type Permission } from '@crm/shared';
import type { Db } from '../db/connection';

/**
 * Everyone in a consultancy who holds a permission right now: its active
 * managers, and its active consultants whose resolved permissions include it
 * - their own override, else their role's, else the consultancy's default,
 * else the built-in default. The same four layers sign-in resolves, in one
 * query, for deciding who to tell ("a payment is waiting to be checked").
 */
export async function permissionHolders(
  db: Pick<Db, 'execute'>,
  tenantId: string,
  permission: Permission,
  opts: { exclude?: string | null } = {},
): Promise<string[]> {
  const fallback = PERMISSION_META[permission].consultantDefault;
  const result = await db.execute<{ id: string }>(sql`
    select u.id
    from users u
    left join staff_roles sr on sr.id = u.staff_role_id
    where u.tenant_id = ${tenantId}
      and u.is_active
      and (
        u.role = 'manager'
        or (u.role = 'consultant' and coalesce(
          (select up.effect = 'allow' from user_permissions up where up.user_id = u.id and up.permission = ${permission}),
          (case when sr.effects ? ${permission} then sr.effects ->> ${permission} = 'allow' end),
          (select rp.effect = 'allow' from role_permissions rp
            where rp.tenant_id = u.tenant_id and rp.role = 'consultant' and rp.permission = ${permission}),
          ${fallback}
        ))
      )
    order by u.role desc, u.created_at
  `);
  const rows = (result as unknown as { rows?: { id: string }[] }).rows ?? (result as unknown as { id: string }[]);
  return rows.map((r) => r.id).filter((id) => id !== opts.exclude);
}
