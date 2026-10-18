import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createConsultantSchema,
  resetPasswordSchema,
  updateStaffSchema,
  type AuthUser,
  type CreateConsultantInput,
  type ResetPasswordInput,
  type UpdateStaffInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { ConsultantsService } from './consultants.service';

@Controller('consultants')
export class ConsultantsController {
  constructor(private readonly consultants: ConsultantsService) {}

  @Roles('consultant', 'manager')
  @RequirePermission('staff.view')
  @Get()
  list(@CurrentUser() actor: AuthUser, @Query('includeInactive') includeInactive?: string) {
    return this.consultants.list(actor, includeInactive === 'true');
  }

  @Roles('consultant')
  @Get('me')
  me(@CurrentUser() actor: AuthUser) {
    return this.consultants.me(actor);
  }

  /**
   * Adding consultants, switching logins off and resetting passwords: managers,
   * and consultants a manager has trusted with it. Never permissions - those
   * are only ever changed by a manager, on the team pages.
   */
  @Roles('consultant', 'manager')
  @RequirePermission('staff.manage')
  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodPipe(createConsultantSchema)) body: CreateConsultantInput,
  ) {
    return this.consultants.create(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('staff.manage')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateStaffSchema)) body: UpdateStaffInput,
  ) {
    return this.consultants.update(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('staff.manage')
  @Post(':id/password')
  @HttpCode(204)
  async resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(resetPasswordSchema)) body: ResetPasswordInput,
  ): Promise<void> {
    await this.consultants.resetPassword(actor, id, body.password);
  }

  /** Email them a link to choose their own password; the link comes back too, to send another way. */
  @Roles('consultant', 'manager')
  @RequirePermission('staff.manage')
  @Post(':id/password-link')
  @HttpCode(200)
  sendPasswordLink(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.consultants.sendPasswordLink(actor, id);
  }
}
