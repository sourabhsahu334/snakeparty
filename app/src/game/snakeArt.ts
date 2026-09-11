import {
  FilterMode,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  type SkPath,
} from '@shopify/react-native-skia';

import type { Skin } from './protocol';
import { scaleHighlight, shade } from './skins';

/**
 * Snake head art, shared by the arena and the skin picker.
 *
 * This used to live inside GameCanvas's draw loop. The picker draws the same
 * snake with the same skin, so the two have to agree exactly — anything a
 * player sees in the menu has to be what turns up in the match, which a second
 * hand-rolled copy would not stay true to for long.
 */

/**
 * Bead spacing, as a fraction of the snake's own radius.
 *
 * This has to scale with the snake, not with its length. A body grows linearly
 * with score while its radius only grows with sqrt(score), so any fixed cap on
 * bead *count* makes the stride climb linearly and the body eventually renders
 * as a string of separated discs — visible from roughly score 200, and about
 * ten radii apart by score 3000. Spacing off the radius keeps the overlap
 * constant at every size.
 */
export const BEAD_PITCH = 0.6;
/**
 * Scale geometry, as a fraction of the bead radius.
 *
 * The offset is how far the highlight disc is pushed toward the head, and the
 * radius how big it is. Together they leave a crescent of base colour at the
 * trailing edge — that crescent *is* the scale's edge. Push too far and the
 * scales detach into a dotted line; too little and the body just looks
 * washed out.
 */
export const SCALE_OFFSET = 0.34;
export const SCALE_RADIUS = 0.72;
/**
 * Distance between scales, in bead radii.
 *
 * Beads overlap far more densely than scales should: place one scale per bead
 * and each highlight buries the crescent of the bead behind it, which reads as
 * a snake that is simply a lighter colour. Spacing by distance rather than by
 * bead index also keeps the look identical whatever stride the bead loop picks.
 */
export const SCALE_PITCH = 0.95;

/**
 * Spacing between flame tongues, in bead radii.
 *
 * Tight, because on a burning skin the tongues *are* the body — the round
 * beads underneath are not drawn at all. Spaced any wider and the fire breaks
 * into separate licks with arena showing through the gaps between them.
 */
export const FLAME_PITCH = 0.8;

/**
 * Scale texture for a smooth body: row spacing and the across-body offsets,
 * alternating so the rows sit in a brick bond like real scales.
 *
 * Coarser than it looks in a photograph on purpose. These are drawn every
 * frame for every visible stretch of body, and the difference between a
 * texture you can feel and a texture that costs the frame rate is roughly this
 * spacing.
 */
/**
 * How much wider a smooth skin's head is than its body.
 *
 * A bead snake's head is one more bead; an animal's head is a skull, and in
 * both reference photographs it is noticeably broader than the neck it sits
 * on. Everything in the face is measured against this, not against the body.
 */
export const SMOOTH_HEAD_SCALE = 1.34;

export const SMOOTH_SCALE_PITCH = 0.55;
export const SMOOTH_SCALE_COLS: number[][] = [
  [-0.72, -0.24, 0.24, 0.72],
  [-0.48, 0, 0.48],
];
/** Scute size, in bead radii. Small enough to read as skin, not as armour. */
export const SMOOTH_SCALE_SIZE = 0.46;
/** How far toward black the scales sit. Any stronger and it becomes a pattern. */
export const SMOOTH_SCALE_SHADE = 0.19;

/**
 * A small triangular scale, tip trailing down the body.
 *
 * Sharper than `dragonScaleInto`, which is a rounded scute for plate armour.
 * On real skin the scales read as little triangles in rows, and at the size
 * these are drawn the difference between a leaf and a triangle is the whole
 * difference between "shaded" and "scaly".
 */
export function fineScaleInto(
  path: SkPath,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  size = SMOOTH_SCALE_SIZE
): void {
  const fx = dx * r * size;
  const fy = dy * r * size;
  const ax = -dy * r * size;
  const ay = dx * r * size;
  const px = (f: number, a: number) => x + fx * f + ax * a;
  const py = (f: number, a: number) => y + fy * f + ay * a;

  path.moveTo(px(-1.05, 0), py(-1.05, 0));
  path.lineTo(px(0.5, 0.6), py(0.5, 0.6));
  path.quadTo(px(0.82, 0), py(0.82, 0), px(0.5, -0.6), py(0.5, -0.6));
  path.close();
}

/**
 * Row spacing for dragon scales, in bead radii. Tighter than a plain scute's
 * pitch because these overlap like roof tiles — each row has to cover the
 * shoulders of the row behind it or the lattice reads as scattered leaves.
 */
export const DRAGON_ROW_PITCH = 0.62;

/**
 * Across-body offsets per row, alternating, in bead radii.
 *
 * Three scales then two, offset by half a scale: the brick bond is what makes
 * a pinecone read as armour rather than as stripes. Spaced fractionally wider
 * than a scale, so the body colour survives between them — that seam is what
 * separates one scale from the next; without it the fills merge into a blob.
 * Kept inside ±1 so no scale hangs off the edge of the body it sits on.
 */
export const DRAGON_COLS: number[][] = [
  [-0.62, 0, 0.62],
  [-0.31, 0.31],
];

/**
 * One dragon scute: a rounded shoulder toward the head narrowing to a point
 * down the body, the way every scale on a real snake lies.
 */
export function dragonScaleInto(
  path: SkPath,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  size = 0.55
): void {
  const fx = dx * r * size;
  const fy = dy * r * size;
  const ax = -dy * r * size;
  const ay = dx * r * size;
  const px = (f: number, a: number) => x + fx * f + ax * a;
  const py = (f: number, a: number) => y + fy * f + ay * a;

  path.moveTo(px(-1.02, 0), py(-1.02, 0));
  path.quadTo(px(-0.35, 0.5), py(-0.35, 0.5), px(0.34, 0.5), py(0.34, 0.5));
  path.quadTo(px(0.74, 0.32), py(0.74, 0.32), px(0.74, 0), py(0.74, 0));
  path.quadTo(px(0.74, -0.32), py(0.74, -0.32), px(0.34, -0.5), py(0.34, -0.5));
  path.quadTo(px(-0.35, -0.5), py(-0.35, -0.5), px(-1.02, 0), py(-1.02, 0));
  path.close();
}

/**
 * Row spacing and across-body offsets for the serpent lattice.
 *
 * Wider rows than `dragon` and only two scales across: these are big ornamental
 * plates, not chain mail, and the reference art gets its look from a few large
 * scales with clear gaps rather than from many small ones.
 */
