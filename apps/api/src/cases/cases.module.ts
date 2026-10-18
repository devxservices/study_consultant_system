import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CasesService } from './cases.service';
import { CasesController } from './cases.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [CasesController],
  providers: [CasesService],
  exports: [CasesService],
})
export class CasesModule {}
