import { z } from 'zod';

/**
 * Env is validated once at boot so a misconfigured deploy fails loudly
 * instead of half-working.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),

  /** Absent locally -> embedded PGlite. Set it to use a managed Postgres. */
  DATABASE_URL: z.string().optional(),

  /** Signs session cookies. MUST be set in production. */
  JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  /** Where the Next.js app runs, for CORS + cookie config. */
  WEB_ORIGIN: z.string().default('http://localhost:3000'),

  COOKIE_NAME: z.string().default('crm_session'),
  /**
   * Leave unset for a multi-tenant deployment. A host-only cookie is what keeps
   * a session on one consultancy's site from being sent to another's.
   */
  COOKIE_DOMAIN: z.string().optional(),

  /**
   * Multi-tenancy. Every consultancy is reachable at <slug>.PLATFORM_DOMAIN,
   * and at any custom domain it has verified. The platform admin signs in at
   * ADMIN_HOST (default admin.<PLATFORM_DOMAIN>). Browsers resolve
   * *.localhost to this machine, so all of it works locally with no DNS.
   */
  PLATFORM_DOMAIN: z.string().trim().toLowerCase().default('localhost'),
  ADMIN_HOST: z.string().trim().toLowerCase().optional(),
  /**
   * The consultancy served at the bare PLATFORM_DOMAIN. Defaults to "main"
   * outside production so http://localhost:3000 keeps working; in production
   * leave it unset and the bare domain serves no consultancy.
   */
  DEFAULT_TENANT_SLUG: z.string().trim().toLowerCase().optional(),
  /**
   * The server's public IP address(es), comma-separated. A consultancy whose
   * own domain is a root domain (example.com, which cannot have a CNAME) is
   * told to point an A record here, and "Check DNS" accepts these addresses.
   */
  PUBLIC_IP: z.string().trim().optional(),

  /** 'local' writes to ./storage; 's3' uses the S3-compatible driver. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('../../storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Server-side encryption S3 applies to every object: AES256 (default) or aws:kms. */
  S3_SSE: z.enum(['AES256', 'aws:kms', 'none']).default('AES256'),
  S3_KMS_KEY_ID: z.string().optional(),
  /**
   * Encrypts files the local driver writes (AES-256-GCM): 32 bytes as hex or
   * base64. Required in production when STORAGE_DRIVER=local; derived from
   * JWT_SECRET in development. Never change it once files exist.
   */
  STORAGE_ENCRYPTION_KEY: z.string().trim().optional(),

  /**
   * Virus scanning of every upload. 'clamav' streams each file to a clamd
   * daemon (CLAMAV_HOST:CLAMAV_PORT) and refuses it if a signature matches -
   * or if the scanner cannot be reached, since an unscanned file is not
   * accepted silently.
   */
  VIRUS_SCAN: z.enum(['none', 'clamav']).default('none'),
  CLAMAV_HOST: z.string().default('127.0.0.1'),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  /**
   * Email. 'log' writes each message as an .eml file under MAIL_OUTBOX_DIR -
   * open them in any mail client - and sends nothing. 'smtp' sends through
   * any SMTP server (SendGrid, SES, Mailgun and Gmail all offer one).
   */
  MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  MAIL_FROM: z.string().default('Consultancy CRM <no-reply@localhost>'),
  MAIL_OUTBOX_DIR: z.string().default('../../.data/outbox'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  /**
   * WhatsApp and SMS. 'log' records what would have been sent; 'twilio'
   * sends through Twilio (TWILIO_* below) for both channels.
   */
  MESSAGING_DRIVER: z.enum(['log', 'twilio']).default('log'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_SMS_FROM: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  /**
   * The header the edge proxy (nginx, Caddy, a load balancer) puts the
   * client's real IP in, e.g. x-real-ip. Unset in development, where there is
   * no such proxy and the address is recorded as the local one.
   */
  CLIENT_IP_HEADER: z.string().trim().optional(),

  /**
   * Encrypts two-step verification secrets at rest: 32 bytes, as 64 hex
   * characters or base64. Required in production; derived from JWT_SECRET in
   * development so the app runs with no setup.
   */
  MFA_ENCRYPTION_KEY: z.string().trim().optional(),

  /**
   * Per signed-in account: a burst of RATE_LIMIT_BURST requests, refilling at
   * RATE_LIMIT_PER_MINUTE. 0 switches it off. Defaults to 600 a minute, and to
   * off under NODE_ENV=test so the test and benchmark suites measure the app
   * rather than the limiter.
   */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).optional(),
  RATE_LIMIT_BURST: z.coerce.number().int().min(1).default(120),

  /** Seed script only: password given to every demo account. */
  SEED_PASSWORD: z.string().default('password123'),
});

export type Env = Omit<z.infer<typeof envSchema>, 'RATE_LIMIT_PER_MINUTE'> & {
  RATE_LIMIT_PER_MINUTE: number;
};

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  cached = {
    ...parsed.data,
    RATE_LIMIT_PER_MINUTE:
      parsed.data.RATE_LIMIT_PER_MINUTE ?? (parsed.data.NODE_ENV === 'test' ? 0 : 600),
  };

  if (cached.NODE_ENV === 'production' && !cached.MFA_ENCRYPTION_KEY) {
    throw new Error('MFA_ENCRYPTION_KEY must be set in production (32 random bytes, hex or base64).');
  }
  if (cached.NODE_ENV === 'production' && cached.JWT_SECRET.startsWith('dev-only')) {
    throw new Error('JWT_SECRET must be set to a real secret in production.');
  }
  if (cached.NODE_ENV === 'production' && cached.STORAGE_DRIVER === 'local' && !cached.STORAGE_ENCRYPTION_KEY) {
    throw new Error('STORAGE_ENCRYPTION_KEY must be set in production when files are stored locally.');
  }
  if (cached.NODE_ENV === 'production') {
    // The two mistakes that make a launch look like it works while nobody
    // outside the server can use it.
    if (cached.PLATFORM_DOMAIN === 'localhost' || !cached.PLATFORM_DOMAIN.includes('.')) {
      throw new Error('PLATFORM_DOMAIN must be your real domain in production, e.g. yourcrm.com.');
    }
    if (!cached.WEB_ORIGIN.startsWith('https://')) {
      throw new Error('WEB_ORIGIN must be the https:// address of the platform in production, e.g. https://yourcrm.com.');
    }
    if (cached.MAIL_DRIVER === 'log') {
      console.warn(
        '[config] MAIL_DRIVER=log: emails (password resets, invitations, receipts) are written to files and NOT sent. Set MAIL_DRIVER=smtp before launch.',
      );
    }
  }
  return cached;
}

export const isProd = () => env().NODE_ENV === 'production';
