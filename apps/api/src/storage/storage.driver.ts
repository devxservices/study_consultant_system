import type { Readable } from 'node:stream';

/**
 * The storage seam.
 *
 * Files never live in Postgres - only the key does. Locally that key resolves
 * to a path under ./storage; in production it resolves to an object in S3, R2
 * or B2. Nothing above this interface knows which.
 */
export const STORAGE = Symbol('STORAGE');

export interface StoredObject {
  key: string;
  size: number;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';

  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;

  /** Streamed back through an authorised API route. */
  get(key: string): Promise<Readable>;

  /** The whole object, for zipping, watermarking or copying. */
  read(key: string): Promise<Buffer>;

  /** Duplicates an object under a new key (copying a document, restoring a version). */
  copy(from: string, to: string): Promise<void>;

  delete(key: string): Promise<void>;

  /**
   * A short-lived direct URL, when the driver can issue one. Local storage
   * returns null and the caller falls back to streaming through the API.
   */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;

  exists(key: string): Promise<boolean>;
}
