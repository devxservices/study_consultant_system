import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Encryption at rest for small secrets - today, two-step verification seeds.
 * AES-256-GCM, a fresh 96-bit IV per value, and the auth tag stored with it,
 * so a tampered value fails to decrypt rather than decrypting to garbage.
 *
 * The key is MFA_ENCRYPTION_KEY (required in production). In development it
 * is derived from JWT_SECRET so the app runs with no setup; that is fine for
 * local data and never used in production, where boot fails without the key.
 */
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env().MFA_ENCRYPTION_KEY;
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64).');
    cachedKey = buf;
  } else {
    cachedKey = createHash('sha256').update(`mfa-secret-box:${env().JWT_SECRET}`).digest();
  }
  return cachedKey;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function open(sealed: string): string {
  if (!sealed.startsWith('v1:')) throw new Error('Unknown secret format');
  const buf = Buffer.from(sealed.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}
