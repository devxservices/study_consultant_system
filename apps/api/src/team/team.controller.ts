import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  NOTIFICATION_TYPES,
  emailNotificationsSchema,
  type EmailNotificationsInput,
  assignRoleSchema,
  roleTemplateSchema,
  type AssignRoleInput,
  type RoleTemplateInput,
  mfaPolicySchema,
  setPermissionsSchema,
  type AuthUser,
  type MfaPolicy,
  type MfaPolicyInput,
  type SetPermissionsInput,
  type TeamMember,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { staffRoles, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { MfaService } from '../auth/mfa.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { PermissionsService } from './permissions.service';

/**
 * The owner's controls over their own people: who may do what, the
 * consultancy's security policy, and getting someone back in when they have
 * lost their phone. Managers only - and nothing here reaches any other
 * consultancy.
 */
@Roles('manager')
@Controller('team')
export class TeamController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly permissions: PermissionsService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async members(@CurrentUser() actor: AuthUser): Promise<TeamMember[]> {
    const tenantId = tenantOf(actor);
    const [rows, overrides] = await Promise.all([
      this.db
        .select({
          userId: users.id,
          name: users.fullName,
          email: users.email,
          role: users.role,
          active: users.isActive,
          mfaEnabledAt: users.mfaEnabledAt,
          lastSignInAt: users.lastSignInAt,
          roleTitle: staffRoles.name,
        })
        .from(users)
        .leftJoin(staffRoles, eq(staffRoles.id, users.staffRoleId))
        .where(and(eq(users.tenantId, tenantId), inArray(users.role, ['manager', 'consultant'])))
        .orderBy(asc(users.role), asc(users.fullName)),
      this.permissions.overrideCounts(tenantId),
    ]);
    rows.sort((a, b) => Number(b.role === 'manager') - Number(a.role === 'manager') || a.name.localeCompare(b.name));
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: r.role as 'manager' | 'consultant',
      active: r.active,
      mfaEnabled: Boolean(r.mfaEnabledAt),
      lastSignInAt: r.lastSignInAt ? new Date(r.lastSignInAt).toISOString() : null,
      overrides: overrides.get(r.userId) ?? 0,
      roleTitle: r.role === 'consultant' ? (r.roleTitle ?? null) : null,
    }));
  }

  /* ---------------- roles ---------------- */

  @Get('roles')
  roles(@CurrentUser() actor: AuthUser) {
    return this.permissions.roles(actor);
  }

  @Post('roles')
  createRole(@CurrentUser() actor: AuthUser, @Body(zodPipe(roleTemplateSchema)) body: RoleTemplateInput) {
    return this.permissions.saveRole(actor, body);
  }

  @Patch('roles/:id')
  updateRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(roleTemplateSchema)) body: RoleTemplateInput,
  ) {
    return this.permissions.saveRole(actor, body, id);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  async deleteRole(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.permissions.deleteRole(actor, id);
  }

  @Put(':userId/role')
  assignRole(
    @CurrentUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(zodPipe(assignRoleSchema)) body: AssignRoleInput,
  ) {
    return this.permissions.assignRole(actor, userId, body.roleId);
  }

  /* ---------------- email notifications ---------------- */

  /** Which notification types also go out by email; absent means on. */
  @Get('email-notifications')
  async emailNotifications(@CurrentUser() actor: AuthUser): Promise<Record<string, boolean>> {
    const [row] = await this.db
      .select({ settings: tenants.emailNotifications })
      .from(tenants)
      .where(eq(tenants.id, tenantOf(actor)));
    return Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, row?.settings?.[t] !== false]));
  }

  @Put('email-notifications')
  async setEmailNotifications(
    @CurrentUser() actor: AuthUser,
    @Body(zodPipe(emailNotificationsSchema)) body: EmailNotificationsInput,
  ): Promise<Record<string, boolean>> {
    const tenantId = tenantOf(actor);
    const before = await this.emailNotifications(actor);
    await this.db
      .update(tenants)
      .set({ emailNotifications: body.settings, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    const settings: Record<string, boolean> = body.settings;
    const changed = Object.keys(settings).filter((k) => before[k] !== settings[k]);
    await this.audit.record(actor, {
      action: 'tenant.updated',
      entityType: 'settings',
      metadata: { setting: 'email notifications', changed },
    });
    return this.emailNotifications(actor);
  }

  /* ---------------- consultancy-wide ---------------- */

  @Get('defaults')
  defaults(@CurrentUser() actor: AuthUser) {
    return this.permissions.consultancyDefaults(actor);
  }

  @Put('defaults')
  setDefaults(
    @CurrentUser() actor: AuthUser,
    @Body(zodPipe(setPermissionsSchema)) body: SetPermissionsInput,
  ) {
    return this.permissions.setConsultancyDefaults(actor, body.changes);
  }

  @Get('security')
  async security(@CurrentUser() actor: AuthUser): Promise<{ policy: MfaPolicy }> {
    return { policy: (await this.mfa.policyFor(tenantOf(actor))) ?? 'optional' };
  }

  /**
   * Who must use two-step verification. Tightening it takes effect at once:
   * anyone it now covers who has not set it up is sent to set it up on their
   * next click.
   */
  @Put('security')
  async setSecurity(
    @CurrentUser() actor: AuthUser,
    @Body(zodPipe(mfaPolicySchema)) body: MfaPolicyInput,
  ): Promise<{ policy: MfaPolicy }> {
    const tenantId = tenantOf(actor);
    // Requiring it of everyone else while not using it yourself would lock the
    // person who just saved the setting out of everything but the set-up page.
    if (body.policy !== 'optional' && !actor.mfaEnabled) {
      throw new BadRequestException({
        message: 'Turn on two-step verification for your own account before requiring it for others.',
        code: 'MFA_OWNER_FIRST',
      });
    }
    const before = await this.mfa.policyFor(tenantId);
    if (before !== body.policy) {
      await this.db
        .update(tenants)
        .set({ mfaPolicy: body.policy, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
      await this.audit.record(actor, {
        action: 'security.policy_changed',
        entityType: 'tenant',
        entityId: tenantId,
        metadata: { setting: 'mfaPolicy', from: before, to: body.policy },
      });
    }
    return { policy: body.policy };
  }

  /* ---------------- one member ---------------- */

  @Get(':userId/permissions')
  member(@CurrentUser() actor: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.permissions.member(actor, userId);
  }

  @Put(':userId/permissions')
  setMember(
    @CurrentUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(zodPipe(setPermissionsSchema)) body: SetPermissionsInput,
  ) {
    return this.permissions.setMember(actor, userId, body.changes);
  }

  /** For a member who has lost their phone and their recovery codes. */
  @Post(':userId/mfa/reset')
  @HttpCode(204)
  async resetMfa(@CurrentUser() actor: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.mfa.resetFor(actor, userId, tenantOf(actor), ['manager', 'consultant', 'client']);
  }
}
