import { Global, Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { CountriesService } from './countries.service';
import { WorkflowsService } from './workflows.service';
import { AutomationService } from './automation.service';
import { AutomationsController, CountriesController, WorkflowsController } from './workflows.controller';

/**
 * Global: applications, documents and the stuck-case sweep all fire
 * automations, and every case reads its workflow.
 */
@Global()
@Module({
  imports: [CasesModule],
  controllers: [CountriesController, WorkflowsController, AutomationsController],
  providers: [WorkflowsService, AutomationService, CountriesService],
  exports: [WorkflowsService, AutomationService, CountriesService],
})
export class WorkflowsModule {}
