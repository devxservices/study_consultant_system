// Server side only (the /brand-icon routes): the outline table is 26 KB that no
// page needs - the menu tile is drawn by the browser in the same font.
import { MONOGRAM, brandTileStops, monogramFontRatio } from './brand';
import { INTER_ASCENT, INTER_BOLD, INTER_BOLD_UPM, INTER_DESCENT } from './monogram-glyphs';

/**
 * The monogram as an SVG: the menu tile's drawing, for the browser tab and
 * the home-screen icon.
 *
 * Latin capitals and digits are drawn from Inter Bold's own outlines, placed
 * the way the browser places them in the tile (same size ratio, same -0.03em
 * tracking after each letter, baseline where a 1-line-high Inter line box puts
 * it). Initials in another script fall back to <text> in the system's sans.
 *
 * `square` drops the rounded corners - iOS rounds a home-screen icon itself.
 */
export function monogramSvg(initials: string, hex: string | null, { square = false } = {}): string {
  const S = 64;
  const [from, to] = brandTileStops(hex);
  const chars = Array.from(initials);
  const F = S * monogramFontRatio(initials);
  const rx = square ? 0 : +(S * MONOGRAM.radius).toFixed(2);

  let letters: string;
  if (chars.every((ch) => INTER_BOLD[ch])) {
    const k = F / INTER_BOLD_UPM;
    const tracking = MONOGRAM.tracking * F;
    const width = chars.reduce((sum, ch) => sum + INTER_BOLD[ch]!.w * k + tracking, 0);
    // A line box one font-size tall, centred in the tile: half-leading, then the ascent.
    const contentArea = (INTER_ASCENT + INTER_DESCENT) / INTER_BOLD_UPM;
    const baseline = S / 2 - F / 2 + ((1 - contentArea) * F) / 2 + (INTER_ASCENT / INTER_BOLD_UPM) * F;
    let x = S / 2 - width / 2;
    letters = chars
      .map((ch) => {
        const g = INTER_BOLD[ch]!;
        const path = `<path transform="translate(${r(x)} ${r(baseline)}) scale(${k.toFixed(6)})" d="${g.d}"/>`;
        x += g.w * k + tracking;
        return path;
      })
      .join('');
    letters = `<g fill="#fff">${letters}</g>`;
  } else {
    letters = `<text x="32" y="32" dy="0.36em" text-anchor="middle" fill="#fff" font-family="'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif" font-weight="700" font-size="${r(F)}">${escapeXml(initials)}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="${S}" height="${S}" rx="${rx}" fill="url(#g)"/>${letters}</svg>`
  );
}

/**
 * Parses the ?i= and ?c= of a monogram URL. Only what a monogram can be gets
 * through: one or two letters or digits, and a six-digit hex colour.
 */
export function monogramParams(url: URL): { initials: string; hex: string | null } | null {
  const initials = url.searchParams.get('i') ?? '';
  const chars = Array.from(initials);
  if (chars.length < 1 || chars.length > 2 || !chars.every((ch) => /[\p{L}\p{N}]/u.test(ch))) return null;
  const c = url.searchParams.get('c');
  if (c !== null && !/^[0-9a-f]{6}$/i.test(c)) return null;
  return { initials, hex: c ? `#${c}` : null };
}

const r = (n: number) => +n.toFixed(2);

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
