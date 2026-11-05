import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import net from 'node:net';
import { env } from '../config/env';

export interface ScanResult {
  clean: boolean;
  /** The signature that matched, when not clean. */
  signature?: string;
}

/**
 * Scans every upload before it is stored, when VIRUS_SCAN=clamav.
 *
 * Speaks clamd's INSTREAM protocol over TCP: the file goes in length-prefixed
 * chunks and clamd answers "stream: OK" or "stream: <Signature> FOUND". It
 * fails closed - a scanner that is configured but unreachable refuses the
 * upload - because the point of configuring one is that nothing unscanned
 * gets through.
 */
@Injectable()
export class VirusScanner {
  private readonly logger = new Logger(VirusScanner.name);

  get enabled(): boolean {
    return env().VIRUS_SCAN === 'clamav';
  }

  /** Throws a user-facing error for an infected file or an unreachable scanner. */
  async assertClean(buffer: Buffer, fileName: string): Promise<void> {
    if (!this.enabled) return;
    let result: ScanResult;
    try {
      result = await scanWithClamd(buffer, env().CLAMAV_HOST, env().CLAMAV_PORT);
    } catch (err) {
      this.logger.error(`virus scanner unreachable: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'Files cannot be checked for viruses right now, so they cannot be accepted. Please try again shortly.',
      );
    }
    if (!result.clean) {
      this.logger.warn(`upload refused, ${fileName}: ${result.signature}`);
      throw new BadRequestException({
        message: 'This file was flagged by the virus scanner and was not accepted.',
        fieldErrors: { file: 'Flagged by the virus scanner.' },
      });
    }
  }
}

const CHUNK = 64 * 1024;

export function scanWithClamd(buffer: Buffer, host: string, port: number, timeoutMs = 15_000): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let reply = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('clamd timed out'));
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < buffer.length; i += CHUNK) {
        const part = buffer.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length, 0);
        socket.write(size);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero length: end of stream
    });
    socket.on('data', (d) => {
      reply += d.toString('utf8');
    });
    socket.on('end', () => {
      clearTimeout(timer);
      const text = reply.replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(text)) return resolve({ clean: true });
      const found = /:\s*(.+)\s+FOUND$/.exec(text);
      if (found) return resolve({ clean: false, signature: found[1]! });
      reject(new Error(`unexpected clamd reply: ${text.slice(0, 120)}`));
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
