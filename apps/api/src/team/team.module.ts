import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';

/** PermissionsService itself lives in AuthModule, which resolves it on every request. */
@Module({ controllers: [TeamController] })
export class TeamModule {}
