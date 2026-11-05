import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Encryption at rest for files the local driver writes: AES-256-GCM with a
 * fresh IV per file and its auth tag stored alongside, so a file altered on
 * disk fails to open rather than opening as something else.
 *
 * Layout: MAGIC (8 bytes) | IV (12) | TAG (16) | ciphertext. Files written
 * before encryption existed have no MAGIC and are read as they are, so turning
 * this on never strands an existing document.
 */
const MAGIC = Buffer.from('CRMENC01', 'ascii');
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env().STORAGE_ENCRYPTION_KEY;
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new Error('STORAGE_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64).');
    }
    cachedKey = buf;
  } else {
    cachedKey = createHash('sha256').update(`storage-file-key:${env().JWT_SECRET}`).digest();
  }
  return cachedKey;
}

export function encryptFile(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function isEncrypted(buf: Buffer): boolean {
  return buf.length >= MAGIC.length + 28 && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function decryptFile(stored: Buffer): Buffer {
  if (!isEncrypted(stored)) return stored;
  const iv = stored.subarray(8, 20);
  const tag = stored.subarray(20, 36);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(stored.subarray(36)), decipher.final()]);
}
