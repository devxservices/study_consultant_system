import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { StuckSweepService } from './stuck-sweep.service';
import { StuckThresholdsSync } from './stuck-thresholds';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, StuckSweepService, StuckThresholdsSync],
  exports: [AnalyticsService, StuckSweepService],
})
export class AnalyticsModule {}
