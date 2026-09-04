import { lerpAngle, normalizeAngle } from './protocol';
import type { GameMeta, Skin, ViewUpdate, Vec } from './protocol';
import { nowMs } from './clock';

/**
 * Client-side prediction + reconciliation for the continuous arena.
 *
 * The server ticks at 20Hz. Your own snake is simulated locally with the same
 * movement rule so it responds on the frame you move the joystick, then every
 * server update pulls it back onto the truth. Small errors are blended away
 * over a few frames; a big one snaps.
 *
 * Other snakes are extrapolated forward along their last known heading, which
 * is exact unless they turn, and any turn shows up 50ms later at worst.
 */

/** Beyond this many world units of divergence, stop smoothing and snap. */
export const SNAP_DISTANCE = 90;
/** How long a small correction takes to blend away. */
export const CORRECTION_MS = 140;
/** Never extrapolate more than this many ticks if updates stop arriving. */
export const MAX_EXTRAPOLATION = 1.5;
/**
 * How much of each new frame delta is folded into the smoothed one.
 *
 * See `step()`. Low enough to flatten scheduling noise, high enough that a
 * genuine change in frame rate is tracked within a few frames.
 */
const FRAME_SMOOTHING = 0.15;
/** Longest frame the prediction will integrate in one go. */
const MAX_FRAME = 0.1;
/**
 * Below this, a delta is not a frame — it is the second `step()` inside one.
 * `cameraTarget()` and `getRenderSnakes()` both call it, and the second call
 * is microseconds after the first.
 */
const MIN_FRAME = 0.004;

export type Snake = {
  id: number;
  name: string;
  color: string;
  skinIndex: number;
  isBot: boolean;
  isLocal: boolean;
  /** Authoritative body, head first, in world units. */
  path: Vec[];
  x: number;
  y: number;
  angle: number;
  radius: number;
  score: number;
  boosting: boolean;
  /** Spawn protection is still running — drawn faded, can't kill or be killed. */
  invulnerable: boolean;
  /** Wall-clock time this snake's last server update arrived. */
  updatedAt: number;
  /** Server position at that moment, used to extrapolate. */
  serverX: number;
  serverY: number;
  /**
   * Scratch buffer for render points, reused every frame. Allocating a fresh
   * array of ~70 objects per snake per frame was ~60k short-lived objects a
   * second, which is real GC pressure on a phone. The canvas consumes this
   * synchronously, so reusing it is safe.
   */
  scratch: Vec[];
};

export type Food = {
  id: number;
  x: number;
  y: number;
  radius: number;
  value: number;
  /** Index into meta.colors. */
  ci: number;
};

export type RenderSnake = {
  id: number;
  name: string;
  color: string;
  skin: Skin | undefined;
  isLocal: boolean;
  isBot: boolean;
  score: number;
  radius: number;
  boosting: boolean;
  invulnerable: boolean;
  head: Vec;
  angle: number;
  /** Body points, head first, already interpolated for this frame. */
  points: Vec[];
};

/** Fallback palette, replaced by the server's on game_start. */
const FALLBACK_COLORS = [
  '#FF9E2C', '#FF4FA3', '#7ED321', '#3FA9F5', '#B06AB3',
  '#FF5E5B', '#FFD93D', '#2EC4B6', '#33383D', '#F26430',
];

const DEFAULT_META: GameMeta = {
  code: '',
  colors: FALLBACK_COLORS,
  skins: [],
  worldRadius: 1800,
  tickMs: 50,
  borderWarn: 250,
  viewWidth: 760,
  viewHeight: 1340,
  segmentSpacing: 9,
  baseSpeed: 215,
  boostSpeed: 410,
  maxTurnRate: 5.4,
  boostMinScore: 15,
};

export class GameSimulation {
  meta: GameMeta = DEFAULT_META;
  snakes = new Map<number, Snake>();
  food = new Map<number, Food>();

  localId: number | null = null;
  localAlive = false;

  /** Heading the player is currently asking for. */
  private desiredAngle = 0;
  private boosting = false;

