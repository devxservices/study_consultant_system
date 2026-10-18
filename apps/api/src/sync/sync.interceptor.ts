import {
  Injectable,
  Logger,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, concatMap, type Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.guard';
import { SyncService } from './sync.service';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NO_CHANGE_MARKER = 'sync:no-change-marker';

/**
 * For a write whose result no page shows - only the caller's own live chrome
 * (the notification bell, which updates itself over its socket). Marking it
 * would make every colleague's kept pages re-render for nothing. A route
 * that changes anything a page renders must never carry this.
 */
export const NoChangeMarker = () => SetMetadata(NO_CHANGE_MARKER, true);

/**
 * Every write request moves its consultancy's change marker forward, so a
 * page the browser kept from before it is re-rendered rather than trusted.
 *
 * Applied globally, so a new endpoint cannot forget it. It runs after the
 * guards (a refused request never reaches it) and before the response leaves:
 * by the time the browser sees "saved", the marker already says so, and the
 * next page it pulls from its cache is checked against it.
 *
 * A failed write is marked too. Most fail before touching anything, but one
 * that fails halfway must not leave a page looking unchanged - the cost of
 * marking a write that changed nothing is one unneeded refresh.
 */
@Injectable()
export class SyncInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SyncInterceptor.name);

  constructor(
    private readonly sync: SyncService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const tenantId = req.user?.tenantId;
    if (READS.has(req.method) || !tenantId) return next.handle();
    const skip = this.reflector.getAllAndOverride<boolean>(NO_CHANGE_MARKER, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const mark = () =>
      this.sync.touch(tenantId).catch((err: unknown) => {
        // Never fail the write itself over the marker.
        this.logger.warn(`change marker not recorded: ${(err as Error).message}`);
      });

    return next.handle().pipe(
      concatMap(async (value: unknown) => {
        await mark();
        return value;
      }),
      catchError(async (err: unknown) => {
        await mark();
        throw err;
      }),
    );
  }
}
