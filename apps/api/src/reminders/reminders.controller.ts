import { Controller, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/auth.guard';
import { RemindersService } from './reminders.service';

/**
 * Runs the reminder sweep now. The hook for an external scheduler: with
 * several API instances, point cron at one of them instead of trusting
 * every instance's timer (each job is safe to run twice either way).
 */
@Roles('super_admin')
@Controller('admin/reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Post('run')
  run(@Query('job') job?: string) {
    return this.reminders.run(job);
  }
}
