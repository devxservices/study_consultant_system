import sharp from 'sharp';
import { monogramParams, monogramSvg } from '@/lib/monogram-svg';
import { IconsBusyError, cachedIcon, iconResponse, overBudget } from '@/lib/icon-guard';

/**
 * The browser-tab icon for a consultancy that has not uploaded one: its
 * monogram on its brand colour, the menu tile's drawing.
 *
 *   /brand-icon?i=MC&c=09580b          SVG, for every current browser
 *   /brand-icon?i=MC&c=09580b&px=32    PNG, for the ones that want a bitmap
 *
 * Everything it draws is in the URL (the layout adds a ?v= for the drawing
 * itself), so a response never changes and is cached for good - no lookup of
 * the consultancy, no API call, nothing to go stale. Anyone can call it, so
 * the input is held to what a monogram can be, 32 is the only bitmap size,
 * and lib/icon-guard limits each address and keeps what it has drawn.
 */
export async function GET(req: Request): Promise<Response> {
  const limited = overBudget(req);
  if (limited) return limited;

  const url = new URL(req.url);
  const params = monogramParams(url);
  if (!params) return new Response('Bad monogram', { status: 400 });
  const px = url.searchParams.get('px');
  if (px !== null && px !== '32') return new Response('Bad size', { status: 400 });

  const key = `${px ?? 'svg'}:${params.initials}:${params.hex ?? ''}`;
  try {
    if (px === null) {
      const svg = await cachedIcon(key, async () => Buffer.from(monogramSvg(params.initials, params.hex)));
      return iconResponse(svg, 'image/svg+xml; charset=utf-8');
    }
    const png = await cachedIcon(key, () =>
      sharp(Buffer.from(monogramSvg(params.initials, params.hex)), { density: 36 })
        .resize(32, 32)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
    return iconResponse(png, 'image/png');
  } catch (err) {
    if (err instanceof IconsBusyError) return new Response('Busy', { status: 503, headers: { 'Retry-After': '2' } });
    throw err;
  }
}