export const SERPENT_ROW_PITCH = 0.6;
export const SERPENT_COLS: number[][] = [
  [-0.66, 0, 0.66],
  [-0.34, 0.34],
];
/**
 * Plate size against the bed beneath it.
 *
 * The gap is the point: every plate is laid over a slightly larger one in the
 * skin's dark edge colour, so what separates one scale from the next is an ink
 * line rather than a change of green. Shapes that merely abut read as flat
 * colour; shapes with a line between them read as drawn.
 */
export const SERPENT_PLATE = 0.5;

/**
 * How far a plate sits toward white, by where it lies across the body.
 *
 * A lit spine down the middle falling away to darker flanks. This is the one
 * thing that stops a body reading as a flat cutout — the eye takes the tonal
 * step as the form turning away, and a snake gains a round back for the cost
 * of one extra path. Two steps only, deliberately: every extra tone is another
 * batched draw on every snake wearing the skin.
 */
export const SERPENT_LIFT = (across: number): number =>
  Math.abs(across) < 0.2 ? 0.34 : -0.06;

/**
 * One serpent scale: a broad petal, round at the shoulder and drawn to a soft
 * point down the body.
 *
 * Rounder and wider than `dragonScaleInto`, which is armour plate. The
 * reference art's scales read as leaves — a wide curved shoulder and a gentle
 * taper — and drawn twice at two sizes they layer the way overlapping foliage
 * does, which is the whole texture.
 */
export function serpentScaleInto(
  path: SkPath,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  size = 0.62
): void {
  const fx = dx * r * size;
  const fy = dy * r * size;
  const ax = -dy * r * size;
  const ay = dx * r * size;
  const px = (f: number, a: number) => x + fx * f + ax * a;
  const py = (f: number, a: number) => y + fy * f + ay * a;

  path.moveTo(px(-1.5, 0), py(-1.5, 0));
  path.quadTo(px(-0.55, 0.48), py(-0.55, 0.48), px(0.3, 0.58), py(0.3, 0.58));
  path.quadTo(px(0.9, 0.46), py(0.9, 0.46), px(1.0, 0), py(1.0, 0));
  path.quadTo(px(0.9, -0.46), py(0.9, -0.46), px(0.3, -0.58), py(0.3, -0.58));
  path.quadTo(px(-0.55, -0.48), py(-0.55, -0.48), px(-1.5, 0), py(-1.5, 0));
  path.close();
}

/**
 * The serpent skull: a broad shield, rounded at the snout and flaring wide
 * across the temples before it narrows into the neck.
 *
 * Neither of the other two skulls fits this. `pointedHeadInto` is a spearhead
 * and `snoutInto` is a real snake's slim head; the reference art is an
 * ornamental mask — much wider than the body, with the width carried well
 * forward so there is cheek to put the gold linework on.
 */
export function serpentHeadInto(
  path: SkPath,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  scale = 1
): void {
  const fx = dx * r * scale;
  const fy = dy * r * scale;
  const ax = -dy * r * scale;
  const ay = dx * r * scale;
  const px = (f: number, a: number) => x + fx * f + ax * a;
  const py = (f: number, a: number) => y + fy * f + ay * a;

  path.moveTo(px(1.5, 0), py(1.5, 0));
  path.quadTo(px(1.36, 0.28), py(1.36, 0.28), px(1.0, 0.52), py(1.0, 0.52));
  path.quadTo(px(0.34, 0.86), py(0.34, 0.86), px(-0.12, 1.0), py(-0.12, 1.0));
  path.quadTo(px(-0.86, 1.08), py(-0.86, 1.08), px(-1.3, 0.74), py(-1.3, 0.74));
  path.quadTo(px(-1.62, 0.46), py(-1.62, 0.46), px(-1.66, 0), py(-1.66, 0));
  path.quadTo(px(-1.62, -0.46), py(-1.62, -0.46), px(-1.3, -0.74), py(-1.3, -0.74));
  path.quadTo(px(-0.86, -1.08), py(-0.86, -1.08), px(-0.12, -1.0), py(-0.12, -1.0));
  path.quadTo(px(0.34, -0.86), py(0.34, -0.86), px(1.0, -0.52), py(1.0, -0.52));
  path.quadTo(px(1.36, -0.28), py(1.36, -0.28), px(1.5, 0), py(1.5, 0));
  path.close();
}

/**
 * One tapering crescent of linework, mirrored by `side`.
 *
 * Two quadratics — out along the outer edge, back along the inner one — so a
 * sweep is a single closed shape rather than a stroke that would need its own
 * paint and its own width at every size. The gap between the two control
 * points *is* the thickness, so a sweep tapers naturally to a point at both
 * ends, which is what makes the linework look drawn rather than stamped.
 *
 * Coordinates are (forward, across) in head radii, so a sweep keeps its place
 * on the skull however the snake is turned.
 */
function sweepInto(
  path: SkPath,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  side: 1 | -1,
  a: readonly [number, number],
  c1: readonly [number, number],
  b: readonly [number, number],
  c2: readonly [number, number]
): void {
  const fx = dx * r;
  const fy = dy * r;
  const ax = -dy * r * side;
  const ay = dx * r * side;
  const X = (p: readonly [number, number]) => x + fx * p[0] + ax * p[1];
  const Y = (p: readonly [number, number]) => y + fy * p[0] + ay * p[1];
  path.moveTo(X(a), Y(a));
  path.quadTo(X(c1), Y(c1), X(b), Y(b));
  path.quadTo(X(c2), Y(c2), X(a), Y(a));
  path.close();
}

/**
 * The gold linework, as (start, outer control, end, inner control) in head
 * radii. Mirrored down the midline, so only one side is described.
 *
 * Three strokes do the work: one long band from the nose back over the brow,
 * one shorter crescent along the jaw, and a small curl at the nostril. More
 * than this and the head turns to soup at arena size, where it is 30px across.
 */
const SERPENT_MARKS: ReadonlyArray<
  readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ]
> = [
  // The edge band: follows the silhouette from the snout round to the jaw,
  // set just inside it. This is the one that carries at arena size — a shape
  // read against the outline survives being 30px across; interior filigree
  // does not.
  [[1.3, 0.2], [0.12, 1.5], [-1.38, 0.46], [0.12, 1.24]],
  // A second, shorter band inboard of the first, so the edge reads as
  // brushwork rather than as one fat stripe.
  [[0.98, 0.26], [0.06, 1.1], [-1.16, 0.36], [0.06, 0.92]],
  // A short chevron across the brow, sweeping back off the eye.
  [[-0.44, 0.14], [-0.32, 0.56], [0.2, 0.8], [-0.46, 0.46]],
];

