import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Canvas,
  Picture,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  createPicture,
  type SkImage,
  type SkPaint,
  type SkPath,
  type SkPicture,
} from '@shopify/react-native-skia';

import type { GameSimulation } from './prediction';
import { beadColors, lighten, scaleHighlight, shade } from './skins';
import {
  BEAD_PITCH,
  DRAGON_COLS,
  DRAGON_ROW_PITCH,
  DRAGON_ROW_UNITS,
  FLAME_PITCH,
  SMOOTH_SCALE_COLS,
  SMOOTH_SCALE_PITCH,
  SMOOTH_SCALE_SHADE,
  SCALE_OFFSET,
  SCALE_PITCH,
  SCALE_RADIUS,
  SERPENT_BED_ROW_UNITS,
  SERPENT_COLS,
  SERPENT_LIFT,
  SERPENT_PLATE_UNITS,
  SERPENT_ROW_PITCH,
  fineScaleInto,
  drawSnakeHead,
  flameInto,
  type HeadPaints,
} from './snakeArt';
import { frameTime } from './clock';
import { useHeadArt } from './headArt';
import { theme } from '../lib/theme';

/**
 * World units across the screen's LONG edge. Keying off the long edge rather
 * than the width keeps a snake the same on-screen size whichever way the phone
 * is held, so the game reads identically in landscape and portrait.
 */
const VIEW_LONG = 760;
/**
 * Hard ceiling on beads walked per snake, as a last line of defence.
 *
 * Bead *count* is already bounded in practice: off-screen beads are culled
 * below, and the pitch above grows with the radius, so a longer snake is also
 * a fatter one. This only stops a pathological body from stalling a frame.
 */
const MAX_BEADS = 800;
/**
 * Opacity a snake is drawn at while its spawn protection is running: a pulse
 * between MID-SWING and MID+SWING. Low enough to read instantly as "not solid
 * yet", high enough that you can still see which way it's pointed.
 */
const FADE_MID = 0.5;
const FADE_SWING = 0.2;
const LABEL_HZ = 8;
const HEX_SIZE = 26;

type Props = {
  sim: GameSimulation;
  width: number;
  height: number;
  showFps?: boolean;
};

type Label = {
  id: number;
  name: string;
  /** Undefined only if the snake somehow has no skin resolved at all. */
  skin: string | undefined;
  x: number;
  y: number;
  isLocal: boolean;
};

/**
 * Bake the hex lattice — plus the arena colour behind it — into one opaque
 * bitmap, once.
 *
 * Stroking ~1500 line segments every frame is a lot of CPU geometry work and a
 * full screen of blending, which a budget GPU will not keep up with. Baking it
 * turns the background into a single opaque blit: no blend, no path work.
 */
function bakeBackground(w: number, h: number, padX: number, padY: number): SkImage | null {
  const surface = Skia.Surface.MakeOffscreen(Math.ceil(w + padX * 2), Math.ceil(h + padY * 2));
  if (!surface) return null;
  const canvas = surface.getCanvas();

  canvas.drawColor(Skia.Color(theme.arena));

  const path = Skia.Path.Make();
  const dx = HEX_SIZE * 1.5;
  const dy = HEX_SIZE * Math.sqrt(3);
  const cols = Math.ceil((w + padX * 2) / dx) + 2;
  const rows = Math.ceil((h + padY * 2) / dy) + 2;

  for (let c = -1; c < cols; c++) {
    for (let r = -1; r < rows; r++) {
      const cx = c * dx;
      const cy = r * dy + (c % 2 === 0 ? 0 : dy / 2);
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const x = cx + Math.cos(a) * HEX_SIZE;
        const y = cy + Math.sin(a) * HEX_SIZE;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.close();
    }
  }

  const paint = Skia.Paint();
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(1.4);
  paint.setColor(Skia.Color(theme.hexLine));
  paint.setAntiAlias(true);
  canvas.drawPath(path, paint);

  surface.flush();
  return surface.makeImageSnapshot();
}

