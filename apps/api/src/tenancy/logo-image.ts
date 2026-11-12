import sharp from 'sharp';
import { LOGO_MAX_BYTES, LOGO_MAX_PIXELS } from '@crm/shared';

/**
 * A logo, as uploaded, is whatever someone had to hand: a 3,500-pixel export,
 * a photo with GPS in its metadata, a square with half its area transparent
 * margin. It is shown on every page and is the browser-tab icon, so it is
 * stored the way it is shown:
 *
 *  - decoded for real - a file that only starts with PNG bytes is refused;
 *  - turned upright (phone photos store rotation in EXIF) and stripped of all
 *    metadata;
 *  - trimmed of empty margin, so the artwork fills the space it is given;
 *  - the icon padded to a square no larger than 256 px (sharp enough for a 3x
 *    phone screen and a printed invoice); the full logo fitted inside
 *    1200 x 300;
 *  - written as a palette PNG: transparency kept, and PDFKit (invoices,
 *    receipts) can embed it.
 *
 * Nothing is ever enlarged, so a small upload is not blurred.
 */
export type LogoKind = 'icon' | 'full';

export const ICON_MAX = 256;
export const FULL_MAX = { width: 1200, height: 300 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * What the upload routes let through, before any of it is read: one part, and
 * that part the file, no larger than the cap. Anything else ends the request
 * while it is still arriving.
 */
export const LOGO_UPLOAD_LIMITS = { fileSize: LOGO_MAX_BYTES, files: 1, fields: 0, parts: 1 } as const;

export class UnreadableImageError extends Error {}
export class ImagesBusyError extends Error {}

/**
 * Decoding is the heaviest thing a request here can ask for (a 4096 x 4096
 * image is 64 MB of pixels), so only two run at once and a short queue waits;
 * past that, a request is told to try again rather than piling up memory.
 */
const MAX_PARALLEL = 2;
const MAX_WAITING = 16;
let running = 0;
const waiting: (() => void)[] = [];

async function inImageSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < MAX_PARALLEL) running++;
  else if (waiting.length >= MAX_WAITING) throw new ImagesBusyError('Busy processing images. Please try again in a moment.');
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    // Hand the slot straight to the next in line, so nobody slips in between.
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

export function normalizeLogo(input: Buffer, kind: LogoKind): Promise<{ data: Buffer; width: number; height: number }> {
  return inImageSlot(() => normalize(input, kind));
}

async function normalize(input: Buffer, kind: LogoKind): Promise<{ data: Buffer; width: number; height: number }> {
  let upright: Buffer;
  try {
    // Only the first frame of an animated WebP is read (sharp's default).
    upright = await sharp(input, { limitInputPixels: LOGO_MAX_PIXELS, failOn: 'error' })
      .rotate()
      .toBuffer();
  } catch (err) {
    if (/pixel limit/i.test((err as Error).message)) {
      throw new UnreadableImageError('That image is larger than 4096 × 4096 pixels. Export it smaller and try again.');
    }
    throw new UnreadableImageError('That image could not be read. Export it again as a PNG and retry.');
  }

  // Trimming takes the corner colour as the margin. An image of one flat colour
  // has nothing but margin, and sharp refuses it - keep it as it is then.
  let trimmed = upright;
  try {
    trimmed = await sharp(upright).trim({ threshold: 1 }).toBuffer();
  } catch {
    /* nothing to trim */
  }

  const img = sharp(trimmed);
  const { width = 0, height = 0 } = await img.metadata();
  if (!width || !height) throw new UnreadableImageError('That image could not be read. Export it again as a PNG and retry.');

  if (kind === 'icon') {
    const side = Math.min(ICON_MAX, Math.max(width, height));
    img.resize(side, side, { fit: 'contain', background: CLEAR });
  } else {
    img.resize(FULL_MAX.width, FULL_MAX.height, { fit: 'inside', withoutEnlargement: true });
  }

  const { data, info } = await img
    .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10, dither: 1 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * The home-screen icon iOS asks for: 180 px, opaque (iOS paints transparency
 * black) and full-bleed (iOS rounds the corners itself), the icon centred on
 * white with a little room around it.
 */
export function touchIcon(icon: Buffer): Promise<Buffer> {
  return inImageSlot(() => renderTouchIcon(icon));
}

async function renderTouchIcon(icon: Buffer): Promise<Buffer> {
  const inner = await sharp(icon, { limitInputPixels: LOGO_MAX_PIXELS })
    .resize(140, 140, { fit: 'contain', background: CLEAR })
    .toBuffer();
  return sharp({ create: { width: 180, height: 180, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: inner, gravity: 'center' }])
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 })
    .toBuffer();
}
