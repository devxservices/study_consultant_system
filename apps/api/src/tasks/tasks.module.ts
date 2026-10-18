import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TasksSweepService } from './tasks-sweep.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TasksSweepService],
  exports: [TasksService],
})
export class TasksModule {}