/**
 * The arena.
 *
 * The whole frame is drawn imperatively into a single SkPicture, so React sees
 * exactly one element change per frame instead of a tree of a hundred-odd
 * shapes. Paints are allocated once and re-coloured, and every snake is two
 * stroke passes rather than four.
 */
export function GameCanvas({ sim, width, height, showFps }: Props) {
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [fps, setFps] = useState(0);

  const headArt = useHeadArt();

  const lastLabelAt = useRef(0);
  const frames = useRef(0);
  const fpsAt = useRef(0);

  const scale = Math.max(width, height) / VIEW_LONG;
  const periodX = HEX_SIZE * 1.5 * 2;
  const periodY = HEX_SIZE * Math.sqrt(3);

  const background = useMemo(
    () => bakeBackground(width, height, periodX, periodY),
    [width, height, periodX, periodY]
  );

  // Reused across every draw — allocating paints per shape per frame is pure waste.
  const paints = useMemo(() => {
    const stroke = () => {
      const p = Skia.Paint();
      p.setStyle(PaintStyle.Stroke);
      p.setStrokeCap(StrokeCap.Round);
      p.setStrokeJoin(StrokeJoin.Round);
      p.setAntiAlias(true);
      return p;
    };
    const fill = () => {
      const p = Skia.Paint();
      p.setStyle(PaintStyle.Fill);
      p.setAntiAlias(true);
      return p;
    };
    return {
      // Bodies are beads (filled circles), not strokes. Using a stroke paint
      // here draws each bead as a hollow ring, which reads as a see-through
      // snake — the arena shows straight through it.
      outline: fill(),
      body: fill(),
      scale: fill(),
      glow: fill(),
      // These two really are outlines.
      rim: stroke(),
      food: fill(),
      // A smooth body is a stroke down the path, not a row of discs.
      tube: stroke(),
      head: fill(),
      eye: fill(),
      pupil: fill(),
      crown: fill(),
      crownAccent: fill(),
      // A slit pupil is a short round-capped line, not a circle.
      slit: stroke(),
      // Carries nothing but an alpha: it is the paint a spawn-protected
      // snake's layer is composited with. See the draw loop.
      fade: fill(),
    };
  }, []) satisfies HeadPaints & Record<string, SkPaint>;

  // One mutable matrix, reused for every dragon/serpent scale on every snake
  // on every frame — see the scale-drawing block below for why this replaces
  // calling into the scale shape builders fresh per bead.
  const scaleMatrix = useMemo(() => Skia.Matrix(), []);

  useEffect(() => {
    paints.outline.setColor(Skia.Color('rgba(0,45,65,0.22)'));
    paints.glow.setColor(Skia.Color('rgba(255,255,255,0.28)'));
    paints.eye.setColor(Skia.Color('#FFFFFF'));
    paints.pupil.setColor(Skia.Color('#20272E'));
    paints.slit.setColor(Skia.Color('#20272E'));
    paints.fade.setColor(Skia.Color('#FFFFFF'));
  }, [paints]);

  useEffect(() => {
    let raf = 0;
    const bounds = { x: 0, y: 0, width, height };

    const frame = (timestamp: number) => {
      const now = frameTime(timestamp);
      const cam = sim.cameraTarget(now);
      const sx = (x: number) => (x - cam.x) * scale + width / 2;
      const sy = (y: number) => (y - cam.y) * scale + height / 2;
      const rendered = sim.getRenderSnakes(now);
      const distFromCenter = Math.hypot(cam.x, cam.y);
      const rimR = sim.meta.worldRadius * scale;

      const pic = createPicture((canvas) => {
        // ---- background: one opaque blit ------------------------------
        if (background) {
          // Rounded to whole pixels on purpose. `drawImage` samples nearest by
          // default, so at a fractional offset the lattice's 1.4px lines snap
          // to the pixel grid unevenly across the image and crawl as the
          // camera moves — a shimmer over the whole arena. The grid is a
          // repeating texture with nothing to line up against, so a pixel of
          // quantisation costs nothing and buys a background that sits still.
          const ox = Math.round(-periodX + -((cam.x * scale) % periodX));
          const oy = Math.round(-periodY + -((cam.y * scale) % periodY));
          canvas.drawImage(background, ox, oy);
        } else {
          canvas.drawColor(Skia.Color(theme.arena));
        }

        // ---- rim: only when it could actually be on screen -------------
        const nearRim = distFromCenter > sim.meta.worldRadius - VIEW_LONG;
        if (nearRim) {
          const danger = distFromCenter > sim.meta.worldRadius - sim.meta.borderWarn;
          paints.rim.setColor(Skia.Color(danger ? theme.rim : theme.arenaEdge));
          paints.rim.setStrokeWidth(danger ? 12 : 6);
          paints.rim.setAlphaf(danger ? 0.95 : 0.5);
          canvas.drawCircle(sx(0), sy(0), rimR, paints.rim);
        }

        // ---- food: one path per colour ---------------------------------
        // Pellets are multicoloured now, so they're batched by palette index
        // rather than drawn individually — a handful of draws instead of ~70.
        const byColor = new Map<number, SkPath>();
        for (const f of sim.getFood()) {
          const px = sx(f.x);
          const py = sy(f.y);
          if (px < -20 || px > width + 20 || py < -20 || py > height + 20) continue;
          let path = byColor.get(f.ci);
          if (!path) {
            path = Skia.Path.Make();
            byColor.set(f.ci, path);
          }
          path.addCircle(px, py, Math.max(2, f.radius * scale));
        }
        for (const [ci, path] of byColor) {
          paints.food.setColor(Skia.Color(sim.colorAt(ci)));
          canvas.drawPath(path, paints.food);
        }

        // ---- snakes ------------------------------------------------------
        // Bodies are beads rather than one stroke, because skins are patterned
        // and a stroke can only be one colour. Beads are batched into one path
        // per colour, so a body still costs a handful of draws, not one per
        // segment.
        for (const s of rendered) {
          const pts = s.points;
          if (pts.length < 2) continue;

          // Stride in path points, from the snake's own radius. `scale` cancels
          // out — s.radius and segmentSpacing are both in world units — so the
          // body looks the same at every zoom.
          const spacing = sim.meta.segmentSpacing || 9;
          const byRadius = Math.round((BEAD_PITCH * s.radius) / spacing);
          // The count ceiling raises the stride, never lowers it — it is there
          // to cap work, so it can only ever make beads sparser.
          const stride = Math.max(1, byRadius, Math.ceil(pts.length / MAX_BEADS));
          const r = s.radius * scale;

          // Which of the styles below this skin uses. Needed before the beads
          // are collected, because a smooth body cannot be culled.
          const burning = !!s.skin?.flames;
          const dragon = s.skin?.scales?.style === 'dragon';
          const serpent = s.skin?.scales?.style === 'serpent';
          const smooth = !!s.skin?.smooth;
          const sculpted = burning || dragon || serpent || smooth;

          // Collect visible bead positions, tail first so the head draws on top.
          //
          // Beads are culled to the viewport, but a smooth body is one stroke
          // through these points: drop the off-screen ones and a snake that
          // leaves the view and comes back gets a chord drawn straight across
          // the screen. The stride already bounds how many there can be.
          const xs: number[] = [];
          const ys: number[] = [];
          const idx: number[] = [];
          for (let i = pts.length - 1; i >= 0; i -= stride) {
            const px = sx(pts[i].x);
            const py = sy(pts[i].y);
            if (!smooth && (px < -60 || px > width + 60 || py < -60 || py > height + 60)) continue;
            xs.push(px);
            ys.push(py);
            idx.push(i);
          }
          if (xs.length === 0) continue;

          // ---- spawn protection: the whole snake, pulsing, see-through -----
          //
          // One layer rather than an alpha on every paint: a body is dozens of
          // overlapping beads with a head drawn on top of them, and fading each
          // shape on its own would show every seam through the one in front.
          // The layer is bounded to the snake so a fresh spawn does not cost a
          // full-screen offscreen buffer, and the bounds are clamped to the
          // viewport because everything outside it is clipped away regardless.
          const fading = s.invulnerable;
          if (fading) {
            let minX = sx(s.head.x);
            let maxX = minX;
            let minY = sy(s.head.y);
            let maxY = minY;
            for (let k = 0; k < xs.length; k++) {
              if (xs[k] < minX) minX = xs[k];
              else if (xs[k] > maxX) maxX = xs[k];
              if (ys[k] < minY) minY = ys[k];
              else if (ys[k] > maxY) maxY = ys[k];
            }
            // Generous: crowns, horns and head art all sit outside the beads.
            const pad = r * 2.5 + 14;
            const lx = Math.max(0, minX - pad);
            const ly = Math.max(0, minY - pad);
            const lw = Math.min(width, maxX + pad) - lx;
            const lh = Math.min(height, maxY + pad) - ly;
            // Roughly a second per breath, never fully solid and never gone.
            paints.fade.setAlphaf(FADE_MID + FADE_SWING * Math.sin(now / 160));
            canvas.saveLayer(paints.fade, Skia.XYWHRect(lx, ly, Math.max(1, lw), Math.max(1, lh)));
          }

          const colors = beadColors(s.skin, s.color, pts.length);
          // Skins built out of shapes rather than beads — fire, dragon plating,
          // a polished tube — do not want the beads or their outline showing
          // through the artwork at full size.
          // Outline: every bead in one path, one draw.
          if (!sculpted) {
            const outline = Skia.Path.Make();
            for (let k = 0; k < xs.length; k++) outline.addCircle(xs[k], ys[k], r + 2);
            canvas.drawPath(outline, paints.outline);
          }

          if (s.boosting && s.isLocal) {
            const glow = Skia.Path.Make();
            for (let k = 0; k < xs.length; k++) glow.addCircle(xs[k], ys[k], r + 6);
            canvas.drawPath(glow, paints.glow);
          }

          // Body: one path per colour the skin actually uses.
          //
          // A sculpted body still lays these down, but tucked inside the
          // silhouette its shapes draw (never past a tongue's flank or a
          // scale's edge) — they are not read as beads, they are what stops
          // the arena showing through on the outside of a tight turn.
          const rBead = sculpted ? r * 0.78 : r;
          if (smooth) {
            // One stroke per run of like-coloured beads, each overlapping the
            // next by a point so the joins do not show. A stroke can only be
            // one colour, which is why the bead skins batch by colour instead:
            // here the gradient is quantised to a handful of runs, so a whole
            // body is a handful of strokes.
            paints.tube.setStrokeWidth(r * 2);
            let run = Skia.Path.Make();
            let runColor = colors[idx[0]] ?? s.color;
            let started = false;
            const flush = () => {
              if (!started) return;
              paints.tube.setColor(Skia.Color(runColor));
              canvas.drawPath(run, paints.tube);
            };
            for (let k = 0; k < xs.length; k++) {
              const c = colors[idx[k]] ?? s.color;
              if (!started) {
                run.moveTo(xs[k], ys[k]);
                runColor = c;
                started = true;
              } else if (c === runColor) {
                run.lineTo(xs[k], ys[k]);
              } else {
                // Carry the joint into the next run, or a hairline of arena
                // shows where two colours meet.
                run.lineTo(xs[k], ys[k]);
                flush();
                run = Skia.Path.Make();
                run.moveTo(xs[k], ys[k]);
                runColor = c;
              }
            }
            flush();

            // Scale texture: tiny scutes a shade darker than the skin. Only
            // worth drawing once the snake is big enough on screen for them to
            // land on more than one pixel, and only over the stretch actually
            // in view — the stroke above needs every point, this does not.
            if (s.skin?.smooth?.texture && r >= 5) {
              const byTex = new Map<string, SkPath>();
              let lastX = Infinity;
              let lastY = Infinity;
              let texRow = 0;
              const texPitch = r * SMOOTH_SCALE_PITCH;
              for (let k = 0; k < xs.length; k++) {
                if (xs[k] < -40 || xs[k] > width + 40 || ys[k] < -40 || ys[k] > height + 40) {
                  continue;
                }
                if (Math.hypot(xs[k] - lastX, ys[k] - lastY) < texPitch) continue;
                lastX = xs[k];
                lastY = ys[k];
                const i = idx[k];
                const ahead = pts[Math.max(0, i - 1)];
                const here = pts[i];
                let dx = ahead.x - here.x;
                let dy = ahead.y - here.y;
                const len = Math.hypot(dx, dy);
                if (len < 1e-4) {
                  dx = Math.cos(s.angle);
                  dy = Math.sin(s.angle);
                } else {
                  dx /= len;
                  dy /= len;
                }
                const c = shade(colors[i] ?? s.color, SMOOTH_SCALE_SHADE);
                let path = byTex.get(c);
                if (!path) {
                  path = Skia.Path.Make();
                  byTex.set(c, path);
                }
                for (const across of SMOOTH_SCALE_COLS[texRow % SMOOTH_SCALE_COLS.length]) {
                  fineScaleInto(path, xs[k] - dy * r * across, ys[k] + dx * r * across, r, dx, dy);
                }
                texRow++;
              }
              for (const [c, path] of byTex) {
                paints.body.setColor(Skia.Color(c));
                canvas.drawPath(path, paints.body);
              }
            }
          } else {
            const byColor = new Map<string, SkPath>();
            for (let k = 0; k < xs.length; k++) {
              const c = colors[idx[k]] ?? s.color;
              let path = byColor.get(c);
              if (!path) {
                path = Skia.Path.Make();
                byColor.set(c, path);
              }
              path.addCircle(xs[k], ys[k], rBead);
            }
            for (const [c, path] of byColor) {
              paints.body.setColor(Skia.Color(c));
              canvas.drawPath(path, paints.body);
            }
          }

          // Scales: a lighter disc pushed toward the head on each bead, so the
          // base colour survives only as a crescent at the bead's trailing
          // edge. Overlapping beads then read as overlapping scutes. Batched
          // per colour like the body, so a scaled snake costs one extra draw
          // per colour rather than one per segment.
          if (s.skin?.scales) {
            // Two ways to be scaly: one soft crescent per bead, or pointed
            // scales laid in staggered rows like roof tiles.
            const byScale = new Map<string, SkPath>();
            // The serpent body is drawn on an ink bed: every plate sits on a
            // slightly larger one in the skin's dark edge colour, so what
            // divides two scales is a line rather than a change of green.
            // One bed for the whole snake, not one per band — a consistent ink
            // line is both what an illustration does and one path instead of
            // four.
            const bed = serpent ? Skia.Path.Make() : null;
            const byPlate = serpent ? new Map<string, SkPath>() : null;
            let lastX = Infinity;
            let lastY = Infinity;
            let row = 0;
            const pitch =
              r * (dragon ? DRAGON_ROW_PITCH : serpent ? SERPENT_ROW_PITCH : SCALE_PITCH);
            for (let k = 0; k < xs.length; k++) {
              // Skip beads that fall inside the previous scale's footprint.
              if (Math.hypot(xs[k] - lastX, ys[k] - lastY) < pitch) continue;
              lastX = xs[k];
              lastY = ys[k];
              const i = idx[k];
              // Heading at this bead, taken from the next point toward the
              // head. The tail bead has no forward neighbour, so it keeps the
              // one behind it rather than collapsing to a zero vector.
              const ahead = pts[Math.max(0, i - 1)];
              const here = pts[i];
              let dx = ahead.x - here.x;
              let dy = ahead.y - here.y;
              const len = Math.hypot(dx, dy);
              if (len < 1e-4) {
                dx = Math.cos(s.angle);
                dy = Math.sin(s.angle);
              } else {
                dx /= len;
                dy /= len;
              }
              const c = scaleHighlight(s.skin, colors[i] ?? s.color);
              let path = byScale.get(c);
              if (!path) {
                path = Skia.Path.Make();
                byScale.set(c, path);
              }
              if (dragon || serpent) {
                // Both styles reuse a cached, pre-built scale shape (see
                // snakeArt.ts) instead of recomputing the trig and re-walking
                // Skia's path builder for it on every bead of every frame —
                // `addPath` with a transform just copies the shape's existing
                // verbs into place, which is what actually costs the frame
                // rate at this call volume. One matrix is built per bead and
                // shared across however many shapes land on it.
                const theta = Math.atan2(dy, dx);
                scaleMatrix.identity().translate(xs[k], ys[k]).rotate(theta).scale(r, r);
                if (dragon) {
                  // Across the body, not just along it: each row is a handful
                  // of scales sitting side by side, offset from the row behind.
                  path.addPath(DRAGON_ROW_UNITS[row % DRAGON_ROW_UNITS.length], scaleMatrix);
                } else {
                  // Plates carry the bead's own colour, lit by where they sit
                  // across the body — not the scale highlight the other styles
                  // use, which would flatten the spine back out again.
                  const base = colors[i] ?? s.color;
                  const rowIdx = row % SERPENT_COLS.length;
                  bed!.addPath(SERPENT_BED_ROW_UNITS[rowIdx], scaleMatrix);
                  const acrossList = SERPENT_COLS[rowIdx];
                  const plateUnits = SERPENT_PLATE_UNITS[rowIdx];
                  for (let a = 0; a < acrossList.length; a++) {
                    const lift = SERPENT_LIFT(acrossList[a]);
                    const pc = lift >= 0 ? lighten(base, lift) : shade(base, -lift);
                    let plate = byPlate!.get(pc);
                    if (!plate) {
                      plate = Skia.Path.Make();
                      byPlate!.set(pc, plate);
                    }
                    plate.addPath(plateUnits[a], scaleMatrix);
                  }
                }
                row++;
              } else {
                path.addCircle(
                  xs[k] + dx * r * SCALE_OFFSET,
                  ys[k] + dy * r * SCALE_OFFSET,
                  r * SCALE_RADIUS
                );
              }
            }
            if (bed) {
              paints.scale.setColor(Skia.Color(s.skin?.serpent?.outline ?? '#0A4A26'));
              canvas.drawPath(bed, paints.scale);
            }
            for (const [c, path] of byScale) {
              paints.scale.setColor(Skia.Color(c));
              canvas.drawPath(path, paints.scale);
            }
            if (byPlate) {
              for (const [c, path] of byPlate) {
                paints.scale.setColor(Skia.Color(c));
                canvas.drawPath(path, paints.scale);
              }
            }
          }

          // Flames: a tongue every FLAME_PITCH radii, each one carrying its
          // bead's colour so the skin's gradient still runs head to tail, and
          // all of them pointing *away* from the head — fire trails behind
          // whatever is carrying it. Batched per colour like the body was.
          if (burning) {
            const byFlame = new Map<string, SkPath>();
            const cores = Skia.Path.Make();
            let lastX = Infinity;
            let lastY = Infinity;
            let side: 1 | -1 = 1;
            const pitch = r * FLAME_PITCH;
            for (let k = 0; k < xs.length; k++) {
              if (Math.hypot(xs[k] - lastX, ys[k] - lastY) < pitch) continue;
              lastX = xs[k];
              lastY = ys[k];
              const i = idx[k];
              const ahead = pts[Math.max(0, i - 1)];
              const here = pts[i];
              let dx = ahead.x - here.x;
              let dy = ahead.y - here.y;
              const len = Math.hypot(dx, dy);
              if (len < 1e-4) {
                dx = Math.cos(s.angle);
                dy = Math.sin(s.angle);
              } else {
                dx /= len;
                dy /= len;
              }
              // Backwards, i.e. tailwards.
              dx = -dx;
              dy = -dy;
              const c = s.skin?.flames?.tint ?? colors[i] ?? s.color;
              let path = byFlame.get(c);
              if (!path) {
                path = Skia.Path.Make();
                byFlame.set(c, path);
              }
              flameInto(path, xs[k], ys[k], r, dx, dy, side);
              flameInto(cores, xs[k] + dx * r * 0.34, ys[k] + dy * r * 0.34, r, dx, dy, side, 0.44);
              side = side === 1 ? -1 : 1;
            }
            for (const [c, path] of byFlame) {
              paints.body.setColor(Skia.Color(c));
              canvas.drawPath(path, paints.body);
            }
            const core = s.skin?.flames?.core;
            if (core) {
              paints.scale.setColor(Skia.Color(core));
              canvas.drawPath(cores, paints.scale);
            }
          }

          // ---- head: shared with the skin picker, see snakeArt.ts ---------
          drawSnakeHead(
            canvas,
            {
              x: sx(s.head.x),
              y: sy(s.head.y),
              r,
              angle: s.angle,
              color: colors[0] ?? s.color,
              skin: s.skin,
              art: s.skin?.headArt ? headArt[s.skin.headArt] : undefined,
            },
            paints
          );

          if (fading) canvas.restore();
        }
      }, bounds);

      setPicture(pic);

      if (now - lastLabelAt.current > 1000 / LABEL_HZ) {
        lastLabelAt.current = now;
        setLabels(
          rendered
            .map((s) => ({
              id: s.id,
              name: s.name,
              skin: s.skin?.name,
              x: sx(s.head.x),
              // 11px taller than a bare name needs, to leave room for the
              // skin-name line underneath without creeping toward the head
              // (and whatever crown or ears it's wearing).
              y: sy(s.head.y) - s.radius * scale - 26,
              isLocal: s.isLocal,
            }))
            .filter((l) => l.x > -70 && l.x < width + 70 && l.y > -25 && l.y < height + 25)
        );
      }

      if (showFps) {
        frames.current++;
        if (now - fpsAt.current >= 1000) {
          setFps(frames.current);
          frames.current = 0;
          fpsAt.current = now;
        }
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [sim, width, height, scale, background, paints, scaleMatrix, periodX, periodY, showFps, headArt]);

  return (
    <View style={[styles.root, { width, height }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        {picture && <Picture picture={picture} />}
      </Canvas>

      {labels.map((l) => (
        <View key={l.id} pointerEvents="none" style={[styles.labelWrap, { left: l.x - 70, top: l.y }]}>
          <Text
            numberOfLines={1}
            style={[styles.nameplate, { color: l.isLocal ? '#FFF9C4' : '#FFFFFF' }]}
          >
            {l.name}
          </Text>
          {l.skin && (
            <Text numberOfLines={1} style={styles.skinLabel}>
              {l.skin}
            </Text>
          )}
        </View>
      ))}

      {showFps && <Text style={styles.fps}>{fps} fps</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: theme.arena },
  // Anchors the name + skin pair as one block; each Text just stacks inside it.
  labelWrap: { position: 'absolute', width: 140, alignItems: 'center' },
  nameplate: {
    textAlign: 'center',
    fontSize: 10.5,
    fontWeight: '500',
    // The shadow stays: it is what keeps a light weight readable over a busy
    // arena, and it is doing the work the bold used to.
    textShadowColor: 'rgba(6,44,60,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2.5,
  },
  // Dimmer and smaller than the name — it's a caption, not a second identity.
  skinLabel: {
    textAlign: 'center',
    fontSize: 9,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.72)',
    textShadowColor: 'rgba(6,44,60,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2.5,
  },
  fps: {
    position: 'absolute',
    left: 10,
    bottom: 6,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '900',
  },
});
