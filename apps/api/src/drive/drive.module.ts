import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CasesModule } from '../cases/cases.module';
import { DriveController } from './drive.controller';
import { ShareController } from './share.controller';
import { DriveService } from './drive.service';
import { ChecklistService } from './checklist.service';
import { ShareService } from './share.service';
import { UploadsService } from './uploads.service';
import { DocumentRemindersService } from './document-reminders.service';

@Module({
  imports: [DocumentsModule, CasesModule],
  controllers: [DriveController, ShareController],
  providers: [DriveService, ChecklistService, ShareService, UploadsService, DocumentRemindersService],
  exports: [DriveService, ChecklistService, UploadsService],
})
export class DriveModule {}
