import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  createAnnouncementSchema,
  type AuthUser,
  type CreateAnnouncementInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequiresModule } from '../tenancy/entitlements.service';
import { AnnouncementsService } from './announcements.service';

@RequiresModule('announcements')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  /** The caller's own feed - clients see client notices, staff see staff ones. */
  @Get()
  feed(@CurrentUser() actor: AuthUser) {
    return this.announcements.feed(actor);
  }

  @Roles('manager')
  @Get('all')
  all(@CurrentUser() actor: AuthUser) {
    return this.announcements.all(actor);
  }

  @Roles('manager')
  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zodPipe(createAnnouncementSchema)) body: CreateAnnouncementInput,
  ) {
    return this.announcements.create(actor, body);
  }

  @Roles('manager')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.announcements.remove(actor, id);
  }
}
