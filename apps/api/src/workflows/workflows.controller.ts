import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  automationRuleSchema,
  automationRunsQuerySchema,
  boardQuerySchema,
  countriesQuerySchema,
  countrySchema,
  createWorkflowSchema,
  publishWorkflowSchema,
  saveWorkflowDraftSchema,
  workflowTemplateSchema,
  type AuthUser,
  type AutomationRuleInput,
  type AutomationRunsQuery,
  type BoardQuery,
  type CountriesQuery,
  type CountryInput,
  type CreateWorkflowInput,
  type PublishWorkflowInput,
  type SaveWorkflowDraftInput,
  type WorkflowTemplateInput,
} from '@crm/shared';
import { z } from 'zod';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { CountriesService } from './countries.service';
import { WorkflowsService } from './workflows.service';
import { AutomationService } from './automation.service';
import { CasesService } from '../cases/cases.service';

const includeArchivedSchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/**
 * Destination master data. Every member of staff reads it - it is what they
 * advise from; building it needs the workflow permission.
 */
@Roles('consultant', 'manager')
@Controller('countries')
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query(zodPipe(countriesQuerySchema)) query: CountriesQuery) {
    return this.countries.list(actor, query);
  }

  @RequirePermission('workflow.manage')
  @Get('unlisted')
  unlisted(@CurrentUser() actor: AuthUser) {
    return this.countries.unlisted(actor);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.countries.get(actor, id);
  }

  @RequirePermission('workflow.manage')
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(countrySchema)) body: CountryInput) {
    return this.countries.create(actor, body);
  }

  @RequirePermission('workflow.manage')
  @Put(':id')
  update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(countrySchema)) body: CountryInput) {
    return this.countries.update(actor, id, body);
  }
}

/**
 * Workflows. Staff read them (the board, an application's stages);
 * building, publishing and archiving need the workflow permission.
 */
@Roles('consultant', 'manager')
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly cases: CasesService,
  ) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query(zodPipe(includeArchivedSchema)) query: { includeArchived: boolean }) {
    return this.workflows.list(actor, query.includeArchived);
  }

  @Get('board')
  board(@CurrentUser() actor: AuthUser, @Query(zodPipe(boardQuerySchema)) query: BoardQuery) {
    return this.workflows.board(actor, query);
  }

  @Get('versions/:versionId')
  version(@CurrentUser() actor: AuthUser, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.workflows.versionStages(actor, versionId);
  }

  @Get(':id')
  detail(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.detail(actor, id);
  }

  @Get(':id/performance')
  performance(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.performance(actor, id);
  }

  @RequirePermission('workflow.manage')
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(createWorkflowSchema)) body: CreateWorkflowInput) {
    return this.workflows.create(actor, body);
  }

  @RequirePermission('workflow.manage')
  @Patch(':id')
  update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(workflowTemplateSchema)) body: WorkflowTemplateInput) {
    return this.workflows.update(actor, id, body);
  }

  @RequirePermission('workflow.manage')
  @Post(':id/archive')
  archive(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.setArchived(actor, id, true);
  }

  @RequirePermission('workflow.manage')
  @Post(':id/restore')
  restore(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.setArchived(actor, id, false);
  }

  @RequirePermission('workflow.manage')
  @Put(':id/draft')
  saveDraft(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(saveWorkflowDraftSchema)) body: SaveWorkflowDraftInput) {
    return this.workflows.saveDraft(actor, id, body);
  }

  @RequirePermission('workflow.manage')
  @Delete(':id/draft')
  discardDraft(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.discardDraft(actor, id);
  }

  @RequirePermission('workflow.manage')
  @Post(':id/publish')
  publish(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(publishWorkflowSchema)) body: PublishWorkflowInput) {
    return this.workflows.publish(actor, id, body, (from, to) => this.cases.upgradeToVersion(actor, from, to));
  }
}

/** Automations and their run log: part of building workflows. */
@Roles('consultant', 'manager')
@RequirePermission('workflow.manage')
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser) {
    return this.automation.list(actor);
  }

  @Get('runs')
  runs(@CurrentUser() actor: AuthUser, @Query(zodPipe(automationRunsQuerySchema)) query: AutomationRunsQuery) {
    return this.automation.runs(actor, query);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.automation.get(actor, id);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(automationRuleSchema)) body: AutomationRuleInput) {
    return this.automation.create(actor, body);
  }

  @Put(':id')
  update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(automationRuleSchema)) body: AutomationRuleInput) {
    return this.automation.update(actor, id, body);
  }

  @Post(':id/enable')
  enable(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.automation.setEnabled(actor, id, true);
  }

  @Post(':id/disable')
  disable(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.automation.setEnabled(actor, id, false);
  }

  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.automation.remove(actor, id);
  }
}
