import { Global, Module } from '@nestjs/common';
import { StatsCacheService } from './stats-cache.service';

/** Global: dashboards, badges and plan usage across many modules read through it. */
@Global()
@Module({
  providers: [StatsCacheService],
  exports: [StatsCacheService],
})
export class StatsModule {}