/**
 * Append one flame tongue, rooted at (x, y) and licking along (dx, dy), to an
 * existing path.
 *
 * Appending rather than returning a path matters: a long snake is hundreds of
 * tongues a frame, and allocating a path object for each one is what turns the
 * fire into a frame-rate problem. A whole burning body is two paths.
 *
 * Note what callers pass as the direction: a flame trails *backwards*, away
 * from the head, the way a torch streams behind a runner. Point these along
 * the heading instead and the snake looks like it is travelling tail first.
 *
 * Built from three quadratics: out along one flank, a curl over to the tip,
 * then back down the inside with the notch that makes it read as fire rather
 * than as a leaf. `side` mirrors the curl, and alternating it down the body is
 * what keeps a row of tongues from looking stamped.
 */
export function flameInto(
  path: SkPath,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  side: 1 | -1,
  scale = 1
): void {
  // Forward along the heading, across it to the flank.
  const fx = dx * r * scale;
  const fy = dy * r * scale;
  const ax = -dy * r * scale;
  const ay = dx * r * scale;
  const px = (f: number, a: number) => x + fx * f + ax * a * side;
  const py = (f: number, a: number) => y + fy * f + ay * a * side;

  path.moveTo(px(-0.55, 0.7), py(-0.55, 0.7));
  path.quadTo(px(0.4, 1.05), py(0.4, 1.05), px(1.05, 0.5), py(1.05, 0.5));
  path.quadTo(px(1.6, 0.2), py(1.6, 0.2), px(2.25, 0.3), py(2.25, 0.3));
  path.quadTo(px(1.4, -0.25), py(1.4, -0.25), px(0.95, -0.72), py(0.95, -0.72));
  path.quadTo(px(0.3, -1.05), py(0.3, -1.05), px(-0.55, -0.7), py(-0.55, -0.7));
  path.quadTo(px(-1.0, 0.0), py(-1.0, 0.0), px(-0.55, 0.7), py(-0.55, 0.7));
  path.close();
}

/**
 * A skull that comes to a point at the nose and sweeps back into two flanks,
 * for any skin whose body is built out of shapes rather than beads — a round
 * head on a scaled or burning body is the one thing that gives the beads away.
 * Drawn along the heading: this faces forward, unlike the scales behind it.
 */
export function pointedHeadInto(
  path: SkPath,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  scale = 1
): void {
  const fx = dx * r * scale;
  const fy = dy * r * scale;
  const ax = -dy * r * scale;
  const ay = dx * r * scale;
  const px = (f: number, a: number) => x + fx * f + ax * a;
  const py = (f: number, a: number) => y + fy * f + ay * a;

  path.moveTo(px(1.62, 0), py(1.62, 0));
  path.quadTo(px(0.78, 0.72), py(0.78, 0.72), px(-0.3, 0.98), py(-0.3, 0.98));
  path.quadTo(px(-1.1, 0.6), py(-1.1, 0.6), px(-1.25, 0), py(-1.25, 0));
  path.quadTo(px(-1.1, -0.6), py(-1.1, -0.6), px(-0.3, -0.98), py(-0.3, -0.98));
  path.quadTo(px(0.78, -0.72), py(0.78, -0.72), px(1.62, 0), py(1.62, 0));
  path.close();
}

/**
 * One almond eye, tilted out from the heading.
 *
 * A real snake's eye is a dark almond with a bright slit in it — the exact
 * inverse of the white-ball-and-dark-pupil every other skin here wears. Built
 * as a lens from two quads so it can be tilted without a canvas transform.
 */
export function almondEyeInto(
  path: SkPath,
  x: number,
  y: number,
  r: number,
  angle: number,
  long: number,
  wide: number
): void {
  const cx = Math.cos(angle);
  const sx = Math.sin(angle);
  const px = -sx;
  const py = cx;
  const ax = x + cx * long * r;
  const ay = y + sx * long * r;
  const bx = x - cx * long * r;
  const by = y - sx * long * r;
  path.moveTo(ax, ay);
  path.quadTo(x + px * wide * r * 1.34, y + py * wide * r * 1.34, bx, by);
  path.quadTo(x - px * wide * r * 1.34, y - py * wide * r * 1.34, ax, ay);
  path.close();
}

/**
 * A real snake's head: a rounded nose, cheeks flaring wide behind it, then a
 * narrowing back into the neck.
 *
 * Not the same shape as `pointedHeadInto`, which is a spearhead. Fire and
 * plating want that point; something built to look like an actual snake wants
 * the blunt snout and the jaw, because that is where the face reads from.
 */
export function snoutInto(
  path: SkPath,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  scale = 1
): void {
  const fx = dx * r * scale;
  const fy = dy * r * scale;
  const ax = -dy * r * scale;
  const ay = dx * r * scale;
  const px = (f: number, a: number) => x + fx * f + ax * a;
  const py = (f: number, a: number) => y + fy * f + ay * a;

  path.moveTo(px(1.46, 0), py(1.46, 0));
  path.quadTo(px(1.36, 0.6), py(1.36, 0.6), px(0.55, 0.9), py(0.55, 0.9));
  path.quadTo(px(-0.3, 1.0), py(-0.3, 1.0), px(-1.12, 0.6), py(-1.12, 0.6));
  path.quadTo(px(-1.5, 0.28), py(-1.5, 0.28), px(-1.5, 0), py(-1.5, 0));
  path.quadTo(px(-1.5, -0.28), py(-1.5, -0.28), px(-1.12, -0.6), py(-1.12, -0.6));
  path.quadTo(px(-0.3, -1.0), py(-0.3, -1.0), px(0.55, -0.9), py(0.55, -0.9));
  path.quadTo(px(1.36, -0.6), py(1.36, -0.6), px(1.46, 0), py(1.46, 0));
  path.close();
}

/** One tongue as its own path, for the handful of one-off flames on a head. */
export function flamePath(
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  side: 1 | -1,
  scale = 1
): SkPath {
  const path = Skia.Path.Make();
  flameInto(path, x, y, r, dx, dy, side, scale);
  return path;
}

/**
 * Cached local-space geometry for the two "sculpted" skins that were showing
 * up as slow — serpent and dragon.
 *
 * Every shape above (`dragonScaleInto`, `serpentScaleInto`, `serpentHeadInto`,
 * ...) takes a centre, a radius and a heading, and every caller in this file
 * and in GameCanvas was recomputing the same trig and calling into Skia's
 * path builder fresh every single frame — for a serpent's head that is over
 * fifty path verbs, for its body one whole extra shape *per scale*, on every
 * snake wearing the skin, every frame. None of that geometry actually
 * changes frame to frame: only where it is drawn (position), which way it
 * faces (heading) and how big it is (radius) do.
 *
 * So it is built exactly once, here, at radius 1, centred on the origin,
 * facing along +X (dx=1, dy=0) — "local space". Reproducing it at an actual
 * (x, y, r, angle) is then a `canvas.translate/rotate/scale` around one
 * cached path (see `drawLocalShape`) instead of a fresh set of quadTos, which
 * is what the geometry functions above are for everywhere except here.
 */
