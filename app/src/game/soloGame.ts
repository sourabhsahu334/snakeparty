import { PALETTE } from './palette';
import { nowMs } from './clock';
import { DEFAULT_SOLO_SETTINGS, derive, type SoloSettings } from './soloSettings';
import { normalizeAngle, TAU } from './protocol';
import type {
  DeathInfo,
  GameMeta,
  GameOver,
  Leaderboard,
  MatchResult,
  Skin,
  SnakeEnter,
  SnakeMove,
  Vec,
  ViewUpdate,
} from './protocol';

/**
 * The offline arena.
 *
 * Single player runs the whole game on the device: no socket, no room, no
 * server reachable or otherwise. It ticks the same rules the server does and
 * hands the result to the very same `GameSimulation` through the very same
 * `ViewUpdate` shape, so the canvas, the HUD and the prediction code cannot
 * tell the two modes apart.
 *
 * The rules below mirror `server/src/config.js`. They are duplicated rather
 * than shared because the app can't require server code — `prediction.ts`
 * already carries the same copies for the same reason. Change one, change both.
 */
export const SOLO_RULES = {
  TICK_MS: 50,
  WORLD_RADIUS: 1100,
  BORDER_WARN: 250,

  BASE_SPEED: 215,
  BOOST_SPEED: 410,
  MAX_TURN_RATE: 5.4,
  SEGMENT_SPACING: 9,

  START_SCORE: 10,
  BASE_RADIUS: 9,
  RADIUS_GROWTH: 0.32,
  MAX_RADIUS: 34,
  SEGMENTS_BASE: 12,
  SEGMENTS_PER_SCORE: 0.42,

  // Grace period after spawning, mirroring the server's SPAWN_SAFE_MS: for
  // this long a new snake neither dies to a body nor kills with its own, and
  // the canvas draws it faded.
  SPAWN_SAFE_MS: 4000,

  BOOST_MIN_SCORE: 15,
  BOOST_DRAIN_PER_SEC: 11,
  BOOST_TRAIL_EVERY: 22,

  // Food count and population are the player's to set — see soloSettings.ts,
  // whose defaults are trimmed from the server's 420/12 because a phone is
  // running the arena *and* drawing it.
  FOOD_VALUE: 1,
  FOOD_RADIUS: 5,
  BIG_FOOD_RADIUS: 8,
  EAT_REACH: 14,
  CORPSE_VALUE_RATIO: 0.65,
  CORPSE_SPACING: 14,

  BOT_RESPAWN_MS: 3000,

  VIEW_WIDTH: 900,
  VIEW_HEIGHT: 520,
  VIEW_MARGIN: 150,
  LEADERBOARD_EVERY_TICKS: 10,
};

const BOT_NAMES = [
  'Viper', 'Noodle', 'Slinky', 'Fang', 'Coil', 'Zigzag', 'Mamba', 'Hiss',
  'Twist', 'Rattle', 'Python', 'Wriggle', 'Slither', 'Scales', 'Venom',
  'Loop', 'Squiggle', 'Cobra', 'Ribbon', 'Serpent',
];

const R = SOLO_RULES;

// --------------------------------------------------------------- spatial hash

/**
 * Uniform grid for broad-phase collision — a port of server/src/SpatialHash.js.
 *
 * Ten snakes of a few hundred body points each is ~10^6 pair tests a tick if
 * done naively, which a phone will not do 20 times a second.
 */
class SpatialHash<T> {
  private buckets = new Map<string, T[]>();

  constructor(private cellSize: number) {}

  clear() {
    this.buckets.clear();
  }

