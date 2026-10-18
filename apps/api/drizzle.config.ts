import type { Config } from 'drizzle-kit';

/**
 * Used only to GENERATE migration SQL from src/db/schema.ts.
 * Applying them is done by src/db/scripts/migrate.ts, which picks the driver
 * (embedded PGlite locally, real Postgres when DATABASE_URL is set).
 */
export default {
  schema: ['./src/db/enums.ts', './src/db/schema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
} satisfies Config;
