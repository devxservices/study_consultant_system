import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { FoldersService } from './folders.service';
import { DriveSettingsService } from './drive-settings.service';

@Module({
  imports: [CasesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, FoldersService, DriveSettingsService],
  exports: [DocumentsService, FoldersService, DriveSettingsService],
})
export class DocumentsModule {}
