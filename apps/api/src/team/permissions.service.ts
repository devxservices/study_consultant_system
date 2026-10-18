import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  PERMISSIONS,
  PERMISSION_META,
  isPermission,
  resolvePermissions,
  type AuthUser,
  type RoleTemplateInput,
  type RoleTemplateView,
  type ConsultancyDefaults,
  type MemberPermissions,
  type Permission,
  type PermissionChoice,
  type PermissionEffect,
  type Role,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { rolePermissions, staffRoles, userPermissions, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { isUniqueViolation } from '../common/db-helpers';
import { defaultRoleRows } from './default-roles';

type EffectMap = Partial<Record<Permission, PermissionEffect>>;

/** [permission, effect] pairs as the database hands them back (json_agg), or null for none. */
export type EffectPairs = [string, string][] | string | null | undefined;

function toEffectMap(pairs: EffectPairs): EffectMap {
  const list = typeof pairs === 'string' ? (JSON.parse(pairs) as [string, string][]) : (pairs ?? []);
  const map: EffectMap = {};
  for (const [permission, effect] of list) {
    if (isPermission(permission) && (effect === 'allow' || effect === 'deny')) map[permission] = effect;
  }
  return map;
}

/**
 * Per-member permissions: three layers, most specific first.
 *
 *   1. the member's own allow or deny, if a manager set one;
 *   2. the consultancy's default for consultants, if it set one;
 *   3. the built-in default in @crm/shared.
 *
 * Managers are the consultancy's owners and always hold everything, so their
 * access can never be switched off - by anyone, including themselves.
 * Resolved on every request (it is part of loading the signed-in user), so a
 * change takes effect on the member's very next click, not at next sign-in.
 */
@Injectable()
export class PermissionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * The effective set for one person, from the consultancy's defaults and
   * their own overrides as [permission, effect] pairs. The signed-in user is
   * loaded on every request, so those pairs arrive in that same query (see
   * AuthService.loadUser) instead of costing two more round trips.
   */
  fromEffects(
    tenantId: string | null,
    role: Role,
    consultancy: EffectPairs,
    member: EffectPairs,
    roleEffects?: Record<string, string> | null,
  ): Permission[] {
    if (role === 'manager') return [...PERMISSIONS];
    if (role !== 'consultant' || !tenantId) return [];
    return resolvePermissions(
      toEffectMap(consultancy),
      toEffectMap(member),
      toEffectMap(Object.entries(roleEffects ?? {})),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Reading, for the manager's screens                                */
  /* ---------------------------------------------------------------- */

  async member(actor: AuthUser, userId: string): Promise<MemberPermissions> {
    const tenantId = tenantOf(actor);
    const target = await this.staffMember(tenantId, userId);
    const fixed = target.role === 'manager';
    const [defaults, overrides, roleRow] = await Promise.all([
      this.consultancyMap(tenantId),
      fixed ? Promise.resolve({} as EffectMap) : this.memberMap(tenantId, userId),
      fixed || !target.staffRoleId ? Promise.resolve(null) : this.roleRow(tenantId, target.staffRoleId),
    ]);
    const fromRole = toEffectMap(Object.entries(roleRow?.effects ?? {}));

    return {
      userId: target.id,
      name: target.fullName,
      email: target.email,
      role: target.role as 'manager' | 'consultant',
      active: target.isActive,
      fixed,
      roleId: roleRow?.id ?? null,
      roleName: roleRow?.name ?? null,
      rows: PERMISSIONS.map((key) => {
        // What they would have without their own override: their role, then
        // the consultancy's default, then the built-in one.
        const inherited = fromRole[key]
          ? fromRole[key] === 'allow'
          : defaults[key]
            ? defaults[key] === 'allow'
            : PERMISSION_META[key].consultantDefault;
        const own = overrides[key] ?? null;
        if (fixed) return { key, allowed: true, source: 'default' as const, override: null, inherited: true };
        return {
          key,
          allowed: own ? own === 'allow' : inherited,
          source: own
            ? ('member' as const)
            : fromRole[key]
              ? ('role' as const)
              : defaults[key]
                ? ('consultancy' as const)
                : ('default' as const),
          override: own,
          inherited,
        };
      }),
    };
  }

  async consultancyDefaults(actor: AuthUser): Promise<ConsultancyDefaults> {
    const defaults = await this.consultancyMap(tenantOf(actor));
    return {
      rows: PERMISSIONS.map((key) => ({
        key,
        allowed: defaults[key] ? defaults[key] === 'allow' : PERMISSION_META[key].consultantDefault,
        source: defaults[key] ? ('consultancy' as const) : ('default' as const),
      })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Changing - managers only, every change audited                    */
  /* ---------------------------------------------------------------- */

  async setMember(
    actor: AuthUser,
    userId: string,
    changes: Partial<Record<Permission, PermissionChoice>>,
  ): Promise<MemberPermissions> {
    const tenantId = tenantOf(actor);
    const target = await this.staffMember(tenantId, userId);
    if (target.role === 'manager') {
      throw new BadRequestException(
        'Managers own the consultancy and always have every permission. Their access cannot be restricted.',
      );
    }

    const before = await this.member(actor, userId);
    const now = new Date();
    for (const [key, choice] of Object.entries(changes)) {
      if (!isPermission(key) || !choice) continue;
      const current = before.rows.find((r) => r.key === key)!.override;
      const next = choice === 'inherit' ? null : choice;
      if (current === next) continue;

      if (next === null) {
        await this.db
          .delete(userPermissions)
          .where(and(eq(userPermissions.userId, userId), eq(userPermissions.permission, key)));
      } else {
        await this.db
          .insert(userPermissions)
          .values({ tenantId, userId, permission: key, effect: next, updatedBy: actor.id, updatedAt: now })
          .onConflictDoUpdate({
            target: [userPermissions.userId, userPermissions.permission],
            set: { effect: next, updatedBy: actor.id, updatedAt: now },
          });
      }

      await this.audit.record(actor, {
        action: 'permission.changed',
        entityType: 'permission',
        entityId: userId,
        metadata: {
          scope: 'member',
          memberId: userId,
          memberName: target.fullName,
          permission: key,
          label: PERMISSION_META[key].label,
          from: current ?? 'default',
          to: next ?? 'default',
        },
      });
    }
    return this.member(actor, userId);
  }

  async setConsultancyDefaults(
    actor: AuthUser,
    changes: Partial<Record<Permission, PermissionChoice>>,
  ): Promise<ConsultancyDefaults> {
    const tenantId = tenantOf(actor);
    const current = await this.consultancyMap(tenantId);
    const now = new Date();
    for (const [key, choice] of Object.entries(changes)) {
      if (!isPermission(key) || !choice) continue;
      const was = current[key] ?? null;
      const next = choice === 'inherit' ? null : choice;
      if (was === next) continue;

      if (next === null) {
        await this.db
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.tenantId, tenantId),
              eq(rolePermissions.role, 'consultant'),
              eq(rolePermissions.permission, key),
            ),
          );
      } else {
        await this.db
          .insert(rolePermissions)
          .values({ tenantId, role: 'consultant', permission: key, effect: next, updatedBy: actor.id, updatedAt: now })
          .onConflictDoUpdate({
            target: [rolePermissions.tenantId, rolePermissions.role, rolePermissions.permission],
            set: { effect: next, updatedBy: actor.id, updatedAt: now },
          });
      }

      await this.audit.record(actor, {
        action: 'permission.changed',
        entityType: 'permission',
        metadata: {
          scope: 'consultancy',
          role: 'consultant',
          permission: key,
          label: PERMISSION_META[key].label,
          from: was ?? 'default',
          to: next ?? 'default',
        },
      });
    }
    return this.consultancyDefaults(actor);
  }

  /* ---------------------------------------------------------------- */
  /* Roles                                                             */
  /* ---------------------------------------------------------------- */

  async roles(actor: AuthUser): Promise<RoleTemplateView[]> {
    const tenantId = tenantOf(actor);
    const rows = await this.db
      .select({
        id: staffRoles.id,
        name: staffRoles.name,
        description: staffRoles.description,
        effects: staffRoles.effects,
        takesClients: staffRoles.takesClients,
        systemKey: staffRoles.systemKey,
        // Named in full: unqualified, the subquery's own users.id would answer.
        members: sql<number>`(select count(*)::int from users u where u.staff_role_id = "staff_roles"."id" and u.is_active)`,
      })
      .from(staffRoles)
      .where(eq(staffRoles.tenantId, tenantId))
      .orderBy(asc(sql`lower(${staffRoles.name})`));
    return rows.map((r) => ({
      ...r,
      effects: toEffectMap(Object.entries(r.effects ?? {})),
      members: Number(r.members),
    }));
  }

  async saveRole(actor: AuthUser, input: RoleTemplateInput, id?: string): Promise<RoleTemplateView> {
    const tenantId = tenantOf(actor);
    const effects = toEffectMap(Object.entries(input.effects ?? {}));
    const values = {
      name: input.name,
      description: input.description ?? null,
      effects: effects as Record<string, string>,
      takesClients: input.takesClients,
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    let saved: { id: string } | undefined;
    try {
      if (id) {
        [saved] = await this.db
          .update(staffRoles)
          .set(values)
          .where(and(eq(staffRoles.id, id), eq(staffRoles.tenantId, tenantId)))
          .returning({ id: staffRoles.id });
      } else {
        [saved] = await this.db
          .insert(staffRoles)
          .values({ tenantId, ...values })
          .returning({ id: staffRoles.id });
      }
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BadRequestException({
          message: 'There is already a role with that name.',
          fieldErrors: { name: 'Pick another name.' },
        });
      }
      throw err;
    }
    if (!saved) throw new NotFoundException('Role not found.');
    await this.audit.record(actor, {
      action: 'role.saved',
      entityType: 'role',
      entityId: saved.id,
      metadata: { name: input.name, takesClients: input.takesClients, effects },
    });
    return (await this.roles(actor)).find((r) => r.id === saved!.id)!;
  }

  /** Removing a role leaves its members on the consultancy's defaults; nothing else changes. */
  async deleteRole(actor: AuthUser, id: string): Promise<void> {
    const tenantId = tenantOf(actor);
    const [row] = await this.db
      .delete(staffRoles)
      .where(and(eq(staffRoles.id, id), eq(staffRoles.tenantId, tenantId)))
      .returning({ name: staffRoles.name });
    if (!row) throw new NotFoundException('Role not found.');
    await this.audit.record(actor, {
      action: 'role.deleted',
      entityType: 'role',
      entityId: id,
      metadata: { name: row.name },
    });
  }

  async assignRole(actor: AuthUser, userId: string, roleId: string | null): Promise<MemberPermissions> {
    const tenantId = tenantOf(actor);
    const target = await this.staffMember(tenantId, userId);
    if (target.role === 'manager') {
      throw new BadRequestException(
        'Managers own the consultancy and always have every permission. They take no role.',
      );
    }
    const to = roleId ? await this.roleRow(tenantId, roleId) : null;
    if (roleId && !to) throw new NotFoundException('Role not found.');
    const from = target.staffRoleId ? await this.roleRow(tenantId, target.staffRoleId) : null;
    await this.db
      .update(users)
      .set({ staffRoleId: roleId, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    await this.audit.record(actor, {
      action: 'staff.role_assigned',
      entityType: 'user',
      entityId: userId,
      metadata: { memberId: userId, memberName: target.fullName, from: from?.name ?? null, to: to?.name ?? null },
    });
    return this.member(actor, userId);
  }

  /** The roles a new consultancy starts with. Safe to call twice: names are unique. */
  async seedDefaultRoles(tenantId: string): Promise<void> {
    await this.db.insert(staffRoles).values(defaultRoleRows(tenantId)).onConflictDoNothing();
  }

  private async roleRow(tenantId: string, id: string) {
    const [row] = await this.db
      .select({ id: staffRoles.id, name: staffRoles.name, effects: staffRoles.effects })
      .from(staffRoles)
      .where(and(eq(staffRoles.id, id), eq(staffRoles.tenantId, tenantId)))
      .limit(1);
    return row ?? null;
  }

  /** How many overrides each member has, for the team list. */
  async overrideCounts(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ userId: userPermissions.userId, n: sql<number>`count(*)::int` })
      .from(userPermissions)
      .where(eq(userPermissions.tenantId, tenantId))
      .groupBy(userPermissions.userId);
    return new Map(rows.map((r) => [r.userId, r.n]));
  }

  /* ---------------------------------------------------------------- */

  private async staffMember(tenantId: string, userId: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        staffRoleId: users.staffRoleId,
      })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.tenantId, tenantId),
          inArray(users.role, ['manager', 'consultant']),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Team member not found.');
    return row;
  }

  private async consultancyMap(tenantId: string): Promise<EffectMap> {
    const rows = await this.db
      .select({ permission: rolePermissions.permission, effect: rolePermissions.effect })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.role, 'consultant')))
      .orderBy(asc(rolePermissions.permission));
    return Object.fromEntries(
      rows.filter((r) => isPermission(r.permission)).map((r) => [r.permission, r.effect]),
    ) as EffectMap;
  }

  private async memberMap(tenantId: string, userId: string): Promise<EffectMap> {
    const rows = await this.db
      .select({ permission: userPermissions.permission, effect: userPermissions.effect })
      .from(userPermissions)
      .where(and(eq(userPermissions.tenantId, tenantId), eq(userPermissions.userId, userId)));
    return Object.fromEntries(
      rows.filter((r) => isPermission(r.permission)).map((r) => [r.permission, r.effect]),
    ) as EffectMap;
  }
}
