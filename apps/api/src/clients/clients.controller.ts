import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createClientSchema,
  listClientsQuerySchema,
  portalAccessSchema,
  type PortalAccessInput,
  updateClientSchema,
  type AuthUser,
  type CreateClientInput,
  type ListClientsQuery,
  type UpdateClientInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { AuditService } from '../audit/audit.service';
import { MfaService } from '../auth/mfa.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { ClientsService } from './clients.service';

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
  ) {}

  /**
   * Consultants see only their own clients, managers see everyone, clients see
   * only themselves. That narrowing happens in SQL inside the service - this
   * endpoint takes no "whose clients" parameter that could be tampered with.
   */
  @Get()
  list(
    @CurrentUser() actor: AuthUser,
    @Query(zodPipe(listClientsQuerySchema)) query: ListClientsQuery,
  ) {
    return this.clients.list(actor, query);
  }

  /** Opening a client's file is recorded - the owner can see who looked at whom. */
  @Get(':id')
  async findOne(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const client = await this.clients.findOne(actor, id);
    await this.audit.recordView(actor, {
      action: 'client.viewed',
      entityType: 'client',
      entityId: id,
      clientId: id,
    });
    return client;
  }

  @Roles('consultant', 'manager')
  @RequirePermission('client.create')
  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodPipe(createClientSchema)) body: CreateClientInput,
  ) {
    return this.clients.create(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('client.edit')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateClientSchema)) body: UpdateClientInput,
  ) {
    return this.clients.update(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('client.edit')
  @Post(':id/archive')
  archive(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.archive(actor, id);
  }

  /** Give the client a portal login, or set a new password on theirs. */
  @Roles('consultant', 'manager')
  @RequirePermission('client.portal_access')
  @Post(':id/portal-access')
  grantPortalAccess(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(portalAccessSchema)) body: PortalAccessInput,
  ) {
    return this.clients.grantPortalAccess(actor, id, body.password);
  }

  /** Email the client a link to choose their own password (and return it, to send another way too). */
  @Roles('consultant', 'manager')
  @RequirePermission('client.portal_access')
  @Post(':id/portal-invite')
  @HttpCode(200)
  invitePortal(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.invitePortal(actor, id);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('client.portal_access')
  @Delete(':id/portal-access')
  revokePortalAccess(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.revokePortalAccess(actor, id);
  }

  /** A client who has lost their phone and their recovery codes. */
  @Roles('consultant', 'manager')
  @RequirePermission('client.portal_access')
  @Delete(':id/mfa')
  @HttpCode(204)
  async resetMfa(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const client = await this.clients.findOne(actor, id);
    if (!client.userId) throw new BadRequestException('This client has no portal login.');
    await this.mfa.resetFor(actor, client.userId, tenantOf(actor), ['client']);
  }
}