  /** Locally predicted head for the local snake. */
  private predX = 0;
  private predY = 0;
  private predAngle = 0;
  private predAt = 0;

  /** Visual error being blended out, in world units. */
  private offset: Vec = { x: 0, y: 0 };
  private offsetAt = 0;

  /**
   * Frozen for a solo pause.
   *
   * Stopping the arena's tick loop is not enough on its own: prediction and
   * extrapolation both run off the wall clock from the render loop, so without
   * this the snakes would carry on gliding across a "paused" screen, and the
   * player's own would then be snapped back the moment the arena caught up.
   */
  private paused = false;

  private now: () => number;

  /**
   * Frame delta the prediction actually integrates, low-pass filtered. See
   * `step()`. Seeded at 60fps so the first frame is not a special case.
   */
  private frameDt = 1 / 60;

  constructor(now: () => number = nowMs) {
    this.now = now;
  }

  setPaused(on: boolean) {
    if (on === this.paused) return;
    this.paused = on;
    if (on) {
      // Drop any correction still blending out. It decays on the wall clock
      // too, so left alone the camera would keep creeping across a frozen
      // screen for the rest of CORRECTION_MS. Solo predicts against its own
      // arena with identical constants, so there is rarely anything here.
      this.offset = { x: 0, y: 0 };
    } else {
      // Start the clock from now, or the whole pause is applied as one
      // enormous step on the next frame.
      this.predAt = this.now();
      this.frameDt = 1 / 60;
    }
  }

  setMeta(meta: GameMeta) {
    this.meta = { ...DEFAULT_META, ...meta };
    if (!this.meta.colors || this.meta.colors.length === 0) {
      this.meta.colors = FALLBACK_COLORS;
    }
  }

  /** Resolve a palette index to a colour, tolerating an out-of-range one. */
  colorAt(index: number): string {
    const p = this.meta.colors;
    return p[index] ?? p[0] ?? '#FF9E2C';
  }

  /** Resolve a skin index; undefined means "plain colour". */
  skinAt(index: number): Skin | undefined {
    return this.meta.skins?.[index];
  }

  // ------------------------------------------------------------- ingestion

  applyView(v: ViewUpdate) {
    const now = this.now();
    this.localId = v.me;
    this.localAlive = v.alive === 1;

    if (v.full) {
      // A resync: drop anything the server didn't just re-send.
      const keep = new Set(v.enter.map((e) => e.id));
      for (const id of [...this.snakes.keys()]) if (!keep.has(id)) this.snakes.delete(id);
      this.food.clear();
    }

    for (const id of v.leave) this.snakes.delete(id);

    for (const e of v.enter) {
      const snake: Snake = {
        id: e.id,
        name: e.n,
        color: this.colorAt(e.ci),
        skinIndex: e.si ?? 0,
        isBot: e.b === 1,
        isLocal: e.me === 1,
        path: e.p.map(([x, y]) => ({ x, y })),
        x: e.x,
        y: e.y,
        angle: e.a,
        radius: e.r,
        score: e.s,
        boosting: false,
        invulnerable: e.iv === 1,
        updatedAt: now,
        serverX: e.x,
        serverY: e.y,
        scratch: [],
      };
      this.snakes.set(e.id, snake);

      if (snake.isLocal) {
        // Ground truth — abandon any local guess.
        this.predX = e.x;
        this.predY = e.y;
        this.predAngle = e.a;
        this.predAt = now;
        this.desiredAngle = e.a;
        this.offset = { x: 0, y: 0 };
      }
    }

    for (const m of v.move) {
      const [id, x, y, a, r, s, boost, safe] = m;
      const snake = this.snakes.get(id);
      if (!snake) continue;

      // Extend the body: push the new head on, trim to the length the score
      // buys. The *new* score has to go in first — trimming against the old one
      // would let a shrinking snake (boosting, say) keep its full length.
      this.extendPath(snake, x, y, s);
      snake.x = x;
      snake.y = y;
      snake.serverX = x;
      snake.serverY = y;
      snake.angle = a;
      snake.radius = r;
      snake.score = s;
      snake.boosting = boost === 1;
      snake.invulnerable = safe === 1;
      snake.updatedAt = now;

      if (snake.isLocal) this.reconcileLocal(x, y, a);
    }

    // Food arrives as a delta — there can be ~70 pellets on screen and they
    // barely change, so the server only tells us what appeared and what left.
    for (const id of v.fd) this.food.delete(id);
    for (const [id, x, y, radius, value, ci] of v.fa) {
      this.food.set(id, { id, x, y, radius, value, ci });
    }
  }

