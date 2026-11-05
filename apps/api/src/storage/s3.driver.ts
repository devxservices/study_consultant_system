import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { env } from '../config/env';
import type { StorageDriver, StoredObject } from './storage.driver';

/** Cloudflare R2's S3 endpoint: <account>.r2.cloudflarestorage.com, or a jurisdiction (<account>.eu.r2...). */
export function isR2Endpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  try {
    return new URL(endpoint).hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com');
  } catch {
    return false;
  }
}

/**
 * Production storage. The same code covers AWS S3, Cloudflare R2 and
 * Backblaze B2 - they all speak the S3 API, they differ only in endpoint.
 *
 * Objects are private. Reads are handed out as short-lived presigned URLs so
 * the file goes browser-to-CDN without passing through our server, while a
 * leaked URL still expires within minutes.
 */
@Injectable()
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  /** R2 encrypts every object itself and refuses the SSE request header. */
  private readonly r2: boolean;

  constructor() {
    const cfg = env();
    if (!cfg.S3_BUCKET) {
      throw new InternalServerErrorException('STORAGE_DRIVER=s3 requires S3_BUCKET to be set.');
    }
    this.bucket = cfg.S3_BUCKET;
    this.r2 = isR2Endpoint(cfg.S3_ENDPOINT);
    if (this.r2) {
      // Each of these otherwise boots fine and fails on the first upload.
      if (!cfg.S3_ACCESS_KEY_ID || !cfg.S3_SECRET_ACCESS_KEY) {
        throw new InternalServerErrorException(
          'Cloudflare R2 needs S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (R2 > Manage API tokens).',
        );
      }
      // The dashboard shows the S3 API address with the bucket on the end;
      // pasted as-is, every key would land under a second bucket prefix.
      if (new URL(cfg.S3_ENDPOINT!).pathname.replace(/\/+$/, '') !== '') {
        throw new InternalServerErrorException(
          'S3_ENDPOINT must be https://<account-id>.r2.cloudflarestorage.com with nothing after it - put the bucket name in S3_BUCKET.',
        );
      }
      if (cfg.S3_SSE === 'aws:kms') {
        throw new InternalServerErrorException('Cloudflare R2 has no KMS: leave S3_SSE unset (R2 encrypts every object with AES-256).');
      }
    }
    this.client = new S3Client({
      region: cfg.S3_REGION ?? 'auto',
      // R2 and B2 need an explicit endpoint; plain AWS does not.
      ...(cfg.S3_ENDPOINT
        ? {
            endpoint: cfg.S3_ENDPOINT,
            forcePathStyle: true,
            // Since 3.729 the SDK adds CRC32 checksums to every request, in
            // headers R2 (and other S3-compatible stores) reject. Send one only
            // where the S3 API requires it, as the SDK did before.
            requestChecksumCalculation: 'WHEN_REQUIRED' as const,
            responseChecksumValidation: 'WHEN_REQUIRED' as const,
          }
        : {}),
      ...(cfg.S3_ACCESS_KEY_ID && cfg.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: cfg.S3_ACCESS_KEY_ID,
              secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Immutable content addressed by a unique key - safe to cache hard.
        CacheControl: 'private, max-age=31536000, immutable',
        ...this.encryption(),
      }),
    );
    return { key, size: body.byteLength };
  }

  /**
   * Encryption at rest, done by the bucket: S3_SSE, with S3_KMS_KEY_ID for
   * aws:kms. R2 always encrypts (AES-256) and does not accept the header.
   */
  private encryption(): { ServerSideEncryption?: 'AES256' | 'aws:kms'; SSEKMSKeyId?: string } {
    const cfg = env();
    if (this.r2 || cfg.S3_SSE === 'none') return {};
    return {
      ServerSideEncryption: cfg.S3_SSE,
      ...(cfg.S3_SSE === 'aws:kms' && cfg.S3_KMS_KEY_ID ? { SSEKMSKeyId: cfg.S3_KMS_KEY_ID } : {}),
    };
  }

  async read(key: string): Promise<Buffer> {
    const stream = await this.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  async copy(from: string, to: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: to,
        CopySource: `${this.bucket}/${encodeURIComponent(from).replace(/%2F/g, '/')}`,
        ...this.encryption(),
      }),
    );
  }

  async get(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) throw new NotFoundException('File not found.');
      return res.Body as Readable;
    } catch {
      throw new NotFoundException('File not found.');
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
