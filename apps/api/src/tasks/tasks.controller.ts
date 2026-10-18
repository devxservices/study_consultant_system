import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
  type AuthUser,
  type CreateTaskInput,
  type ListTasksQuery,
  type UpdateTaskInput,
} from '@crm/shared';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequiresModule } from '../tenancy/entitlements.service';
import { TasksService } from './tasks.service';
import { TasksSweepService } from './tasks-sweep.service';

@RequiresModule('tasks')
@Roles('consultant', 'manager')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly sweeper: TasksSweepService,
  ) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query(zodPipe(listTasksQuerySchema)) query: ListTasksQuery) {
    return this.tasks.list(actor, query);
  }

  /** `?scope=all` for a manager's whole-consultancy numbers; otherwise the caller's own. */
  @Get('counts')
  counts(@CurrentUser() actor: AuthUser, @Query('scope') scope?: string) {
    return this.tasks.counts(actor, !(scope === 'all' && actor.role === 'manager'));
  }

  @Get('assignees')
  assignees(@CurrentUser() actor: AuthUser) {
    return this.tasks.assignees(actor);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(actor, id);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(createTaskSchema)) body: CreateTaskInput) {
    return this.tasks.create(actor, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateTaskSchema)) body: UpdateTaskInput,
  ) {
    return this.tasks.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.tasks.remove(actor, id);
  }

  /** Run the overdue check now. Safe to repeat: each task alerts once per due date. */
  @Roles('manager')
  @Post('sweep')
  async sweep() {
    return { notified: await this.sweeper.run() };
  }
}
