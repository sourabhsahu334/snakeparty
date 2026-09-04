import React, { useEffect, useMemo, useState } from 'react';
import {
  Canvas,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
  createPicture,
  type SkPath,
  type SkPicture,
} from '@shopify/react-native-skia';

import { beadColors, lighten, scaleHighlight, shade } from './skins';
import { useHeadArt } from './headArt';
import { headingAt, slither } from './slither';
import {
  BEAD_PITCH,
  DRAGON_COLS,
  DRAGON_ROW_PITCH,
  SERPENT_COLS,
  SERPENT_LIFT,
  SERPENT_PLATE,
  SERPENT_ROW_PITCH,
  FLAME_PITCH,
  SMOOTH_SCALE_COLS,
  SMOOTH_SCALE_PITCH,
  SMOOTH_SCALE_SHADE,
  SCALE_OFFSET,
  SCALE_PITCH,
  SCALE_RADIUS,
  dragonScaleInto,
  serpentScaleInto,
  fineScaleInto,
  drawSnakeHead,
  flameInto,
  makeHeadPaints,
} from './snakeArt';
import type { Skin } from './protocol';

type Props = {
  skin: Skin | undefined;
  baseColor: string;
  width: number;
  height: number;
  /** Radians per second the wave travels. */
  speed?: number;
  /** Freeze the wave — for a card that is off-screen or not selected. */
  paused?: boolean;
};

/** Full sine waves along the body. Two reads as a snake; more reads as a spring. */
const WAVES = 1.35;
/** Body radius, as a fraction of the box width. */
const RADIUS = 0.11;
/** Peak swing either side of centre, as a fraction of the box width. */
const SWING = 0.2;

/**
 * A snake swimming on the spot, drawn exactly as the arena draws it.
 *
 * Same skin table, same bead/scale geometry, same head routine — so what the
 * picker shows is what turns up in the match. The body comes off `slither`,
 * whose only input is a phase, so animating is just advancing that phase: there
 * is no simulation here and nothing to reset when the skin changes.
 */
