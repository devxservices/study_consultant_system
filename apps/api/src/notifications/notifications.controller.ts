import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { AuthUser } from '@crm/shared';
import { AllowPlatform, AllowWhenLapsed, CurrentUser } from '../auth/auth.guard';
import { NotificationsService } from './notifications.service';
import { NoChangeMarker } from '../sync/sync.interceptor';

/** A platform admin has a bell too; it is always their own. */
@AllowPlatform()
@AllowWhenLapsed()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Always the caller's own - there is no "whose notifications" parameter. */
  @Get()
  list(@CurrentUser() actor: AuthUser, @Query('limit') limit?: string) {
    const n = Math.min(50, Math.max(1, Number(limit) || 20));
    return this.notifications.list(actor, n);
  }

  // Read state shows only in the bell, which syncs itself - no page to refresh.
  @Post(':id/read')
  @HttpCode(204)
  @NoChangeMarker()
  async markRead(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.notifications.markRead(actor, id);
  }

  @Post('read-all')
  @HttpCode(204)
  @NoChangeMarker()
  async markAllRead(@CurrentUser() actor: AuthUser): Promise<void> {
    await this.notifications.markAllRead(actor);
  }
}
