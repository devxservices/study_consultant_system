import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TasksService } from './tasks.service';

/**
 * Checks for newly overdue follow-ups every quarter of an hour.
 *
 * Unlike the stuck-case sweep this cannot wait for the morning - a "call them
 * back at 3pm" is worth nothing at 8am the next day. The check itself is
 * idempotent (each task alerts once per due date), so running it often, or on
 * several instances at once, sends nothing twice.
 */
@Injectable()
export class TasksSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TasksSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private static readonly EVERY_MS = 15 * 60 * 1000;

  constructor(private readonly tasks: TasksService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), TasksSweepService.EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<number> {
    try {
      const n = await this.tasks.overdueSweep();
      if (n) this.logger.log(`Sent ${n} overdue task alert(s)`);
      return n;
    } catch (err) {
      this.logger.error('Overdue task sweep failed', err as Error);
      return 0;
    }
  }
}
