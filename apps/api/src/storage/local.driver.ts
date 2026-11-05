import { Injectable, NotFoundException } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { env } from '../config/env';
import type { StorageDriver, StoredObject } from './storage.driver';
import { decryptFile, encryptFile } from './file-crypt';

/**
 * Files under ./storage, outside the web root and only ever reachable through
 * an authorised API route. Each is encrypted at rest (file-crypt.ts), so a
 * copied disk or backup gives away nothing without STORAGE_ENCRYPTION_KEY.
 */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor() {
    this.root = path.resolve(process.cwd(), env().STORAGE_LOCAL_DIR);
  }

  /**
   * Keys are built by us, never by the client, but resolve defensively anyway:
   * a key that escapes the storage root is refused rather than trusted.
   */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (!full.startsWith(rootWithSep)) {
      throw new NotFoundException('File not found.');
    }
    return full;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredObject> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, encryptFile(body));
    return { key, size: body.byteLength };
  }

  /** Read whole and decrypted: uploads are capped at a few megabytes. */
  async get(key: string): Promise<Readable> {
    return Readable.from([await this.read(key)]);
  }

  async read(key: string): Promise<Buffer> {
    const full = this.resolve(key);
    let stored: Buffer;
    try {
      stored = await fs.readFile(full);
    } catch {
      throw new NotFoundException('File not found.');
    }
    return decryptFile(stored);
  }

  async copy(from: string, to: string): Promise<void> {
    await this.put(to, await this.read(from), 'application/octet-stream');
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch {
      // Already gone is a success for our purposes.
    }
  }

  /** Local files have no direct URL; the caller streams them through the API. */
  async signedUrl(): Promise<string | null> {
    return null;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
