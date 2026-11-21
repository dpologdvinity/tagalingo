/**
 * Colour helpers for meeting WCAG contrast requirements.
 *
 * `contrastRatio` is the WCAG 2.x formula (relative luminance of sRGB colours). The app puts white
 * text on several data-driven colours — learner avatars and unit headers — so those colours are
 * checked here rather than trusted: WCAG AA needs 4.5:1 for normal-size text.
 */

/** WCAG AA minimum contrast for normal-size text. */
export const AA_TEXT_CONTRAST = 4.5;

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of a `#rrggbb` colour (0 = black, 1 = white). */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 (same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Convert CSS `hsl(h s% l%)` to `#rrggbb`. */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const AVATAR_SATURATION = 55;
const AVATAR_MAX_LIGHTNESS = 42;

/**
 * Background for a learner's avatar from their hue. Starts at the design's 42% lightness and
 * darkens only as far as needed for white initials to reach AA contrast; yellows and greens need
 * the most, blues need none.
 */
export function avatarColor(hue: number): string {
  const h = ((Math.round(hue) % 360) + 360) % 360;
  for (let l = AVATAR_MAX_LIGHTNESS; l > 0; l -= 0.5) {
    const hex = hslToHex(h, AVATAR_SATURATION, l);
    if (contrastRatio(hex, "#ffffff") >= AA_TEXT_CONTRAST) return hex;
  }
  return hslToHex(h, AVATAR_SATURATION, 0);
}
