import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '@crm/shared';
import { AllowPlatform, CurrentUser } from '../auth/auth.guard';
import { SyncService, type ChangesReply } from './sync.service';

@AllowPlatform()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** `since` is the page's render time, in milliseconds since the epoch. */
  @Get('changes')
  changes(@CurrentUser() actor: AuthUser, @Query('since') since?: string): Promise<ChangesReply> {
    const ms = Number(since);
    if (!since || !Number.isFinite(ms) || ms < 0) {
      throw new BadRequestException('since must be a time in milliseconds.');
    }
    return this.sync.changedSince(actor, ms);
  }
}