  /** Append a head position, keeping points roughly SEGMENT_SPACING apart. */
  private extendPath(snake: Snake, x: number, y: number, score: number) {
    const head = snake.path[0];
    const spacing = this.meta.segmentSpacing;
    if (!head) {
      snake.path.unshift({ x, y });
    } else {
      const dist = Math.hypot(x - head.x, y - head.y);
      if (dist >= spacing) {
        const steps = Math.min(6, Math.floor(dist / spacing));
        for (let i = 1; i <= steps; i++) {
          const t = (i * spacing) / dist;
          snake.path.unshift({ x: head.x + (x - head.x) * t, y: head.y + (y - head.y) * t });
        }
      }
    }
    const wanted = this.segmentCount(score);
    if (snake.path.length > wanted) snake.path.length = wanted;
  }

  private segmentCount(score: number) {
    // Mirrors the server's SEGMENTS_BASE + score * SEGMENTS_PER_SCORE.
    return Math.floor(12 + score * 0.42);
  }

  /**
   * Fold the authoritative head into the local prediction. If we were close,
   * carry the difference as a decaying visual offset so the correction is
   * invisible; if we were way off, snap.
   */
  private reconcileLocal(x: number, y: number, angle: number) {
    const errX = this.predX - x;
    const errY = this.predY - y;
    const dist = Math.hypot(errX, errY);

    this.predX = x;
    this.predY = y;
    this.predAngle = angle;
    this.predAt = this.now();

    if (dist < 0.5) return;
    if (dist > SNAP_DISTANCE) {
      this.offset = { x: 0, y: 0 };
      return;
    }
    const cur = this.currentOffset();
    this.offset = { x: cur.x + errX, y: cur.y + errY };
    this.offsetAt = this.now();
  }

  // ----------------------------------------------------------------- input

  /** Joystick heading, in radians. Applied locally at once. */
  setDesiredAngle(angle: number) {
    this.desiredAngle = angle;
  }

  setBoosting(on: boolean) {
    this.boosting = on;
  }

  getInput() {
    return { a: this.desiredAngle, b: this.boosting };
  }

  get localSnake(): Snake | null {
    return this.localId != null ? this.snakes.get(this.localId) ?? null : null;
  }

  /**
   * Advance the predicted local head. Same turn-rate limit and speed the server
   * uses, so the two stay in step between updates.
   */
  step(now = this.now()) {
    if (!this.localAlive) return;
    if (this.paused) {
      this.predAt = now;
      return;
    }
    const raw = (now - this.predAt) / 1000;
    if (raw <= 0) return;
    this.predAt = now;

    // Integrate a *smoothed* frame delta rather than the raw one.
    //
    // The render clock measures when this callback got to run, not when the
    // frame reaches the screen, and the two disagree by however long the JS
    // thread was busy. Multiplying that noise by a speed puts it straight into
    // the snake's position, so the arena judders even at a steady frame rate —
    // and worse as the draw gets heavier, which is exactly when a phone can
    // least afford it. The filter is unbiased, so the small difference between
    // smoothed and real time is left for the server correction to absorb.
    //
    // Deltas too short to be a frame are integrated as they are: they come
    // from the second `step()` within one frame, and feeding them to the
    // filter would drag it toward zero.
    let dt: number;
    if (raw < MIN_FRAME) {
      dt = raw;
    } else {
      this.frameDt += (Math.min(MAX_FRAME, raw) - this.frameDt) * FRAME_SMOOTHING;
      dt = this.frameDt;
    }

    const snake = this.localSnake;
    const canBoost = !!snake && snake.score > this.meta.boostMinScore;
    const speed = this.boosting && canBoost ? this.meta.boostSpeed : this.meta.baseSpeed;

    const turnCap = this.meta.maxTurnRate * dt;
    const delta = normalizeAngle(this.desiredAngle - this.predAngle);
    this.predAngle = normalizeAngle(
      this.predAngle + Math.max(-turnCap, Math.min(turnCap, delta))
    );

    this.predX += Math.cos(this.predAngle) * speed * dt;
    this.predY += Math.sin(this.predAngle) * speed * dt;
  }

