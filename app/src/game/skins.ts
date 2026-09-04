import type { Skin } from './protocol';

/**
 * Turn a skin plus a base colour into one colour per body bead.
 *
 * Doing this per frame for every snake would be wasteful, so results are cached
 * on (skin, colour, beadCount) — a snake's bead count only changes when it eats.
 */
const cache = new Map<string, string[]>();

/** Gradients are quantised to this many steps so a body needs few draw calls. */
const GRADIENT_STEPS = 6;

export function beadColors(
  skin: Skin | undefined,
  baseColor: string,
  beads: number
): string[] {
  if (beads <= 0) return [];
  const id = skin?.id ?? 'classic';
  const key = `${id}|${baseColor}|${beads}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const out = build(skin, baseColor, beads);
  // Keep the cache from growing without bound over a long session.
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}

function build(skin: Skin | undefined, baseColor: string, beads: number): string[] {
  // 'classic' has no pattern of its own — it wears the colour you picked.
  const pattern = skin?.pattern && skin.pattern.length ? skin.pattern : [baseColor];

  if (skin?.mode === 'gradient' && pattern.length > 1) {
    const steps: string[] = [];
    for (let i = 0; i < GRADIENT_STEPS; i++) {
      steps.push(sampleGradient(pattern, i / (GRADIENT_STEPS - 1)));
    }
    return Array.from({ length: beads }, (_, i) => {
      const t = beads === 1 ? 0 : i / (beads - 1);
      return steps[Math.min(GRADIENT_STEPS - 1, Math.round(t * (GRADIENT_STEPS - 1)))];
    });
  }

  const band = Math.max(1, skin?.band ?? 1);
  return Array.from(
    { length: beads },
    (_, i) => pattern[Math.floor(i / band) % pattern.length]
  );
}

/** Blend across a list of stops. */
function sampleGradient(stops: string[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const span = 1 / (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(clamped / span));
  const local = (clamped - idx * span) / span;
  return mix(stops[idx], stops[idx + 1], local);
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');

/**
 * The highlight colour for a scale's leading edge.
 *
 * Lightening the bead colour rather than using one fixed highlight keeps a
 * banded skin readable — a gold band and a crimson band need different
 * highlights or the lighter band loses its edge entirely. Cached alongside
 * the bead colours since it is called per bead per frame.
 */
const scaleCache = new Map<string, string>();

export function scaleHighlight(skin: Skin | undefined, beadColor: string): string {
  const tint = skin?.scales?.tint;
  if (tint) return tint;
  const hit = scaleCache.get(beadColor);
  if (hit) return hit;
  const out = mix(beadColor, '#FFFFFF', 0.26);
  if (scaleCache.size > 200) scaleCache.clear();
  scaleCache.set(beadColor, out);
  return out;
}

/**
 * A shade of `color`, `t` of the way to black.
 *
 * For texture that is meant to be felt rather than seen: a snake's scales are
 * barely a shade off its skin, and anything stronger reads as a pattern.
 */
export function shade(color: string, t: number): string {
  return mix(color, '#000000', t);
}

/**
 * A lighter shade of `color`, `t` of the way to white.
 *
 * The counterpart to `shade`, and cached for the same reason: the serpent body
 * calls it once per scale per frame to lift each plate's inner petal off the
 * plate around it.
 */
const liftCache = new Map<string, string>();

export function lighten(color: string, t: number): string {
  const key = `${color}|${t}`;
  const hit = liftCache.get(key);
  if (hit) return hit;
  const out = mix(color, '#FFFFFF', t);
  if (liftCache.size > 200) liftCache.clear();
  liftCache.set(key, out);
  return out;
}

/** The colour a skin should tint its name plate / preview with. */
export function skinAccent(skin: Skin | undefined, baseColor: string): string {
  if (!skin?.pattern || skin.pattern.length === 0) return baseColor;
  return skin.pattern[0];
}
