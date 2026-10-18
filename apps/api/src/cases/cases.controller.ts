import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  approveStageSchema,
  changeCaseStatusSchema,
  changeCaseWorkflowSchema,
  changeStageSchema,
  createCaseSchema,
  updateCaseSchema,
  type ApproveStageInput,
  type AuthUser,
  type ChangeCaseStatusInput,
  type ChangeCaseWorkflowInput,
  type ChangeStageInput,
  type CreateCaseInput,
  type UpdateCaseInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { AuditService } from '../audit/audit.service';
import { CasesService } from './cases.service';

@Controller('cases')
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly audit: AuditService,
  ) {}

  /** Clients may read their own case; the service decides, not the route. */
  @Get(':id')
  async detail(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.cases.getDetail(actor, id);
    await this.audit.recordView(actor, {
      action: 'case.viewed',
      entityType: 'case',
      entityId: id,
      caseId: id,
      clientId: detail.clientId,
      metadata: { reference: detail.reference },
    });
    return detail;
  }

  @Roles('consultant', 'manager')
  @RequirePermission('case.create')
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(createCaseSchema)) body: CreateCaseInput) {
    return this.cases.create(actor, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('case.edit')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateCaseSchema)) body: UpdateCaseInput,
  ) {
    return this.cases.update(actor, id, body);
  }

  /**
   * Manual stage override. Auto-advancement happens on its own when a
   * checklist is satisfied; this is the escape hatch for everything else.
   */
  @Roles('consultant', 'manager')
  @RequirePermission('case.move')
  @Post(':id/stage')
  changeStage(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(changeStageSchema)) body: ChangeStageInput,
  ) {
    return this.cases.changeStage(actor, id, body);
  }

  /** Sign off a stage that needs approval. The service decides who may. */
  @Roles('consultant', 'manager')
  @RequirePermission('case.move')
  @Post(':id/approve')
  approve(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(approveStageSchema)) body: ApproveStageInput,
  ) {
    return this.cases.approveStage(actor, id, body.note);
  }

  /** Move the application to another workflow, or a newer version of its own. */
  @Roles('consultant', 'manager')
  @RequirePermission('case.move')
  @Post(':id/workflow')
  changeWorkflow(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(changeCaseWorkflowSchema)) body: ChangeCaseWorkflowInput,
  ) {
    return this.cases.changeWorkflow(actor, id, body);
  }

  @Roles('consultant', 'manager')
  @RequirePermission('case.move')
  @Post(':id/status')
  changeStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(changeCaseStatusSchema)) body: ChangeCaseStatusInput,
  ) {
    return this.cases.changeStatus(actor, id, body);
  }

  /**
   * Re-run the auto-advancement check by hand. Normally this fires off the back
   * of a document review; exposing it lets a consultant nudge a case whose
   * documents were verified before the rule existed.
   */
  @Roles('consultant', 'manager')
  @RequirePermission('case.move')
  @Post(':id/recheck')
  async recheck(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.cases.findAccessible(actor, id);
    const moved = await this.cases.evaluateAutoAdvance(id, actor);
    return { moved, case: await this.cases.getDetail(actor, id) };
  }
}
