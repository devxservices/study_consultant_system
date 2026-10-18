import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { refuseCrossSiteWrites } from './common/cross-site';
import { env } from './config/env';
import { DB_HANDLE } from './db/database.module';
import type { DbHandle } from './db/connection';

async function bootstrap() {
  const config = env();
  // rawBody: payment webhooks are verified against the exact bytes the provider signed.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(refuseCrossSiteWrites(config.COOKIE_NAME));

  // The browser sends the session cookie, so the web origin must be explicit
  // and credentials allowed - a wildcard origin cannot carry cookies.
  app.enableCors({
    origin: config.WEB_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });


  const handle = app.get<DbHandle>(DB_HANDLE);
  app.enableShutdownHooks();
  process.on('beforeExit', () => {
    void handle.close();
  });

  await app.listen(config.PORT);
  new Logger('Bootstrap').log(`API listening on http://localhost:${config.PORT}/api`);
}

/**
 * Startup failures that are somebody's ordinary mistake rather than a bug get
 * a plain explanation and a clean exit. The default is a wall of stack trace
 * with the useful sentence buried in it, and the two failures that actually
 * happen in development - a second instance, and a damaged data directory -
 * both have a one-line fix worth stating.
 */
bootstrap().catch((err: unknown) => {
  const code = (err as NodeJS.ErrnoException)?.code;
  const name = (err as Error)?.name;

  if (code === 'EADDRINUSE') {
    console.error(
      [
        '',
        `Port ${env().PORT} is already in use - the API is probably already running.`,
        '',
        'Stop the other instance and try again. Two API processes also mean two',
        'writers on the development database, which is what corrupts it.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  if (name === 'DatabaseLockedError') {
    // The message is already written for a human; a stack adds nothing.
    console.error((err as Error).message);
    process.exit(1);
  }

  console.error(err);
  process.exit(1);
});
