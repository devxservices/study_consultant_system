/**
 * A consultancy's brand colour, turned into the nine `brand-*` steps the design
 * system is built on.
 *
 * Only one hex is stored per consultancy. The ramp is derived in OKLCH, where
 * lightness is perceptual, so the steps land at the same visual weight whatever
 * hue a consultancy picks - a yellow and a navy produce tints that read as the
 * same system.
 *
 * The one hard rule: `brand-600` is the primary button fill, with white text on
 * it, so its lightness is clamped to keep that text readable (roughly 5:1 or
 * better) even when someone picks a pale colour. Their exact colour is used
 * when it is already dark enough; otherwise the closest darker shade of it.
 */

type Rgb = [number, number, number];
interface Oklch {
  l: number;
  c: number;
  h: number;
}

const STEPS = ['50', '100', '200', '400', '500', '600', '700', '800', '900'] as const;
type Step = (typeof STEPS)[number];

export function brandCss(hex: string | null | undefined): string | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const base = toOklch(hex);
  const light = lightRamp(base);
  const dark = darkRamp(base);

  // `html:root` / `html[data-theme]` outrank the unprefixed selectors in
  // globals.css, so this wins wherever the stylesheet ends up in <head>.
  return [
    `html:root{${declarations(light)}}`,
    `html[data-theme='dark']{${declarations(dark)}}`,
  ].join('');
}

function declarations(ramp: Record<Step, string>): string {
  return STEPS.map((s) => `--color-brand-${s}:${ramp[s]};`).join('');
}

/** Light theme: 50-200 are faint surface tints, 600 the fill, 700+ text. */
function lightRamp(base: Oklch): Record<Step, string> {
  const c = Math.min(base.c, 0.2);
  const l600 = clamp(base.l, 0.36, 0.52);
  const at = (l: number, cf: number) => fromOklch({ l, c: c * cf, h: base.h });
  return {
    '50': at(0.975, 0.12),
    '100': at(0.945, 0.22),
    '200': at(0.885, 0.4),
    '400': at(Math.min(0.78, l600 + 0.18), 0.9),
    '500': at(Math.min(0.66, l600 + 0.08), 1),
    '600': Math.abs(l600 - base.l) < 0.005 && base.c <= 0.2 ? hex6(base) : at(l600, 1),
    '700': at(Math.max(0.26, l600 - 0.07), 0.95),
    '800': at(Math.max(0.22, l600 - 0.14), 0.85),
    '900': at(Math.max(0.18, l600 - 0.22), 0.7),
  };
}

/**
 * Dark theme: the scale is inverted, as it is for the default palette - 50-200
 * are dark tinted surfaces, 700-900 the light text used for links and active
 * labels. 600 is still a fill with white text on it.
 */
function darkRamp(base: Oklch): Record<Step, string> {
  const c = Math.min(base.c, 0.18);
  const at = (l: number, cf: number) => fromOklch({ l, c: c * cf, h: base.h });
  return {
    '50': at(0.25, 0.3),
    '100': at(0.29, 0.4),
    '200': at(0.35, 0.5),
    '400': at(0.72, 0.8),
    '500': at(0.62, 0.9),
    '600': at(0.5, 1),
    '700': at(0.8, 0.7),
    '800': at(0.87, 0.5),
    '900': at(0.93, 0.3),
  };
}

/* ------------------------------------------------------------------ */
/* Colour maths: sRGB <-> OKLab <-> OKLCH                              */
/* ------------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToLinear({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -0.0001 && v <= 1.0001);

/**
 * Back to hex, pulling chroma in until the colour fits sRGB. Lightness and hue
 * are what make a step read as "the same brand, lighter", so they are kept and
 * saturation gives way.
 */
function fromOklch(color: Oklch): string {
  let lo = 0;
  let hi = color.c;
  let rgb = oklchToLinear(color);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear({ ...color, c: lo });
  }
  return rgbToHex(rgb);
}

function hex6(color: Oklch): string {
  return rgbToHex(oklchToLinear(color));
}

function rgbToHex(linear: Rgb): string {
  return (
    '#' +
    linear
      .map((v) => Math.round(clamp(toGamma(clamp(v, 0, 1)), 0, 1) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}
