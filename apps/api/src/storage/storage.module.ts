import { Global, Logger, Module } from '@nestjs/common';
import { env } from '../config/env';
import { STORAGE, type StorageDriver } from './storage.driver';
import { LocalStorageDriver } from './local.driver';
import { S3StorageDriver } from './s3.driver';
import { VirusScanner } from './virus-scan';

/**
 * Picks the driver from STORAGE_DRIVER. The S3 client is only constructed when
 * it is actually selected, so local development never needs credentials.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      useFactory: (): StorageDriver => {
        const driver =
          env().STORAGE_DRIVER === 's3' ? new S3StorageDriver() : new LocalStorageDriver();
        new Logger('Storage').log(`Using ${driver.name} storage`);
        return driver;
      },
    },
    VirusScanner,
  ],
  exports: [STORAGE, VirusScanner],
})
export class StorageModule {}
