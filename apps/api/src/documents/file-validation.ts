import { BadRequestException } from '@nestjs/common';
import { UPLOAD_LIMITS, UPLOAD_TYPES } from '@crm/shared';

function acceptedLabel(accepted: readonly string[]): string {
  const labels = UPLOAD_TYPES.filter((t) => accepted.includes(t.mime)).map((t) => t.label);
  if (labels.length <= 1) return labels[0] ?? 'supported';
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
}

/**
 * What the file actually is, read from its leading bytes.
 *
 * The browser-supplied content type is a claim, not a fact - renaming
 * payload.exe to passport.pdf sets it to application/pdf. Everything stored
 * here is later handed back to staff to open, so the real format is checked
 * before anything is written.
 */
export function sniffMimeType(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'application/pdf';
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heim'].includes(brand)) return 'image/heic';
  }
  // A .docx is a ZIP whose entries include word/document.xml. Any other ZIP
  // (or a renamed archive) is refused: being a ZIP is not enough.
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    if (buf.includes(DOCX_MARKER)) return DOCX_MIME;
  }

  return null;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOCX_MARKER = Buffer.from('word/document.xml', 'ascii');

export interface ValidatedFile {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  size: number;
}

const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  [DOCX_MIME]: 'docx',
};

/** Strips any path or trickery a filename might be carrying. */
export function safeFileName(original: string, mimeType: string): string {
  const base = (original.split(/[\/]/).pop() ?? 'document')
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const ext = EXTENSION[mimeType] ?? 'bin';
  const stem = base.replace(/\.[^.]*$/, '') || 'document';
  return `${stem}.${ext}`;
}

export function validateUpload(file: {
  buffer: Buffer;
  originalname: string;
  size: number;
}, rules: { maxBytes?: number; accepted?: readonly string[] } = {}): ValidatedFile {
  if (!file.buffer?.length) {
    throw new BadRequestException({
      message: 'That file appears to be empty.',
      fieldErrors: { file: 'The file is empty.' },
    });
  }

  const maxBytes = rules.maxBytes ?? UPLOAD_LIMITS.maxBytes;
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    throw new BadRequestException({
      message: `Files must be ${mb} MB or smaller.`,
      fieldErrors: { file: `This file is too large. The limit is ${mb} MB.` },
    });
  }

  // The type is read from the file's first bytes, never from its name or the
  // browser's claim, so a renamed executable is refused.
  const accepted = rules.accepted ?? UPLOAD_LIMITS.acceptedMimeTypes;
  const actual = sniffMimeType(file.buffer);
  if (!actual || !accepted.includes(actual)) {
    const names = acceptedLabel(accepted);
    throw new BadRequestException({
      message: `Only ${names} files can be uploaded.`,
      fieldErrors: { file: `That file type is not accepted. Upload ${names}.` },
    });
  }

  return {
    buffer: file.buffer,
    mimeType: actual,
    fileName: safeFileName(file.originalname, actual),
    size: file.size,
  };
}
