import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

export type SweepJob = () => Promise<number>;

/**
 * One hourly sweep for every time-based reminder: documents about to expire,
 * the trash to empty, installments coming due, commission claims to chase,
 * students missing class. Each module registers its own job here.
 *
 * Every job is idempotent - a reminder is claimed with a conditional update
 * before it is sent - so running it on several API instances at once, or by
 * hand on top of the timer, sends nothing twice.
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private readonly jobs = new Map<string, SweepJob>();
  private timer: NodeJS.Timeout | null = null;
  private static readonly EVERY_MS = 60 * 60 * 1000;

  register(name: string, job: SweepJob): void {
    this.jobs.set(name, job);
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    // A first pass a minute after boot, then hourly.
    const first = setTimeout(() => void this.run(), 60_000);
    first.unref();
    this.timer = setInterval(() => void this.run(), RemindersService.EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs every job (or one by name); a failure in one never stops the others. */
  async run(only?: string): Promise<Record<string, number>> {
    const done: Record<string, number> = {};
    for (const [name, job] of this.jobs) {
      if (only && name !== only) continue;
      try {
        done[name] = await job();
        if (done[name]) this.logger.log(`${name}: ${done[name]}`);
      } catch (err) {
        this.logger.error(`${name} failed`, err as Error);
        done[name] = -1;
      }
    }
    return done;
  }
}