function buildUnitPath(build: (path: SkPath) => void): SkPath {
  const path = Skia.Path.Make();
  build(path);
  return path;
}

/** One dragon-scale row, all its across-positions merged into one shape. */
export const DRAGON_ROW_UNITS: SkPath[] = DRAGON_COLS.map((row) =>
  buildUnitPath((p) => {
    for (const across of row) dragonScaleInto(p, 0, across, 1, 1, 0);
  })
);

/**
 * Serpent scale beds, one merged shape per row — the bed is a single colour
 * regardless of where across the body it sits, so unlike the plates below it
 * can be merged into one shape per row.
 */
export const SERPENT_BED_ROW_UNITS: SkPath[] = SERPENT_COLS.map((row) =>
  buildUnitPath((p) => {
    for (const across of row) serpentScaleInto(p, 0, across, 1, 1, 0);
  })
);

/**
 * Serpent plates, one shape *per* across-position rather than merged by row:
 * `SERPENT_LIFT` shades each plate by where it sits across the body, so
 * plates in the same row can land in different colour buckets and can't share
 * a path the way the single-coloured bed can.
 */
export const SERPENT_PLATE_UNITS: SkPath[][] = SERPENT_COLS.map((row) =>
  row.map((across) =>
    buildUnitPath((p) => serpentScaleInto(p, 0, across, 1, 1, 0, SERPENT_PLATE))
  )
);

/** The dragon head's skull, and its four armour plates merged into one shape. */
const DRAGON_HEAD_SKULL_UNIT = buildUnitPath((p) => pointedHeadInto(p, 0, 0, 1, 1, 0, 1.15));
const DRAGON_HEAD_PLATES_UNIT = buildUnitPath((p) => {
  for (const [fwd, across, size] of [
    [0.72, 0, 0.72],
    [-0.05, -0.46, 0.8],
    [-0.05, 0.46, 0.8],
    [-0.72, 0, 0.8],
  ] as const) {
    dragonScaleInto(p, fwd, across, 1, 1, 0, size);
  }
});

/** The serpent head's skull outline, base, ridge plating and gold linework. */
const SERPENT_HEAD_EDGE_UNIT = buildUnitPath((p) => serpentHeadInto(p, 0, 0, 1, 1, 0, 1.1));
const SERPENT_HEAD_SKULL_UNIT = buildUnitPath((p) => serpentHeadInto(p, 0, 0, 1, 1, 0, 1.0));
const SERPENT_HEAD_PLATES: readonly (readonly [number, number, number])[] = [
  [1.02, 0, 0.28],
  [0.56, 0, 0.36],
  [0.04, 0, 0.4],
  [-0.52, 0, 0.4],
  [-1.04, 0, 0.34],
  [0.3, 0.5, 0.26],
  [-0.34, 0.56, 0.28],
  [-0.94, 0.46, 0.24],
  [0.3, -0.5, 0.26],
  [-0.34, -0.56, 0.28],
  [-0.94, -0.46, 0.24],
];
const SERPENT_HEAD_BED_UNIT = buildUnitPath((p) => {
  for (const [fwd, across, size] of SERPENT_HEAD_PLATES) serpentScaleInto(p, fwd, across, 1, 1, 0, size);
});
const SERPENT_HEAD_SPINE_UNIT = buildUnitPath((p) => {
  for (const [fwd, across, size] of SERPENT_HEAD_PLATES) {
    if (across === 0) serpentScaleInto(p, fwd, across, 1, 1, 0, size * 0.72);
  }
});
const SERPENT_HEAD_FLANK_UNIT = buildUnitPath((p) => {
  for (const [fwd, across, size] of SERPENT_HEAD_PLATES) {
    if (across !== 0) serpentScaleInto(p, fwd, across, 1, 1, 0, size * 0.72);
  }
});
const SERPENT_HEAD_MARKS_UNIT = buildUnitPath((p) => {
  for (const side of [1, -1] as const) {
    for (const [a, c1, b, c2] of SERPENT_MARKS) sweepInto(p, 0, 0, 1, 1, 0, side, a, c1, b, c2);
  }
});
/** Eye tilt is a fixed offset off the heading, so this is local-space too. */
const SERPENT_EYE_RIMS_UNIT = buildUnitPath((p) => {
  for (const side of [1, -1] as const) {
    almondEyeInto(p, 0.34, 0.56 * side, 1, 0.5 * side, 0.46, 0.3);
  }
});
const SERPENT_EYE_BALLS_UNIT = buildUnitPath((p) => {
  for (const side of [1, -1] as const) {
    almondEyeInto(p, 0.34, 0.56 * side, 1, 0.5 * side, 0.37, 0.22);
  }
});
const SERPENT_EYE_SLITS_UNIT = buildUnitPath((p) => {
  for (const side of [1, -1] as const) {
    almondEyeInto(p, 0.34, 0.56 * side, 1, Math.PI / 2, 0.2, 0.05);
  }
});

/** Reproduce a cached local-space shape at an actual (x, y, r, angle). */
function drawLocalShape(
  canvas: SkCanvas,
  path: SkPath,
  paint: SkPaint,
  x: number,
  y: number,
  r: number,
  angle: number
): void {
  canvas.save();
  canvas.translate(x, y);
  canvas.rotate((angle * 180) / Math.PI, 0, 0);
  canvas.scale(r, r);
  canvas.drawPath(path, paint);
  canvas.restore();
}

type Crown = NonNullable<Skin['crown']>;

/**
 * Head ornaments that belong in front of the face. Everything else is drawn
 * before the head, so it reads as poking out from behind it.
 */
const FRONT_CROWNS = new Set<Crown['shape']>(['beak', 'snout', 'visor', 'hat', 'tiara']);

/**
 * Draw a skin's head ornament around a head at (hx, hy) of radius `r` facing
 * `angle`.
 *
 * Everything is circles and one-off paths measured in head radii, so an
 * ornament stays in proportion as a snake grows and nothing needs a texture.
 * The sizes are deliberately generous: a snake starts at ~9px of radius on
 * screen, and anything subtler than this is invisible in play.
 */
