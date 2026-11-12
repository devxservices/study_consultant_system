import sharp from 'sharp';
import { monogramParams, monogramSvg } from '@/lib/monogram-svg';
import { IconsBusyError, cachedIcon, iconResponse, overBudget } from '@/lib/icon-guard';

/**
 * The monogram as an iPhone home-screen icon: 180 px PNG, square and opaque -
 * iOS rounds the corners itself and would paint transparency black. Guarded
 * and cached like /brand-icon.
 */
export async function GET(req: Request): Promise<Response> {
  const limited = overBudget(req);
  if (limited) return limited;

  const params = monogramParams(new URL(req.url));
  if (!params) return new Response('Bad monogram', { status: 400 });
  try {
    const png = await cachedIcon(`apple:${params.initials}:${params.hex ?? ''}`, () =>
      sharp(Buffer.from(monogramSvg(params.initials, params.hex, { square: true })), { density: 203 })
        .resize(180, 180)
        .flatten({ background: '#ffffff' })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
    return iconResponse(png, 'image/png');
  } catch (err) {
    if (err instanceof IconsBusyError) return new Response('Busy', { status: 503, headers: { 'Retry-After': '2' } });
    throw err;
  }
}
