import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { StuckSweepService } from './stuck-sweep.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, StuckSweepService],
  exports: [AnalyticsService, StuckSweepService],
})
export class AnalyticsModule {}