function drawCrown(
  canvas: SkCanvas,
  crown: Crown,
  hx: number,
  hy: number,
  r: number,
  angle: number,
  paint: SkPaint,
  accent: SkPaint
) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const cp = Math.cos(angle + Math.PI / 2);
  const sp = Math.sin(angle + Math.PI / 2);
  // A point `fwd` head-radii along the heading and `out` across it.
  const px = (fwd: number, out: number) => hx + ca * r * fwd + cp * r * out;
  const py = (fwd: number, out: number) => hy + sa * r * fwd + sp * r * out;

  switch (crown.shape) {
    case 'horns': {
      // Two cones sweeping out and back. They are drawn before the head, so
      // only the part clear of it shows — hence the wide sweep.
      for (const side of [1, -1]) {
        for (let k = 0; k < 3; k++) {
          const t = k / 2;
          const back = -(0.15 + t * 0.5);
          const out = (1.0 + t * 0.85) * side;
          canvas.drawCircle(px(back, out), py(back, out), r * (0.42 - k * 0.11), paint);
        }
      }
      break;
    }
    case 'plume': {
      // Three spikes fanned over the back of the skull — hair, or a helmet
      // crest. `accent` tips them, which is the half that clears the head.
      for (let i = 0; i < 3; i++) {
        const a = angle + Math.PI + (i - 1) * 0.7;
        for (let k = 0; k < 2; k++) {
          const d = r * (1.0 + k * 0.5);
          canvas.drawCircle(
            hx + Math.cos(a) * d,
            hy + Math.sin(a) * d,
            r * (0.4 - k * 0.14),
            k === 1 && crown.accent ? accent : paint
          );
        }
      }
      break;
    }
    case 'topknot': {
      canvas.drawCircle(px(-1.15, 0), py(-1.15, 0), r * 0.46, paint);
      canvas.drawCircle(px(-1.75, 0), py(-1.75, 0), r * 0.26, paint);
      // The tie. On a dark head over a dark body it is the only part that reads.
      if (crown.accent) canvas.drawCircle(px(-1.15, 0), py(-1.15, 0), r * 0.24, accent);
      break;
    }
    case 'frill': {
      // A fan of little heads around the back of the skull — snake hair.
      for (let i = 0; i < 5; i++) {
        const a = angle + Math.PI + (i - 2) * 0.55;
        canvas.drawCircle(hx + Math.cos(a) * r * 1.15, hy + Math.sin(a) * r * 1.15, r * 0.34, paint);
        if (crown.accent) {
          canvas.drawCircle(hx + Math.cos(a) * r * 1.6, hy + Math.sin(a) * r * 1.6, r * 0.2, accent);
        }
      }
      break;
    }
    case 'hat': {
      // Worn, not peeking out: the cone lies back over the head and the brim
      // crosses it, both on top, which is why 'hat' is a front ornament.
      for (let k = 0; k < 3; k++) {
        const back = -(0.75 + k * 0.6);
        canvas.drawCircle(px(back, 0), py(back, 0), r * (0.5 - k * 0.13), paint);
      }
      if (crown.accent) {
        canvas.drawCircle(px(-2.25, 0), py(-2.25, 0), r * 0.3, accent); // bobble
        for (const out of [-0.62, -0.21, 0.21, 0.62]) {
          canvas.drawCircle(px(-0.05, out), py(-0.05, out), r * 0.26, accent); // brim
        }
      }
      break;
    }
    case 'beak': {
      const beak = Skia.Path.Make();
      beak.moveTo(px(1.7, 0), py(1.7, 0));
      beak.lineTo(px(0.35, 0.42), py(0.35, 0.42));
      beak.lineTo(px(0.35, -0.42), py(0.35, -0.42));
      beak.close();
      canvas.drawPath(beak, paint);
      if (crown.accent) canvas.drawCircle(px(0.55, 0), py(0.55, 0), r * 0.13, accent);
      break;
    }
    case 'snout': {
      canvas.drawCircle(px(0.75, 0), py(0.75, 0), r * 0.55, paint);
      canvas.drawCircle(px(1.25, 0), py(1.25, 0), r * 0.38, paint);
      if (crown.accent) {
        for (const out of [0.16, -0.16]) {
          canvas.drawCircle(px(1.35, out), py(1.35, out), r * 0.09, accent);
        }
      }
      break;
    }
    case 'tiara': {
      // A band of pearls arched across the brow, rising to a cut stone in the
      // middle. `color` is the metal, `accent` the pearls.
      const band = Skia.Path.Make();
      for (let i = 0; i <= 8; i++) {
        const a = -0.62 + i * 0.155;
        // The arch: the middle pearls sit further back up the skull.
        const back = -0.62 - Math.cos(a * 2.2) * 0.34;
        const px2 = px(back, a);
        const py2 = py(back, a);
        band.addCircle(px2, py2, r * 0.13);
        if (crown.accent && i % 2 === 0) {
          canvas.drawCircle(px2, py2, r * 0.1, accent);
        }
      }
      canvas.drawPath(band, paint);
      // The stone: a cut rhombus at the peak of the arch.
      const gem = Skia.Path.Make();
      const gx = px(-0.98, 0);
      const gy = py(-0.98, 0);
      gem.moveTo(px(-0.72, 0), py(-0.72, 0));
      gem.lineTo(px(-0.98, 0.2), py(-0.98, 0.2));
      gem.lineTo(px(-1.28, 0), py(-1.28, 0));
      gem.lineTo(px(-0.98, -0.2), py(-0.98, -0.2));
      gem.close();
      canvas.drawPath(gem, paint);
      if (crown.accent) canvas.drawCircle(gx, gy, r * 0.07, accent);
      break;
    }
    case 'visor': {
      // A helm band across the face, with the lens sitting in it.
      for (const out of [-0.55, -0.19, 0.19, 0.55]) {
        canvas.drawCircle(px(0.15, out), py(0.15, out), r * 0.32, paint);
      }
      if (crown.accent) {
        const lens = Skia.Path.Make();
        lens.moveTo(px(0.62, 0.6), py(0.62, 0.6));
        lens.lineTo(px(0.62, -0.6), py(0.62, -0.6));
        lens.lineTo(px(0.18, -0.6), py(0.18, -0.6));
        lens.lineTo(px(0.18, 0.6), py(0.18, 0.6));
        lens.close();
        canvas.drawPath(lens, accent);
      }
      break;
    }
  }
}

/** The paints `drawSnakeHead` re-colours. Allocated once by the caller. */
export type HeadPaints = {
  outline: SkPaint;
  head: SkPaint;
  eye: SkPaint;
  pupil: SkPaint;
  slit: SkPaint;
  crown: SkPaint;
  crownAccent: SkPaint;
};