  insert(x: number, y: number, item: T) {
    const key = `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(item);
    else this.buckets.set(key, [item]);
  }

  /** Every item in the cells overlapping the circle (x, y, radius). */
  query(x: number, y: number, radius: number, out: T[] = []): T[] {
    out.length = 0;
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.buckets.get(`${cx},${cy}`);
        if (bucket) for (const item of bucket) out.push(item);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------- types

type SoloSnake = {
  id: number;
  name: string;
  colorIndex: number;
  skinIndex: number;
  isBot: boolean;
  isLocal: boolean;
  x: number;
  y: number;
  angle: number;
  targetAngle: number;
  boosting: boolean;
  boostTrail: number;
  score: number;
  radius: number;
  alive: boolean;
  kills: number;
  pathAccum: number;
  path: Vec[];
  diedAt: number;
  /** Spawn protection runs out at this clock time. */
  safeUntil: number;
  /** Bot brain; null on the player. */
  brain: BotBrain | null;
};

type Pellet = {
  id: number;
  x: number;
  y: number;
  value: number;
  radius: number;
  ci: number;
  eaten: boolean;
};

type BodyPoint = { id: number; x: number; y: number; r: number };

export type SoloCallbacks = {
  onView: (v: ViewUpdate) => void;
  onLeaderboard: (b: Leaderboard) => void;
  onDeath: (d: DeathInfo) => void;
  /**
   * You killed a snake. Fired once per victim, and never for your own death —
   * running into someone else is their kill, not yours.
   */
  onKill?: (victim: string) => void;
};

export type SoloOptions = {
  name: string;
  colorIndex: number;
  skinIndex: number;
  skins: Skin[];
  /** Player-tuned rules. Omitted means the multiplayer defaults. */
  settings?: SoloSettings;
};

// ------------------------------------------------------------------ bot brain

/**
 * Bot steering, ported from server/src/Bot.js.
 *
 * Deliberately cheap — it runs for every bot every tick. The goal is an arena
 * that feels alive, not an opponent that outplays you.
 */
class BotBrain {
  private wanderAngle = Math.random() * TAU;
  private retargetIn = 0;
  private target: Pellet | null = null;
  private boostUntil = 0;

  think(s: SoloSnake, dt: number, world: SoloGame, threats: BodyPoint[], now: number) {
    this.retargetIn -= dt;

    // 1. Steer away from the rim before it kills us.
    const distFromCenter = Math.hypot(s.x, s.y);
    if (distFromCenter > world.worldRadius - 220) {
      s.targetAngle = Math.atan2(-s.y, -s.x);
      s.boosting = false;
      return;
    }

    // 2. Dodge any body we're about to run into.
    const look = s.radius + 46;
    const aheadX = s.x + Math.cos(s.angle) * look;
    const aheadY = s.y + Math.sin(s.angle) * look;
    let dodge = 0;
    for (const t of threats) {
      if (t.id === s.id) continue;
      const dx = t.x - aheadX;
      const dy = t.y - aheadY;
      if (dx * dx + dy * dy > look * look) continue;
      const rel = normalizeAngle(Math.atan2(t.y - s.y, t.x - s.x) - s.angle);
      dodge += rel > 0 ? -1 : 1;
    }
    if (dodge !== 0) {
      s.targetAngle = s.angle + (dodge > 0 ? 1.1 : -1.1);
      s.boosting = false;
      this.target = null;
      return;
    }

    // 3. Otherwise go eat something.
    if (!this.target || this.retargetIn <= 0 || this.target.eaten) {
      this.target = world.foodNear(s.x, s.y, 420);
      this.retargetIn = 0.6 + Math.random() * 0.8;
    }
    if (this.target) {
      s.targetAngle = Math.atan2(this.target.y - s.y, this.target.x - s.x);
    } else {
      // Nothing worth chasing — drift, with a gentle bias back toward the middle.
      this.wanderAngle += (Math.random() - 0.5) * 1.4 * dt;
      const inward = Math.atan2(-s.y, -s.x);
      const pull = Math.min(1, distFromCenter / world.worldRadius);
      s.targetAngle = this.wanderAngle + normalizeAngle(inward - this.wanderAngle) * pull * 0.6;
    }

    // 4. Occasional sprint, so bots aren't all the same speed.
    if (now > this.boostUntil && s.score > 45 && Math.random() < 0.004) {
      this.boostUntil = now + 700 + Math.random() * 900;
    }
    s.boosting = now < this.boostUntil && s.score > R.BOOST_MIN_SCORE;
  }
}

// ----------------------------------------------------------------------- game

export class SoloGame {
  readonly meta: GameMeta;
  /** Tunable, so bots and the rim test against the arena the player chose. */
  worldRadius: number;

  /** The settings resolved into the numbers the tick loop uses. */
  private tuned: ReturnType<typeof derive>;
  private settings: SoloSettings;

  private snakes = new Map<number, SoloSnake>();
  private food = new Map<number, Pellet>();
  private bodyHash = new SpatialHash<BodyPoint>(60);
  private foodHash = new SpatialHash<Pellet>(80);
  private scratch: BodyPoint[] = [];
  private foodScratch: Pellet[] = [];

  private nextSnakeId = 1;
  private nextFoodId = 1;
  private tickCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private startedAt = 0;

  /** The snake the player is driving. Replaced on every respawn. */
  private localId = 0;
  private desiredAngle = 0;
  private boosting = false;

  /** Carried across respawns, so a run's totals survive dying. */
  private bestScore = 0;
  private totalKills = 0;

  /** Snake ids the view has already sent a full body for. */
  private known = new Set<number>();
  private knownFood = new Set<number>();

  /**
   * @param now injectable clock, so a test can drive `tick()` by hand instead
   *   of waiting on wall time. Mirrors `GameSimulation`'s constructor.
   */
  constructor(
    private opts: SoloOptions,
    private cb: SoloCallbacks,
    private now: () => number = nowMs
  ) {
    this.settings = opts.settings ?? DEFAULT_SOLO_SETTINGS;
    this.tuned = derive(this.settings, {
      speed: R.BASE_SPEED,
      boost: R.BOOST_SPEED,
      turn: R.MAX_TURN_RATE,
    });
    this.worldRadius = this.tuned.worldRadius;

    // The tuned numbers go into the meta, not just the tick loop: the client
    // predicts the player's own snake from exactly these, so if the meta said
    // 215 while the arena ran at 430 the snake would spend the whole run being
    // snapped backwards.
    this.meta = {
      code: 'SOLO',
      colors: PALETTE,
      skins: opts.skins,
      worldRadius: this.tuned.worldRadius,
      tickMs: R.TICK_MS,
      borderWarn: R.BORDER_WARN,
      viewWidth: R.VIEW_WIDTH,
      viewHeight: R.VIEW_HEIGHT,
      segmentSpacing: R.SEGMENT_SPACING,
      baseSpeed: this.tuned.baseSpeed,
      boostSpeed: this.tuned.boostSpeed,
      maxTurnRate: this.tuned.maxTurnRate,
      boostMinScore: R.BOOST_MIN_SCORE,
    };
  }

  // ------------------------------------------------------------- lifecycle

  start() {
    if (this.timer) return;
    this.startedAt = this.now();
    this.lastTickAt = this.now();

    for (let i = 0; i < this.tuned.foodCount; i++) {
      this.spawnFood(this.randomPoint(), R.FOOD_VALUE);
    }
    this.spawnLocal();
    this.topUpBots();

    // Report the seeded world before the first tick, or the arena screen opens
    // on 50ms of empty background while it waits for the timer.
    this.cb.onView(this.buildView());
    this.cb.onLeaderboard(this.leaderboard());

    this.timer = setInterval(() => this.tick(), R.TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Halt the arena where it stands. `resume()` picks it up again. */
  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  resume() {
    if (this.timer) return;
    // Start the clock from now, or the first tick back applies the whole pause
    // as one step and everything lurches forward.
    this.lastTickAt = this.now();
    this.timer = setInterval(() => this.tick(), R.TICK_MS);
  }

  get isRunning() {
    return this.timer !== null;
  }

  get currentSettings(): SoloSettings {
    return this.settings;
  }

  /**
   * Re-tune a run in progress.
   *
   * Speed and food take effect on the next tick with nothing to reconcile.
   * The other two need care, and both cases are about not punishing someone
   * for opening a settings screen: shrinking the arena would otherwise leave
   * snakes outside the new rim and kill them instantly, and lowering the
   * population would leave the surplus in play until it happened to die.
   */
  applySettings(next: SoloSettings) {
    this.settings = next;
    this.tuned = derive(next, {
      speed: R.BASE_SPEED,
      boost: R.BOOST_SPEED,
      turn: R.MAX_TURN_RATE,
    });
    this.worldRadius = this.tuned.worldRadius;

    this.meta.worldRadius = this.tuned.worldRadius;
    this.meta.baseSpeed = this.tuned.baseSpeed;
    this.meta.boostSpeed = this.tuned.boostSpeed;
    this.meta.maxTurnRate = this.tuned.maxTurnRate;

    // Anything now outside the rim is carried back in along its own bearing,
    // whole body together so it keeps its shape.
    const limit = this.worldRadius - 60;
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const d = Math.hypot(s.x, s.y);
      if (d <= limit) continue;
      const k = limit / (d || 1);
      const dx = s.x * k - s.x;
      const dy = s.y * k - s.y;
      s.x += dx;
      s.y += dy;
      for (const pt of s.path) {
        pt.x += dx;
        pt.y += dy;
      }
    }

    for (const [id, f] of this.food) {
      if (Math.hypot(f.x, f.y) > this.worldRadius - 40) this.food.delete(id);
    }

    // Trim the surplus, furthest from the player first so nothing vanishes
    // under their nose. topUpBots() handles the other direction on its own.
    const me = this.snakes.get(this.localId);
    const bots = [...this.snakes.values()].filter((s) => s.alive && s.isBot);
    let surplus = bots.length + (me && me.alive ? 1 : 0) - this.tuned.population;
    if (surplus > 0) {
      bots
        .sort(
          (a, b) =>
            Math.hypot(b.x - (me?.x ?? 0), b.y - (me?.y ?? 0)) -
            Math.hypot(a.x - (me?.x ?? 0), a.y - (me?.y ?? 0))
        )
        .slice(0, surplus)
        .forEach((s) => this.snakes.delete(s.id));
    }
  }

  setInput(angle: number, boosting: boolean) {
    this.desiredAngle = angle;
    this.boosting = boosting;
  }

  respawn() {
    const old = this.snakes.get(this.localId);
    if (old) this.snakes.delete(old.id);
    this.spawnLocal();
  }

  /** A scoreboard for the results screen, shaped like the server's `game_over`. */
  summary(): GameOver {
    const board = [...this.snakes.values()]
      .filter((s) => s.alive || s.isLocal)
      .sort((a, b) => b.score - a.score);

    const row = (s: SoloSnake, placement: number): MatchResult => ({
      index: s.isLocal ? 0 : s.id,
      clientId: s.isLocal ? 'solo' : `bot-${s.id}`,
      userId: null,
      username: s.name,
      score: s.isLocal ? Math.max(this.bestScore, Math.floor(s.score)) : Math.floor(s.score),
      kills: s.isLocal ? this.totalKills : s.kills,
      placement,
      survived: s.alive,
    });

    const results = board.slice(0, 8).map((s, i) => row(s, i + 1));
    // Bots start with up to 60 points of head start, so a short run can leave
    // the player outside the top eight. They still have to be on their own
    // scoreboard — with their real placement, not a flattering one.
    const mine = board.findIndex((s) => s.isLocal);
    if (mine >= 8) results.push(row(board[mine], mine + 1));

    return {
      roomCode: 'SOLO',
      durationMs: this.now() - this.startedAt,
      winner: results[0] ?? null,
      results,
    };
  }

  // ------------------------------------------------------------------- tick

  /** Advance the arena one step. `start()` calls this on a 20Hz timer. */
  tick() {
    const now = this.now();
    // Real elapsed time rather than a fixed step: if the JS thread stalls, the
    // arena has to catch up or it drifts behind the client-side prediction,
    // which then spends the next second visibly snapping the player back.
    const dt = Math.min(0.15, Math.max(0.01, (now - this.lastTickAt) / 1000));
    this.lastTickAt = now;
    this.tickCount++;

    this.rebuildHashes();

    // 1. Bots decide where to go.
    for (const s of this.snakes.values()) {
      if (!s.alive || !s.brain) continue;
      const look = s.radius + 46;
      const threats = this.bodyHash.query(
        s.x + Math.cos(s.angle) * look,
        s.y + Math.sin(s.angle) * look,
        look,
        this.scratch
      );
      s.brain.think(s, dt, this, threats, now);
    }

    // 2. The player steers their own snake.
    const me = this.snakes.get(this.localId);
    if (me && me.alive) {
      me.targetAngle = this.desiredAngle;
      me.boosting = this.boosting && me.score > R.BOOST_MIN_SCORE;
    }

    // 3. Move, collide, eat.
    for (const s of this.snakes.values()) if (s.alive) this.moveSnake(s, dt);
    this.resolveCollisions();
    this.resolveEating();

    // 4. Keep the arena stocked and populated.
    this.topUpFood();
    this.topUpBots();

    // 5. Hand the player their slice of the world.
    this.cb.onView(this.buildView());
    if (this.tickCount % R.LEADERBOARD_EVERY_TICKS === 0) {
      this.cb.onLeaderboard(this.leaderboard());
    }
  }

  private rebuildBodyHash() {
    this.bodyHash.clear();
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      // Skip the few points nearest the head so a snake can't clip its own neck.
      for (let i = 3; i < s.path.length; i++) {
        const pt = s.path[i];
        this.bodyHash.insert(pt.x, pt.y, { id: s.id, x: pt.x, y: pt.y, r: s.radius });
      }
    }
  }

  private rebuildHashes() {
    this.rebuildBodyHash();
    this.foodHash.clear();
    for (const f of this.food.values()) this.foodHash.insert(f.x, f.y, f);
  }

  private moveSnake(s: SoloSnake, dt: number) {
    const turnCap = this.tuned.maxTurnRate * dt;
    const delta = normalizeAngle(s.targetAngle - s.angle);
    s.angle = normalizeAngle(s.angle + Math.max(-turnCap, Math.min(turnCap, delta)));

    let speed = this.tuned.baseSpeed;
    if (s.boosting && s.score > R.BOOST_MIN_SCORE) {
      speed = this.tuned.boostSpeed;
      s.score = Math.max(R.BOOST_MIN_SCORE, s.score - R.BOOST_DRAIN_PER_SEC * dt);
      s.boostTrail += speed * dt;
      if (s.boostTrail >= R.BOOST_TRAIL_EVERY) {
        s.boostTrail = 0;
        const tail = s.path[s.path.length - 1];
        if (tail) this.spawnFood({ x: tail.x, y: tail.y }, R.FOOD_VALUE);
      }
    } else {
      s.boosting = false;
    }

    s.x += Math.cos(s.angle) * speed * dt;
    s.y += Math.sin(s.angle) * speed * dt;

    // Record the path at fixed spacing, so body length doesn't depend on framerate.
    s.pathAccum += speed * dt;
    while (s.pathAccum >= R.SEGMENT_SPACING) {
      s.pathAccum -= R.SEGMENT_SPACING;
      s.path.unshift({ x: s.x, y: s.y });
    }
    const wanted = segmentCount(s.score);
    if (s.path.length > wanted) s.path.length = wanted;

    s.radius = radiusFor(s.score);
  }

  private resolveCollisions() {
    const dead: Array<{ snake: SoloSnake; killer: SoloSnake | null }> = [];
    const now = this.now();

    for (const s of this.snakes.values()) {
      if (!s.alive) continue;

      // The rim still kills through spawn protection: nobody spawns near the
      // wall, so driving into it is a decision rather than something that
      // happened to you while you were still getting your bearings.
      if (Math.hypot(s.x, s.y) > this.worldRadius) {
        dead.push({ snake: s, killer: null });
        continue;
      }

      // Fresh out of the gate: no body can kill it for SPAWN_SAFE_MS.
      if (now < s.safeUntil) continue;

      // Another snake's body. Your own is harmless — that's the snake.io rule,
      // and it's what lets you coil around someone to trap them.
      const near = this.bodyHash.query(s.x, s.y, s.radius + 24, this.scratch);
      for (const point of near) {
        if (point.id === s.id) continue;
        const other = this.snakes.get(point.id);
        if (!other || !other.alive) continue;
        // Protection cuts both ways, or a new snake would be a free blade to
        // swing through the arena for four seconds.
        if (now < other.safeUntil) continue;
        const dx = point.x - s.x;
        const dy = point.y - s.y;
        const reach = s.radius + point.r * 0.85;
        if (dx * dx + dy * dy < reach * reach) {
          dead.push({ snake: s, killer: other });
          break;
        }
      }
    }

    for (const { snake, killer } of dead) this.killSnake(snake, killer);
  }

  private resolveEating() {
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const reach = s.radius + R.EAT_REACH;
      const near = this.foodHash.query(s.x, s.y, reach, this.foodScratch);
      for (const f of near) {
        if (f.eaten) continue;
        const dx = f.x - s.x;
        const dy = f.y - s.y;
        const r = reach + f.radius;
        if (dx * dx + dy * dy < r * r) {
          f.eaten = true;
          this.food.delete(f.id);
          s.score += f.value;
        }
      }
    }
  }

  private killSnake(s: SoloSnake, killer: SoloSnake | null) {
    if (!s.alive) return;
    s.alive = false;
    s.diedAt = this.now();

    if (killer && killer.id !== s.id) {
      killer.kills++;
      if (killer.isLocal) {
        this.totalKills++;
        this.cb.onKill?.(s.name);
      }
    }

    // The body becomes food. This is the whole economy of the game: a big snake
    // dying is a feast, which is why hunting is worth the risk.
    const total = s.score * R.CORPSE_VALUE_RATIO;
    const wanted = Math.max(1, Math.floor((s.path.length * R.SEGMENT_SPACING) / R.CORPSE_SPACING));
    const step = Math.max(1, Math.round(s.path.length / wanted));
    const drops = Math.ceil(s.path.length / step);
    const per = Math.max(R.FOOD_VALUE, total / drops);

    for (let i = 0; i < s.path.length; i += step) {
      const pt = s.path[i];
      this.spawnFood(
        { x: pt.x + (Math.random() - 0.5) * 10, y: pt.y + (Math.random() - 0.5) * 10 },
        per,
        true,
        s.colorIndex
      );
    }

    if (s.isLocal) {
      this.bestScore = Math.max(this.bestScore, Math.floor(s.score));
      this.cb.onDeath({
        score: Math.floor(s.score),
        kills: this.totalKills,
        killer: killer ? killer.name : null,
        rank: this.rankOf(s),
      });
    }
    s.path = [];
  }

  // ------------------------------------------------------------------ spawn

  private spawnLocal() {
    const snake = this.spawnSnake({
      name: this.opts.name,
      colorIndex: this.opts.colorIndex,
      skinIndex: this.opts.skinIndex,
      isBot: false,
    });
    snake.isLocal = true;
    this.localId = snake.id;
    // Start pointed where the player is already steering, or they spin on spawn.
    this.desiredAngle = snake.angle;
    return snake;
  }

  private spawnSnake(o: {
    name: string;
    colorIndex: number;
    skinIndex: number;
    isBot: boolean;
  }): SoloSnake {
    const pos = this.safeSpawnPoint();
    // Aimed inward so nobody spawns into the rim, but fanned much wider than
    // the server's +/-0.4: ten snakes all pointed at the exact centre of the
    // arena converge there within a couple of seconds, and a player who hasn't
    // touched the joystick yet drives straight into the pile.
    const angle = Math.atan2(-pos.y, -pos.x) + (Math.random() - 0.5) * 2.4;

    const snake: SoloSnake = {
      id: this.nextSnakeId++,
      name: o.name,
      colorIndex: o.colorIndex,
      skinIndex: o.skinIndex,
      isBot: o.isBot,
      isLocal: false,
      x: pos.x,
      y: pos.y,
      angle,
      targetAngle: angle,
      boosting: false,
      boostTrail: 0,
      score: R.START_SCORE,
      radius: radiusFor(R.START_SCORE),
      alive: true,
      kills: 0,
      pathAccum: 0,
      path: [],
      diedAt: 0,
      safeUntil: this.now() + R.SPAWN_SAFE_MS,
      brain: o.isBot ? new BotBrain() : null,
    };

    // Lay the starting body out behind the head.
    const back = angle + Math.PI;
    for (let i = 0; i < segmentCount(R.START_SCORE); i++) {
      snake.path.push({
        x: pos.x + Math.cos(back) * i * R.SEGMENT_SPACING,
        y: pos.y + Math.sin(back) * i * R.SEGMENT_SPACING,
      });
    }

    this.snakes.set(snake.id, snake);
    return snake;
  }

  private topUpBots() {
    const now = this.now();
    for (const [id, s] of this.snakes) {
      if (s.isBot && !s.alive && now - s.diedAt > R.BOT_RESPAWN_MS) this.snakes.delete(id);
    }

    const living = [...this.snakes.values()].filter((s) => s.alive).length;
    const want = Math.max(0, this.tuned.population - living);
    for (let i = 0; i < want; i++) {
      const snake = this.spawnSnake({
        name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
        colorIndex: Math.floor(Math.random() * PALETTE.length),
        // Bots wear the whole catalogue, so a solo arena shows off every skin.
        skinIndex: Math.floor(Math.random() * Math.max(1, this.opts.skins.length)),
        isBot: true,
      });
      snake.score = R.START_SCORE + Math.random() * 60;
    }
  }

  private spawnFood(pos: Vec, value: number, big = false, colorIndex?: number) {
    const f: Pellet = {
      id: this.nextFoodId++,
      x: pos.x,
      y: pos.y,
      value,
      radius: big ? R.BIG_FOOD_RADIUS : R.FOOD_RADIUS,
      ci: colorIndex === undefined ? Math.floor(Math.random() * PALETTE.length) : colorIndex,
      eaten: false,
    };
    this.food.set(f.id, f);
    return f;
  }

  private topUpFood() {
    // Trickle rather than dumping hundreds at once.
    const deficit = Math.min(12, this.tuned.foodCount - this.food.size);
    for (let i = 0; i < deficit; i++) this.spawnFood(this.randomPoint(), R.FOOD_VALUE);
  }

  private randomPoint(): Vec {
    const a = Math.random() * TAU;
    const r = Math.sqrt(Math.random()) * (this.worldRadius - 40);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  /** A point with no snake body nearby, so you don't spawn inside someone. */
  private safeSpawnPoint(): Vec {
    // The hash is otherwise only current as of the last tick, and seeding the
    // arena happens before any tick has run — without this the player and all
    // ten bots are placed blind, land on top of each other, and the run is over
    // in its first second.
    this.rebuildBodyHash();
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = this.randomPoint();
      if (this.bodyHash.query(p.x, p.y, 130, this.scratch).length === 0) return p;
    }
    return this.randomPoint();
  }

  // ----------------------------------------------------------------- queries

  /** Nearest worthwhile pellet, preferring bigger ones. Used by the bots. */
  foodNear(x: number, y: number, radius: number): Pellet | null {
    const near = this.foodHash.query(x, y, radius, this.foodScratch);
    let best: Pellet | null = null;
    let bestD = Infinity;
    for (const f of near) {
      if (f.eaten) continue;
      const d = (f.x - x) ** 2 + (f.y - y) ** 2;
      const weighted = d / (1 + f.value * 0.4);
      if (weighted < bestD) {
        bestD = weighted;
        best = f;
      }
    }
    return best;
  }

  private rankOf(snake: SoloSnake): number {
    const all = [...this.snakes.values()]
      .filter((s) => s.alive || s.id === snake.id)
      .sort((a, b) => b.score - a.score);
    return all.findIndex((s) => s.id === snake.id) + 1;
  }

  private leaderboard(): Leaderboard {
    const all = [...this.snakes.values()].filter((s) => s.alive).sort((a, b) => b.score - a.score);
    const idx = all.findIndex((s) => s.id === this.localId);
    const me = this.snakes.get(this.localId);
    return {
      top: all.slice(0, 10).map((s, i) => ({
        rank: i + 1,
        id: s.id,
        name: s.name,
        score: Math.floor(s.score),
        bot: s.isBot ? 1 : 0,
      })),
      total: all.length,
      you: [
        {
          socketId: 'solo',
          rank: idx === -1 ? null : idx + 1,
          score: me ? Math.floor(me.score) : 0,
          alive: !!me && me.alive,
        },
      ],
    };
  }

  // -------------------------------------------------------------------- view

  /**
   * The player's slice of the arena, in the wire shape `GameSimulation` eats.
   *
   * Nothing is being sent anywhere, so this could hand over the whole world —
   * but culling to the viewport and sending food as a delta is what keeps the
   * per-tick allocation down to a few dozen objects instead of several hundred.
   */
  private buildView(): ViewUpdate {
    const now = this.now();
    const me = this.snakes.get(this.localId);
    // A dead player keeps watching from where they fell.
    const cx = me ? me.x : 0;
    const cy = me ? me.y : 0;
    const halfW = R.VIEW_WIDTH / 2 + R.VIEW_MARGIN;
    const halfH = R.VIEW_HEIGHT / 2 + R.VIEW_MARGIN;

    const enter: SnakeEnter[] = [];
    const move: SnakeMove[] = [];
    const visible = new Set<number>();

    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      if (!boxNear(s, cx, cy, halfW, halfH)) continue;
      visible.add(s.id);

      if (this.known.has(s.id)) {
        move.push([
          s.id,
          s.x,
          s.y,
          s.angle,
          s.radius,
          Math.floor(s.score),
          s.boosting ? 1 : 0,
          now < s.safeUntil ? 1 : 0,
        ]);
      } else {
        this.known.add(s.id);
        enter.push({
          id: s.id,
          n: s.name,
          ci: s.colorIndex,
          si: s.skinIndex,
          b: s.isBot ? 1 : 0,
          me: s.isLocal ? 1 : 0,
          p: s.path.map((pt) => [pt.x, pt.y] as [number, number]),
          x: s.x,
          y: s.y,
          a: s.angle,
          r: s.radius,
          s: Math.floor(s.score),
          iv: now < s.safeUntil ? 1 : 0,
        });
      }
    }

    const leave: number[] = [];
    for (const id of this.known) {
      if (!visible.has(id)) {
        leave.push(id);
        this.known.delete(id);
      }
    }

    const fa: ViewUpdate['fa'] = [];
    const visibleFood = new Set<number>();
    for (const f of this.food.values()) {
      if (Math.abs(f.x - cx) > halfW || Math.abs(f.y - cy) > halfH) continue;
      visibleFood.add(f.id);
      if (!this.knownFood.has(f.id)) {
        this.knownFood.add(f.id);
        fa.push([f.id, f.x, f.y, f.radius, f.value, f.ci]);
      }
    }
    const fd: number[] = [];
    for (const id of this.knownFood) {
      if (!visibleFood.has(id)) {
        fd.push(id);
        this.knownFood.delete(id);
      }
    }

    return {
      t: now,
      me: this.localId,
      alive: me && me.alive ? 1 : 0,
      enter,
      move,
      leave,
      fa,
      fd,
      full: 0,
    };
  }
}

// -------------------------------------------------------------------- helpers

const segmentCount = (score: number) =>
  Math.floor(R.SEGMENTS_BASE + score * R.SEGMENTS_PER_SCORE);

const radiusFor = (score: number) =>
  Math.min(R.MAX_RADIUS, R.BASE_RADIUS + Math.sqrt(Math.max(0, score)) * R.RADIUS_GROWTH);

/** A long snake can be on screen even when its head isn't. */
function boxNear(s: SoloSnake, cx: number, cy: number, halfW: number, halfH: number) {
  if (Math.abs(s.x - cx) < halfW && Math.abs(s.y - cy) < halfH) return true;
  for (let i = 0; i < s.path.length; i += 8) {
    const pt = s.path[i];
    if (Math.abs(pt.x - cx) < halfW && Math.abs(pt.y - cy) < halfH) return true;
  }
  return false;
}