  // ---------------------------------------------------------------- render

  private currentOffset(): Vec {
    if (this.offset.x === 0 && this.offset.y === 0) return this.offset;
    const t = (this.now() - this.offsetAt) / CORRECTION_MS;
    if (t >= 1) {
      this.offset = { x: 0, y: 0 };
      return this.offset;
    }
    const k = 1 - t;
    return { x: this.offset.x * k, y: this.offset.y * k };
  }

  /** Where the camera should sit this frame. */
  cameraTarget(now = this.now()): Vec {
    this.step(now);
    if (this.localAlive) {
      const off = this.currentOffset();
      return { x: this.predX + off.x, y: this.predY + off.y };
    }
    const snake = this.localSnake;
    return snake ? { x: snake.x, y: snake.y } : { x: 0, y: 0 };
  }

  /**
   * Snakes ready to draw, with heads advanced to this exact frame time.
   */
  getRenderSnakes(now = this.now()): RenderSnake[] {
    this.step(now);
    const out: RenderSnake[] = [];

    for (const s of this.snakes.values()) {
      let head: Vec;
      let angle: number;
      let shift: Vec = { x: 0, y: 0 };

      if (s.isLocal && this.localAlive) {
        const off = this.currentOffset();
        head = { x: this.predX + off.x, y: this.predY + off.y };
        angle = this.predAngle;
        // Move the body by the same amount the head was corrected by, so the
        // snake stays one connected shape.
        shift = { x: head.x - s.x, y: head.y - s.y };
      } else {
        // Extrapolate other snakes along their heading since their last update.
        const alpha = this.paused
          ? 0
          : Math.min(MAX_EXTRAPOLATION, Math.max(0, (now - s.updatedAt) / this.meta.tickMs));
        const speed = (s.boosting ? this.meta.boostSpeed : this.meta.baseSpeed) *
          (this.meta.tickMs / 1000);
        head = {
          x: s.serverX + Math.cos(s.angle) * speed * alpha,
          y: s.serverY + Math.sin(s.angle) * speed * alpha,
        };
        angle = s.angle;
        shift = { x: head.x - s.x, y: head.y - s.y };
      }

      // The whole snake glides forward by the same amount, so it keeps its
      // shape. path[0] is the server's head, which `head` supersedes — including
      // both would draw the same point twice.
      const points = s.scratch;
      points.length = s.path.length;
      points[0] = head;
      for (let i = 1; i < s.path.length; i++) {
        const p = s.path[i];
        const existing = points[i];
        if (existing) {
          existing.x = p.x + shift.x;
          existing.y = p.y + shift.y;
        } else {
          points[i] = { x: p.x + shift.x, y: p.y + shift.y };
        }
      }

      out.push({
        id: s.id,
        name: s.name,
        color: s.color,
        skin: this.skinAt(s.skinIndex),
        isLocal: s.isLocal,
        isBot: s.isBot,
        score: s.score,
        radius: s.radius,
        boosting: s.boosting,
        invulnerable: s.invulnerable,
        head,
        angle,
        points,
      });
    }

    // Draw big snakes first so small ones stay visible on top of them.
    return out.sort((a, b) => b.radius - a.radius);
  }

  getFood(): Food[] {
    return [...this.food.values()];
  }

  localScore(): number {
    const s = this.localSnake;
    return s ? Math.floor(s.score) : 0;
  }

  reset() {
    this.snakes.clear();
    this.food.clear();
    this.localId = null;
    this.localAlive = false;
    this.offset = { x: 0, y: 0 };
    this.paused = false;
    this.frameDt = 1 / 60;
  }
}

export { lerpAngle, normalizeAngle };