/** Build the paints `drawSnakeHead` needs, pre-set to their fixed colours. */
export function makeHeadPaints(): HeadPaints {
  const fill = () => {
    const p = Skia.Paint();
    p.setStyle(PaintStyle.Fill);
    p.setAntiAlias(true);
    return p;
  };
  const outline = fill();
  outline.setColor(Skia.Color('rgba(0,45,65,0.22)'));
  const eye = fill();
  eye.setColor(Skia.Color('#FFFFFF'));
  const pupil = fill();
  pupil.setColor(Skia.Color('#20272E'));
  const slit = Skia.Paint();
  slit.setStyle(PaintStyle.Stroke);
  slit.setStrokeCap(StrokeCap.Round);
  slit.setAntiAlias(true);
  slit.setColor(Skia.Color('#20272E'));
  return { outline, head: fill(), eye, pupil, slit, crown: fill(), crownAccent: fill() };
}

export type HeadOpts = {
  x: number;
  y: number;
  /** Head radius — the same radius as a body bead. */
  r: number;
  /** Heading, radians. */
  angle: number;
  /** The head's own colour, i.e. the colour of the first bead. */
  color: string;
  skin?: Skin;
  /**
   * A painted head to blit instead of drawing one. Resolved by the caller from
   * the skin's `headArt`, so this stays ignorant of how art is loaded.
   */
  art?: { image: SkImage; length: number; anchor: number };
};

/**
 * Draw one snake head — ornament, ears, skull, muzzle and eyes — at (x, y).
 *
 * Ordering is the whole trick here: anything that should read as poking out
 * from behind the head goes down before the skull, everything worn on the face
 * after it.
 */
