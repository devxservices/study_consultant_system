import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global: nearly every feature module records something. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
