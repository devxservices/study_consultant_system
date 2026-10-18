import { Global, Module, type OnApplicationShutdown, Logger } from '@nestjs/common';
import { createDb, type DbHandle } from './connection';

export const DB = Symbol('DB');
export const DB_HANDLE = Symbol('DB_HANDLE');

/**
 * Global so every feature module can inject DB without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      useFactory: async (): Promise<DbHandle> => {
        const handle = await createDb();
        new Logger('Database').log(`Connected via ${handle.driver} -> ${handle.target}`);
        return handle;
      },
    },
    {
      provide: DB,
      inject: [DB_HANDLE],
      useFactory: (handle: DbHandle) => handle.db,
    },
  ],
  exports: [DB, DB_HANDLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor() {}
  async onApplicationShutdown(): Promise<void> {
    // Handle closing is delegated to the Nest lifecycle in main.ts.
  }
}