export function LiveSnake({ skin, baseColor, width, height, speed = 1.6, paused }: Props) {
  const [picture, setPicture] = useState<SkPicture | null>(null);

  const paints = useMemo(() => makeHeadPaints(), []);
  const body = useMemo(() => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    return p;
  }, []);
  // A smooth body is a stroke down the path rather than a row of discs.
  const tube = useMemo(() => {
    const p = Skia.Paint();
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeCap(StrokeCap.Round);
    p.setStrokeJoin(StrokeJoin.Round);
    p.setAntiAlias(true);
    return p;
  }, []);

  const geom = useMemo(() => {
    const r = width * RADIUS;
    const amplitude = width * SWING;
    // The head sits low with room for its ornament, and the body runs up the
    // box — the same way the reference art frames a snake.
    const headY = height - r * 1.9;
    // Floored, so a box too short to hold a snake still gets a stub of one
    // rather than a body sampled backwards out of the top of the card.
    const length = Math.max(r * 2, headY - r * 2.2);
    const beads = Math.max(6, Math.round(length / (r * BEAD_PITCH)));
    return { r, amplitude, headY, length, beads, cx: width / 2 };
  }, [width, height]);

  const headArt = useHeadArt();

  useEffect(() => {
    if (width <= 0 || height <= 0) return;
    const { r, amplitude, headY, length, beads, cx } = geom;
    const colors = beadColors(skin, baseColor, beads);
    const bounds = { x: 0, y: 0, width, height };
    // One scale every SCALE_PITCH radii, matching the arena — at this bead
    // pitch that is every second or third bead.
    const dragon = skin?.scales?.style === 'dragon';
    const serpent = skin?.scales?.style === 'serpent';
    const scaleEvery = Math.max(
      1,
      Math.round(
        (dragon ? DRAGON_ROW_PITCH : serpent ? SERPENT_ROW_PITCH : SCALE_PITCH) / BEAD_PITCH
      )
    );
    const flameEvery = Math.max(1, Math.round(FLAME_PITCH / BEAD_PITCH));

    let raf = 0;
    const start = Date.now();

    const frame = () => {
      const phase = paused ? 0 : ((Date.now() - start) / 1000) * speed;
      const pts = slither({ beads, length, amplitude, waves: WAVES, phase });

      const pic = createPicture((canvas) => {
        // Tail first, so the head lands on top of the beads behind it.
        const byColor = new Map<string, SkPath>();
        const byScale = new Map<string, SkPath>();
        const byPlate = new Map<string, SkPath>();
        const bed = Skia.Path.Make();
        const outline = Skia.Path.Make();
        const cores = Skia.Path.Make();
        // Fire and dragon plating are bodies in their own right — no beads
        // showing through them, and no outline round beads nobody can see.
        const burning = !!skin?.flames;
        const smooth = !!skin?.smooth;
        const sculpted = burning || dragon || serpent || smooth;
        for (let i = beads - 1; i >= 0; i--) {
          const px = cx + pts[i].x;
          const py = headY - pts[i].y;
          const c = skin?.flames?.tint ?? colors[i] ?? baseColor;
          if (!sculpted) outline.addCircle(px, py, r + 2);
          let path = byColor.get(c);
          if (!path) {
            path = Skia.Path.Make();
            byColor.set(c, path);
          }
          // Tucked inside the artwork when sculpted: fills gaps, never seen.
          if (!smooth) path.addCircle(px, py, sculpted ? r * 0.78 : r);

          if (skin?.scales && i % scaleEvery === 0) {
            const h = headingAt(pts, i);
            const sc = scaleHighlight(skin, c);
            let sp = byScale.get(sc);
            if (!sp) {
              sp = Skia.Path.Make();
              byScale.set(sc, sp);
            }
            // `slither` runs +y down the body while the box runs it up, so the
            // heading's y flips with the points.
            const hx = h.x;
            const hy = -h.y;
            if (dragon) {
              const row = Math.floor(i / scaleEvery);
              for (const across of DRAGON_COLS[row % DRAGON_COLS.length]) {
                dragonScaleInto(sp, px - hy * r * across, py + hx * r * across, r, hx, hy);
              }
            } else if (serpent) {
              // Ink bed then lit plates, exactly as the arena draws it.
              const row = Math.floor(i / scaleEvery);
              for (const across of SERPENT_COLS[row % SERPENT_COLS.length]) {
                const sxp = px - hy * r * across;
                const syp = py + hx * r * across;
                serpentScaleInto(bed, sxp, syp, r, hx, hy);
                const lift = SERPENT_LIFT(across);
                const pc = lift >= 0 ? lighten(c, lift) : shade(c, -lift);
                let plate = byPlate.get(pc);
                if (!plate) {
                  plate = Skia.Path.Make();
                  byPlate.set(pc, plate);
                }
                serpentScaleInto(plate, sxp, syp, r, hx, hy, SERPENT_PLATE);
              }
            } else {
              sp.addCircle(px + hx * r * SCALE_OFFSET, py + hy * r * SCALE_OFFSET, r * SCALE_RADIUS);
            }
          }

          if (burning && i % flameEvery === 0) {
            const h = headingAt(pts, i);
            // Away from the head, and alternating the curl, as the arena does.
            const dx = -h.x;
            const dy = h.y; // `slither` runs +y down the body; the box runs it up
            const side: 1 | -1 = (i / flameEvery) % 2 === 0 ? 1 : -1;
            flameInto(path, px, py, r, dx, dy, side);
            flameInto(cores, px + dx * r * 0.34, py + dy * r * 0.34, r, dx, dy, side, 0.44);
          }
        }

        if (!sculpted) {
          body.setColor(Skia.Color('rgba(0,45,65,0.18)'));
          canvas.drawPath(outline, body);
        }

        if (smooth) {
          // One stroke per run of like-coloured beads, each carrying the joint
          // into the next so no hairline shows where two colours meet.
          tube.setStrokeWidth(r * 2);
          let run = Skia.Path.Make();
          let runColor = colors[beads - 1] ?? baseColor;
          let started = false;
          const flush = () => {
            if (!started) return;
            tube.setColor(Skia.Color(runColor));
            canvas.drawPath(run, tube);
          };
          for (let i = beads - 1; i >= 0; i--) {
            const px = cx + pts[i].x;
            const py = headY - pts[i].y;
            const c = colors[i] ?? baseColor;
            if (!started) {
              run.moveTo(px, py);
              runColor = c;
              started = true;
            } else if (c === runColor) {
              run.lineTo(px, py);
            } else {
              run.lineTo(px, py);
              flush();
              run = Skia.Path.Make();
              run.moveTo(px, py);
              runColor = c;
            }
          }
          flush();

          if (skin?.smooth?.texture) {
            // Scale texture, a shade darker than the skin it sits on.
            const texEvery = Math.max(1, Math.round(SMOOTH_SCALE_PITCH / BEAD_PITCH));
            const byTex = new Map<string, SkPath>();
            for (let i = beads - 1; i >= 0; i--) {
              if (i % texEvery !== 0) continue;
              const px = cx + pts[i].x;
              const py = headY - pts[i].y;
              const h = headingAt(pts, i);
              const hx = h.x;
              const hy = -h.y;
              const c = shade(colors[i] ?? baseColor, SMOOTH_SCALE_SHADE);
              let path = byTex.get(c);
              if (!path) {
                path = Skia.Path.Make();
                byTex.set(c, path);
              }
              const texRow = Math.floor(i / texEvery);
              for (const across of SMOOTH_SCALE_COLS[texRow % SMOOTH_SCALE_COLS.length]) {
                fineScaleInto(path, px - hy * r * across, py + hx * r * across, r, hx, hy);
              }
            }
            for (const [c, path] of byTex) {
              body.setColor(Skia.Color(c));
              canvas.drawPath(path, body);
            }
          }
        }
        for (const [c, path] of byColor) {
          body.setColor(Skia.Color(c));
          canvas.drawPath(path, body);
        }
        if (serpent) {
          body.setColor(Skia.Color(skin?.serpent?.outline ?? '#0A4A26'));
          canvas.drawPath(bed, body);
        }
        for (const [c, path] of byScale) {
          body.setColor(Skia.Color(c));
          canvas.drawPath(path, body);
        }
        for (const [c, path] of byPlate) {
          body.setColor(Skia.Color(c));
          canvas.drawPath(path, body);
        }

        if (skin?.flames?.core) {
          body.setColor(Skia.Color(skin.flames.core));
          canvas.drawPath(cores, body);
        }

        const h = headingAt(pts, 0);
        drawSnakeHead(
          canvas,
          {
            x: cx + pts[0].x,
            y: headY - pts[0].y,
            r,
            angle: Math.atan2(-h.y, h.x),
            color: colors[0] ?? baseColor,
            skin,
            art: skin?.headArt ? headArt[skin.headArt] : undefined,
          },
          paints
        );
      }, bounds);

      setPicture(pic);
      if (!paused) raf = requestAnimationFrame(frame);
    };

    frame();
    return () => cancelAnimationFrame(raf);
  }, [skin, baseColor, width, height, speed, paused, geom, paints, body, tube, headArt]);

  return (
    <Canvas style={{ width, height }}>
      {picture ? <Picture picture={picture} /> : null}
    </Canvas>
  );
}