export function drawSnakeHead(
  canvas: SkCanvas,
  { x, y, r, angle, color, skin, art }: HeadOpts,
  paints: HeadPaints
): void {
  // A painted head replaces everything below it — skull, features, ornament.
  // Art detailed enough to be worth shipping as a texture is art that already
  // draws its own eyes, and a crown laid over it would only fight the picture.
  if (art) {
    const w = art.image.width();
    const h = art.image.height();
    const len = r * art.length;
    const hgt = (len * h) / w;
    canvas.save();
    canvas.translate(x, y);
    canvas.rotate((angle * 180) / Math.PI, 0, 0);
    // Linear + mipmaps because this is nearly always a downscale: a snake is
    // 30px across in the arena and the sprite is an order of magnitude wider,
    // which point sampling turns into a shimmering mess as the snake turns.
    canvas.drawImageRectOptions(
      art.image,
      Skia.XYWHRect(0, 0, w, h),
      Skia.XYWHRect(-len * art.anchor, -hgt / 2, len, hgt),
      FilterMode.Linear,
      MipmapMode.Linear
    );
    canvas.restore();
    return;
  }

  const crown = skin?.crown;
  if (crown) {
    paints.crown.setColor(Skia.Color(crown.color));
    if (crown.accent) paints.crownAccent.setColor(Skia.Color(crown.accent));
    if (!FRONT_CROWNS.has(crown.shape)) {
      drawCrown(canvas, crown, x, y, r, angle, paints.crown, paints.crownAccent);
    }
  }

  // A burning skin wears fire instead of a skull: tongues fanned off the back
  // of the head, laid down before the face so they read as rising from it.
  // Everything the body does, the head does too, or the snake ends in a bead.
  if (skin?.flames) {
    const fan: Array<[number, number, 1 | -1]> = [
      [-0.62, 1.05, -1],
      [0, 1.45, 1],
      [0.62, 1.05, 1],
    ];
    paints.head.setColor(Skia.Color(skin.flames.tint ?? color));
    for (const [lean, reach, side] of fan) {
      const a = angle + Math.PI + lean;
      canvas.drawPath(flamePath(x, y, r, Math.cos(a), Math.sin(a), side, reach), paints.head);
    }
    if (skin.flames.core) {
      paints.head.setColor(Skia.Color(skin.flames.core));
      for (const [lean, reach, side] of fan) {
        const a = angle + Math.PI + lean;
        canvas.drawPath(
          flamePath(
            x + Math.cos(a) * r * 0.3,
            y + Math.sin(a) * r * 0.3,
            r,
            Math.cos(a),
            Math.sin(a),
            side,
            reach * 0.5
          ),
          paints.head
        );
      }
    }
  }

  // Ears sit behind the head so they read as poking out from it.
  const ears = skin?.ears;
  if (ears) {
    const perp = angle + Math.PI / 2;
    // Ears are sized generously relative to the head: a snake starts at
    // ~9px radius, and anything subtler than this simply isn't visible.
    const earR = r * (ears.shape === 'long' ? 0.62 : 0.78);
    const outAmt = r * (ears.shape === 'long' ? 0.5 : 0.85);
    const backAmt = r * (ears.shape === 'long' ? 0.1 : 0.3);
    // Rabbit ears are long ovals, drawn as a stack of two circles.
    const long = ears.shape === 'long';
    paints.head.setColor(Skia.Color(ears.color));
    for (const side of [1, -1]) {
      const bx = x + Math.cos(perp) * outAmt * side - Math.cos(angle) * backAmt;
      const by = y + Math.sin(perp) * outAmt * side - Math.sin(angle) * backAmt;
      if (long) {
        for (let k = 0; k < 3; k++) {
          const t = k * earR * 0.72;
          canvas.drawCircle(
            bx - Math.cos(angle) * t,
            by - Math.sin(angle) * t,
            earR * (1 - k * 0.12),
            paints.head
          );
        }
      } else {
        canvas.drawCircle(bx, by, earR, paints.head);
      }
      if (ears.inner) {
        paints.eye.setColor(Skia.Color(ears.inner));
        canvas.drawCircle(bx, by, earR * 0.5, paints.eye);
        paints.eye.setColor(Skia.Color('#FFFFFF'));
      }
    }
  }

  if (skin?.flames) {
    // The head is fire too, and it comes to a point: no disc, no flat nose —
    // a circle here is the one shape that gives away that this is a snake
    // wearing a flame texture.
    const head = Skia.Path.Make();
    pointedHeadInto(head, x, y, r, Math.cos(angle), Math.sin(angle), 1.12);
    paints.head.setColor(Skia.Color(skin.flames.tint ?? color));
    canvas.drawPath(head, paints.head);
    if (skin.flames.core) {
      const core = Skia.Path.Make();
      pointedHeadInto(
        core,
        x - Math.cos(angle) * r * 0.1,
        y - Math.sin(angle) * r * 0.1,
        r,
        Math.cos(angle),
        Math.sin(angle),
        0.74
      );
      paints.head.setColor(Skia.Color(skin.flames.core));
      canvas.drawPath(core, paints.head);
    }
  } else if (skin?.serpent) {
    // The ornamental mask: a broad shield skull, a ridge of plates down the
    // snout, mirrored gold linework, and big slit eyes. Drawn in full here,
    // so the generic eyes at the bottom are skipped.
    //
    // Every one of these shapes is fixed geometry — cached once in local
    // space above, reproduced here with a transform instead of a fresh set
    // of quadTos. See `drawLocalShape`'s comment for why.
    const sp = skin.serpent;

    // The dark edge first, as a slightly larger copy of the skull behind it.
    // A drawn outline would need a stroke paint and a width that holds at
    // every size; a shape behind the shape costs one more path and cannot
    // pick up the hairline seams a stroke does where the curves meet.
    paints.head.setColor(Skia.Color(sp.outline));
    drawLocalShape(canvas, SERPENT_HEAD_EDGE_UNIT, paints.head, x, y, r, angle);

    paints.head.setColor(Skia.Color(color));
    drawLocalShape(canvas, SERPENT_HEAD_SKULL_UNIT, paints.head, x, y, r, angle);

    // Ridge: plates down the midline, shrinking toward the nose so the skull
    // reads as tapering rather than as a slab with discs on it.
    //
    // Every plate is laid on a slightly larger one in the dark edge colour, so
    // an ink line separates it from its neighbours — plates in one flat colour
    // merge into a slab. And they are lit across the skull, not down it: a
    // bright spine falling away to darker flanks, which is what gives a flat
    // cutout a back that turns.
    //
    // Three columns rather than one. A single row of discs down the midline is
    // a caterpillar; it is the scales *beside* the spine that make a skull.
    paints.head.setColor(Skia.Color(sp.outline));
    drawLocalShape(canvas, SERPENT_HEAD_BED_UNIT, paints.head, x, y, r, angle);
    paints.head.setColor(Skia.Color(sp.ridge));
    drawLocalShape(canvas, SERPENT_HEAD_SPINE_UNIT, paints.head, x, y, r, angle);
    paints.head.setColor(Skia.Color(shade(sp.ridge, 0.24)));
    drawLocalShape(canvas, SERPENT_HEAD_FLANK_UNIT, paints.head, x, y, r, angle);

    // Gold linework, both sides from one description.
    paints.head.setColor(Skia.Color(sp.marks));
    drawLocalShape(canvas, SERPENT_HEAD_MARKS_UNIT, paints.head, x, y, r, angle);

    if (crown && FRONT_CROWNS.has(crown.shape)) {
      drawCrown(canvas, crown, x, y, r, angle, paints.crown, paints.crownAccent);
    }

    // Eyes: a big tilted almond in the skin's eye colour, rimmed in the same
    // dark the head is edged with, cut by a vertical slit. Vertical meaning
    // across the heading — a snake's slit stands square to the way it looks.
    paints.head.setColor(Skia.Color(sp.outline));
    drawLocalShape(canvas, SERPENT_EYE_RIMS_UNIT, paints.head, x, y, r, angle);
    paints.head.setColor(Skia.Color(skin.eyeColor ?? '#F5C518'));
    drawLocalShape(canvas, SERPENT_EYE_BALLS_UNIT, paints.head, x, y, r, angle);
    paints.head.setColor(Skia.Color('#141A16'));
    drawLocalShape(canvas, SERPENT_EYE_SLITS_UNIT, paints.head, x, y, r, angle);

    // No mouth line and no nostrils. Both are front-view features: from
    // directly above, a mouth crescent across the snout and a pair of dark
    // specks in front of the eyes just assemble into a second, cartoon face
    // where there should be plating. A viper seen from above is scales and
    // eyes, and nothing else.
    return;
  } else if (skin?.scales?.style === 'dragon') {
    // Armoured head: the same point as the flames get, with a short row of
    // scutes laid over it so the plating carries all the way to the nose.
    // Cached local-space shapes again — see `drawLocalShape`.
    paints.head.setColor(Skia.Color(color));
    drawLocalShape(canvas, DRAGON_HEAD_SKULL_UNIT, paints.head, x, y, r, angle);

    paints.head.setColor(Skia.Color(scaleHighlight(skin, color)));
    drawLocalShape(canvas, DRAGON_HEAD_PLATES_UNIT, paints.head, x, y, r, angle);
  } else if (skin?.smooth) {
    // A polished body deserves a proper head: blunt nose, cheeks, jaw, and the
    // face a real snake wears — dark almond eyes lit by a thin slit, nostrils
    // at the tip. Drawn here in full, so the generic eyes below are skipped.
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    // The head on a real snake is wider than the neck behind it. Every
    // measurement below is in head radii rather than body radii, so the face
    // grows with the skull instead of rattling around inside it.
    const hr = r * SMOOTH_HEAD_SCALE;
    const head = Skia.Path.Make();
    snoutInto(head, x, y, hr, dx, dy, 1.0);
    paints.head.setColor(Skia.Color(color));
    canvas.drawPath(head, paints.head);

    // Brow: a shade darker than the skull, over the back half of it.
    const brow = Skia.Path.Make();
    snoutInto(brow, x - dx * hr * 0.34, y - dy * hr * 0.34, hr, dx, dy, 0.66);
    paints.head.setColor(Skia.Color(shade(color, 0.22)));
    canvas.drawPath(brow, paints.head);

    // This branch draws the whole face and returns, so anything worn on the
    // front of the head has to be drawn here — the front-crown pass below is
    // never reached.
    if (crown && FRONT_CROWNS.has(crown.shape)) {
      drawCrown(canvas, crown, x, y, hr, angle, paints.crown, paints.crownAccent);
    }

    const gem = skin.eyes === 'gem';
    const rims = Skia.Path.Make();
    const eyes = Skia.Path.Make();
    const slits = Skia.Path.Make();
    const lashes = Skia.Path.Make();
    const pupils = Skia.Path.Make();
    const glints = Skia.Path.Make();
    for (const side of [1, -1]) {
      // Set back from the nose and tilted out, the way they sit on a skull
      // rather than on the front of a face.
      const ex = x + dx * hr * 0.12 + Math.cos(perp) * hr * 0.46 * side;
      const ey = y + dy * hr * 0.12 + Math.sin(perp) * hr * 0.46 * side;
      const tilt = angle + 0.32 * side;
      if (gem) {
        // Bigger, rimmed in metal, with a cut stone for a pupil.
        almondEyeInto(rims, ex, ey, hr, tilt, 0.62, 0.34);
        almondEyeInto(eyes, ex, ey, hr, tilt, 0.55, 0.28);
        // The stone: a rhombus standing along the head's axis.
        const px2 = Math.cos(perp);
        const py2 = Math.sin(perp);
        pupils.moveTo(ex + dx * hr * 0.2, ey + dy * hr * 0.2);
        pupils.lineTo(ex + px2 * hr * 0.08, ey + py2 * hr * 0.08);
        pupils.lineTo(ex - dx * hr * 0.22, ey - dy * hr * 0.22);
        pupils.lineTo(ex - px2 * hr * 0.08, ey - py2 * hr * 0.08);
        pupils.close();
        glints.addCircle(ex + dx * hr * 0.26 + px2 * hr * 0.06, ey + dy * hr * 0.26 + py2 * hr * 0.06, hr * 0.05);
        // Lashes off the outer corner, swept back.
        for (let i = 0; i < 3; i++) {
          const a = tilt + Math.PI + (i - 1) * 0.26 + 0.5 * side;
          const bx = ex + Math.cos(perp) * hr * 0.3 * side;
          const by = ey + Math.sin(perp) * hr * 0.3 * side;
          lashes.moveTo(bx, by);
          lashes.lineTo(bx + Math.cos(a) * hr * 0.34, by + Math.sin(a) * hr * 0.34);
        }
      } else {
        almondEyeInto(eyes, ex, ey, hr, tilt, 0.46, 0.24);
        almondEyeInto(slits, ex, ey, hr, tilt, 0.3, 0.035);
      }
    }
    if (gem) {
      const metal = skin.crown?.color ?? '#D9A188';
      paints.head.setColor(Skia.Color(metal));
      canvas.drawPath(rims, paints.head);
      paints.head.setColor(Skia.Color('#242A4C'));
      canvas.drawPath(eyes, paints.head);
      paints.head.setColor(Skia.Color(skin.bloom?.color ?? '#F0BFC8'));
      canvas.drawPath(pupils, paints.head);
      paints.head.setColor(Skia.Color('#FFFFFF'));
      canvas.drawPath(glints, paints.head);
      paints.slit.setColor(Skia.Color(shade(color, 0.45)));
      paints.slit.setStrokeWidth(Math.max(1, hr * 0.06));
      canvas.drawPath(lashes, paints.slit);
      paints.slit.setColor(Skia.Color('#20272E'));
    } else {
      paints.head.setColor(Skia.Color('#0B0B0D'));
      canvas.drawPath(eyes, paints.head);
      paints.head.setColor(Skia.Color('#C6C6D0'));
      canvas.drawPath(slits, paints.head);
    }

    // A flower on the cheek, five petals round a centre.
    if (skin.bloom) {
      const bx = x - dx * hr * 0.85 + Math.cos(perp) * hr * 0.78;
      const by = y - dy * hr * 0.85 + Math.sin(perp) * hr * 0.78;
      const petals = Skia.Path.Make();
      for (let i = 0; i < 5; i++) {
        const a = angle + (i / 5) * Math.PI * 2;
        petals.addCircle(bx + Math.cos(a) * hr * 0.17, by + Math.sin(a) * hr * 0.17, hr * 0.13);
      }
      paints.head.setColor(Skia.Color(skin.bloom.color));
      canvas.drawPath(petals, paints.head);
      if (skin.bloom.center) {
        paints.head.setColor(Skia.Color(skin.bloom.center));
        canvas.drawCircle(bx, by, hr * 0.09, paints.head);
      }
    }

    // Nostrils. A dark speck at arena size, the last detail at preview size.
    const nose = Math.max(0.6, hr * 0.08);
    paints.head.setColor(Skia.Color(shade(color, 0.65)));
    for (const side of [1, -1]) {
      canvas.drawCircle(
        x + dx * hr * 1.16 + Math.cos(perp) * hr * 0.2 * side,
        y + dy * hr * 1.16 + Math.sin(perp) * hr * 0.2 * side,
        nose,
        paints.head
      );
    }
    return;
  } else {
    canvas.drawCircle(x, y, r + 2, paints.outline);
    paints.head.setColor(Skia.Color(color));
    canvas.drawCircle(x, y, r, paints.head);
  }

  // A pale muzzle on the animal skins. Not on the sculpted heads: a disc on a
  // pointed snout is exactly the ball those skins are built to avoid.
  if (skin?.belly && !skin.flames && !skin.smooth && skin.scales?.style !== 'dragon') {
    paints.head.setColor(Skia.Color(skin.belly));
    canvas.drawCircle(
      x + Math.cos(angle) * r * 0.24,
      y + Math.sin(angle) * r * 0.24,
      r * 0.6,
      paints.head
    );
  }

  if (crown && FRONT_CROWNS.has(crown.shape)) {
    drawCrown(canvas, crown, x, y, r, angle, paints.crown, paints.crownAccent);
  }


  // A visor is the face; drawing eyes behind it would only poke out.
  if (crown?.shape === 'visor') return;

  const big = skin?.eyes === 'big';
  const perp = angle + Math.PI / 2;
  const eyeOut = r * (big ? 0.42 : 0.46);
  const eyeFwd = r * 0.4;
  const eyeR = Math.max(2, r * (big ? 0.44 : 0.34));
  const pupilR = Math.max(1, eyeR * 0.5);
  const slit = skin?.eyes === 'slit';
  if (slit) paints.slit.setStrokeWidth(pupilR * 1.1);
  // Restored below: the paint is shared with every other skin on screen.
  if (skin?.eyeColor) paints.eye.setColor(Skia.Color(skin.eyeColor));
  for (const side of [1, -1]) {
    const ex = x + Math.cos(perp) * eyeOut * side + Math.cos(angle) * eyeFwd;
    const ey = y + Math.sin(perp) * eyeOut * side + Math.sin(angle) * eyeFwd;
    canvas.drawCircle(ex, ey, eyeR, paints.eye);
    const cx = ex + Math.cos(angle) * eyeR * 0.36;
    const cy = ey + Math.sin(angle) * eyeR * 0.36;
    if (slit) {
      // Drawn along the heading, so it reads as a reptile's eye rather
      // than a dot however the snake is turned.
      canvas.drawLine(
        cx - Math.cos(angle) * eyeR * 0.5,
        cy - Math.sin(angle) * eyeR * 0.5,
        cx + Math.cos(angle) * eyeR * 0.5,
        cy + Math.sin(angle) * eyeR * 0.5,
        paints.slit
      );
    } else {
      canvas.drawCircle(cx, cy, pupilR, paints.pupil);
    }
  }
  if (skin?.eyeColor) paints.eye.setColor(Skia.Color('#FFFFFF'));
}
