'use strict';

const C = require('./config');
const { SKINS, normalizeSkinIndex } = require('./skins');
const Bot = require('./Bot');
const SpatialHash = require('./SpatialHash');

const TAU = Math.PI * 2;
let nextSnakeId = 1;

/**
 * One private room = one continuous snake.io-style arena, entirely in memory.
 *
 * Authoritative rules:
 *  - Clients send a desired heading (and whether boost is held). Nothing else.
 *  - Snakes move at a fixed speed along their heading; turning is rate-limited.
 *  - You die by touching another snake's body, or the arena rim. Your own body
 *    never kills you (that is the snake.io rule, and it's why tight coils work).
 *  - A dead snake becomes food, which is what makes killing worthwhile.
 */
class GameRoom {
  constructor(code, opts) {
    this.code = code;
    this.emit = opts.emit;
    this.emitTo = opts.emitTo;              // (socketId, event, payload)
    this.onEmpty = opts.onEmpty || (() => {});
    this.hostClientId = opts.hostClientId;

    this.worldRadius = C.WORLD_RADIUS;

    /** @type {Map<string, object>} human players, keyed by socket id */
    this.players = new Map();
    /** @type {Map<number, object>} every snake in the arena, humans and bots */
    this.snakes = new Map();
    /** @type {Map<number, object>} food pellets by id */
    this.food = new Map();
    this.nextFoodId = 1;

    this.bots = [];
    this.bodyHash = new SpatialHash(60);
    this.foodHash = new SpatialHash(120);

    this.status = 'lobby';
    this.tickCount = 0;
    this.timer = null;
    this.startedAt = null;
    this.usedSlots = new Set();

    // Nothing else frees a room that is created but never started: the match
    // cap only applies once tick() is running, and onEmpty only fires when the
    // last player leaves. Cleared on start() and on stop().
    this.lobbyTimer = null;
    this._armLobbyReaper();
  }

  /**
   * Free a room that sits in the lobby and never starts. Re-armed whenever the
   * room returns to the lobby, cleared the moment a match begins.
   */
  _armLobbyReaper() {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      if (this.status !== 'lobby') return;
      console.log(`[room ${this.code}] idle in lobby, reaping`);
      this.stop();
      this.onEmpty(this);
    }, C.LOBBY_MAX_MS);
    if (this.lobbyTimer.unref) this.lobbyTimer.unref();
  }

  // ---------------------------------------------------------------- players

  get playerCount() {
    return this.players.size;
  }

  get isFull() {
    return this.players.size >= C.MAX_PLAYERS;
  }

  addPlayer(socketId, { clientId, userId, username, colorIndex, skinIndex }) {
    if (this.isFull) return null;
    if (this.status !== 'lobby') return null;

    const slot = this._claimSlot();
    if (slot === -1) return null;

    // Players pick their own colour and skin; fall back to slot defaults.
    const ci = normalizeColorIndex(colorIndex, slot);
    const si = normalizeSkinIndex(skinIndex);

    const player = {
      socketId,
      clientId,
      userId: userId || null,
      username: username || `Player ${slot + 1}`,
      index: slot,
      colorIndex: ci,
      color: C.COLORS[ci],
      skinIndex: si,
      snakeId: null,
      bestScore: 0,
      kills: 0,
      connected: true,
      disconnectTimer: null,
      tokens: C.INPUT_RATE_BURST,
      lastRefill: Date.now(),
      // Which snake ids this client currently has full bodies for.
      known: new Set(),
      // Which pellet ids it already knows about, so food is sent as a delta.
      knownFood: new Set(),
    };
    this.players.set(socketId, player);
    return player;
  }

  removePlayer(socketId) {
    const p = this.players.get(socketId);
    if (!p) return;
    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    if (p.snakeId != null) {
      const s = this.snakes.get(p.snakeId);
      if (s && s.alive) this._killSnake(s, null);
      this.snakes.delete(p.snakeId);
    }
    this.usedSlots.delete(p.index);
    this.players.delete(socketId);

    if (this.players.size === 0) {
      this.stop();
      this.onEmpty(this);
      return;
    }
    if (p.clientId === this.hostClientId) {
      const next = [...this.players.values()].sort((a, b) => a.index - b.index)[0];
      this.hostClientId = next.clientId;
    }
  }

  isHost(clientId) {
    return clientId === this.hostClientId;
  }

  /** Change a player's colour and/or skin from the lobby. */
  setLook(socketId, { colorIndex, skinIndex } = {}) {
    const p = this.players.get(socketId);
    if (!p) return false;
    if (colorIndex !== undefined) {
      p.colorIndex = normalizeColorIndex(colorIndex, p.index);
      p.color = C.COLORS[p.colorIndex];
    }
    if (skinIndex !== undefined) p.skinIndex = normalizeSkinIndex(skinIndex);

    const s = this.snakes.get(p.snakeId);
    if (s) {
      s.colorIndex = p.colorIndex;
      s.color = p.color;
      s.skinIndex = p.skinIndex;
    }
    return true;
  }

  reclaim(clientId, newSocketId) {
    for (const [sid, p] of this.players) {
      if (p.clientId !== clientId) continue;
      if (p.disconnectTimer) {
        clearTimeout(p.disconnectTimer);
        p.disconnectTimer = null;
      }
      this.players.delete(sid);
      p.socketId = newSocketId;
      p.connected = true;
      p.known = new Set(); // force a fresh set of full bodies
      p.knownFood = new Set();
      this.players.set(newSocketId, p);
      return p;
    }
    return null;
  }

  markDisconnected(socketId, onExpire) {
    const p = this.players.get(socketId);
    if (!p) return;
    p.connected = false;
    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    p.disconnectTimer = setTimeout(() => {
      p.disconnectTimer = null;
      this.removePlayer(p.socketId);
      onExpire && onExpire(p);
    }, C.RECONNECT_GRACE_MS);
  }

  // -------------------------------------------------------------- lifecycle

  start() {
    if (this.status === 'running') return false;
    if (this.players.size < C.MIN_PLAYERS) return false;

    this.status = 'running';
    if (this.lobbyTimer) { clearTimeout(this.lobbyTimer); this.lobbyTimer = null; }
    this.tickCount = 0;
    this.startedAt = Date.now();
    this.snakes.clear();
    this.food.clear();
    this.bots = [];

    for (const p of this.players.values()) {
      p.bestScore = 0;
      p.kills = 0;
      p.known = new Set();
      p.knownFood = new Set();
      const snake = this._spawnSnake({
        name: p.username,
        colorIndex: p.colorIndex,
        skinIndex: p.skinIndex,
        isBot: false,
        ownerSocket: p.socketId,
      });
      p.snakeId = snake.id;
    }

    this._topUpBots();
    for (let i = 0; i < C.FOOD_COUNT; i++) this._spawnFood(this._randomPoint(), C.FOOD_VALUE);

    this.emit(this, 'game_start', this.meta());
    for (const p of this.players.values()) this._sendView(p, true);

    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        console.error(`[room ${this.code}] tick error`, err);
      }
    }, C.TICK_MS);
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.lobbyTimer) { clearTimeout(this.lobbyTimer); this.lobbyTimer = null; }
  }

  // ------------------------------------------------------------------ input

  /**
   * The only thing a client may send. `angle` is a desired heading in radians;
   * the server still rate-limits how fast the snake can actually turn.
   */
  setInput(socketId, angle, boosting) {
    const p = this.players.get(socketId);
    if (!p || this.status !== 'running') return false;
    if (!this._takeToken(p)) return false;
    if (typeof angle !== 'number' || !Number.isFinite(angle)) return false;

    const s = this.snakes.get(p.snakeId);
    if (!s || !s.alive) return false;

    s.targetAngle = angle;
    s.boosting = Boolean(boosting) && s.score > C.BOOST_MIN_SCORE;
    return true;
  }

  _takeToken(p) {
    const now = Date.now();
    const elapsed = (now - p.lastRefill) / 1000;
    p.lastRefill = now;
    p.tokens = Math.min(C.INPUT_RATE_BURST, p.tokens + elapsed * C.INPUT_RATE_PER_SEC);
    if (p.tokens < 1) return false;
    p.tokens -= 1;
    return true;
  }

  // ------------------------------------------------------------------- tick

  tick() {
    if (this.status !== 'running') return;
    this.tickCount++;
    const dt = C.TICK_MS / 1000;

    this._rebuildHashes();

    // 1. Bots decide where to go.
    for (const bot of this.bots) bot.think(dt, {
      bodyHash: this.bodyHash,
      foodNear: (x, y, r) => this._foodNear(x, y, r),
      snakes: this.snakes.values(),
    });

    // 2. Move everything.
    for (const s of this.snakes.values()) {
      if (s.alive) this._moveSnake(s, dt);
    }

    // 3. Collisions, then eating.
    this._resolveCollisions();
    this._resolveEating();

    // 4. Keep the arena stocked and populated.
    this._topUpFood();
    this._topUpBots();

    // 5. Push each player their own slice of the world.
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      this._sendView(p, this.tickCount % C.SNAPSHOT_EVERY_TICKS === 0);
    }

    if (this.tickCount % C.LEADERBOARD_EVERY_TICKS === 0) {
      this.emit(this, 'leaderboard', this.leaderboard());
    }

    if (this.tickCount >= C.MAX_MATCH_TICKS) this.end();
  }

  _moveSnake(s, dt) {
    // Turn toward the requested heading, capped by the turn rate. Tight snakes
    // corner a little better than long ones.
    const turnCap = C.MAX_TURN_RATE * dt;
    const delta = normalizeAngle(s.targetAngle - s.angle);
    s.angle = normalizeAngle(s.angle + clamp(delta, -turnCap, turnCap));

    // Boost burns score and leaves a trail of pellets behind you.
    let speed = C.BASE_SPEED;
    if (s.boosting && s.score > C.BOOST_MIN_SCORE) {
      speed = C.BOOST_SPEED;
      s.score = Math.max(C.BOOST_MIN_SCORE, s.score - C.BOOST_DRAIN_PER_SEC * dt);
      s.boostTrail += speed * dt;
      if (s.boostTrail >= C.BOOST_TRAIL_EVERY) {
        s.boostTrail = 0;
        const tail = s.path[s.path.length - 1];
        if (tail) this._spawnFood({ x: tail.x, y: tail.y }, C.FOOD_VALUE);
      }
    } else {
      s.boosting = false;
    }

    s.x += Math.cos(s.angle) * speed * dt;
    s.y += Math.sin(s.angle) * speed * dt;

    // Record the path at fixed spacing so body length is independent of framerate.
    s.pathAccum += speed * dt;
    while (s.pathAccum >= C.SEGMENT_SPACING) {
      s.pathAccum -= C.SEGMENT_SPACING;
      s.path.unshift({ x: s.x, y: s.y });
    }
    const wanted = this._segmentCount(s.score);
    if (s.path.length > wanted) s.path.length = wanted;

    s.radius = this._radiusFor(s.score);
  }

  _resolveCollisions() {
    const dead = [];
    const now = Date.now();

    for (const s of this.snakes.values()) {
      if (!s.alive) continue;

      // The rim. Spawn protection does not cover it: nobody spawns near the
      // wall, so driving into it is a decision, not something that happened
      // to you while you were still getting your bearings.
      if (Math.hypot(s.x, s.y) > this.worldRadius) {
        dead.push({ snake: s, killer: null });
        continue;
      }

      // Fresh out of the gate: can't be killed by a body for SPAWN_SAFE_MS.
      if (now < s.safeUntil) continue;

      // Another snake's body. Your own body is harmless — that's the snake.io
      // rule, and it's what lets you coil around someone to trap them.
      const near = this.bodyHash.query(s.x, s.y, s.radius + 24);
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

    for (const { snake, killer } of dead) this._killSnake(snake, killer);
  }

  _resolveEating() {
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const reach = s.radius + C.EAT_REACH;
      const near = this.foodHash.query(s.x, s.y, reach);
      for (const f of near) {
        if (f.eaten) continue;
        const dx = f.x - s.x;
        const dy = f.y - s.y;
        const r = reach + f.radius;
        if (dx * dx + dy * dy < r * r) {
          f.eaten = true;
          this.food.delete(f.id);
          s.score += f.value;
          s.eatenIds.push(f.id);
        }
      }
    }
  }

  _killSnake(s, killer) {
    if (!s.alive) return;
    s.alive = false;
    s.diedAt = Date.now();

    if (killer && killer.id !== s.id) {
      killer.kills++;
      const kp = this._playerOfSnake(killer);
      if (kp) {
        kp.kills++;
        // Only a human wants to hear about it; bots have no socket anyway.
        if (kp.socketId) this.emitTo(kp.socketId, 'you_killed', { victim: s.name });
      }
    }

    // The body becomes food. This is the whole economy of the game: a big snake
    // dying is a feast, which is why hunting is worth the risk.
    const total = s.score * C.CORPSE_VALUE_RATIO;
    const wanted = Math.max(1, Math.floor((s.path.length * C.SEGMENT_SPACING) / C.CORPSE_SPACING));
    // `step` gets clamped to at least 1, so the number of pellets we actually
    // drop can exceed `wanted`. Divide the payout by the real count, or a
    // corpse ends up worth more than the snake ever was.
    const step = Math.max(1, Math.round(s.path.length / wanted));
    const drops = Math.ceil(s.path.length / step);
    const per = Math.max(C.FOOD_VALUE, total / drops);

    for (let i = 0; i < s.path.length; i += step) {
      const pt = s.path[i];
      this._spawnFood(
        { x: pt.x + (Math.random() - 0.5) * 10, y: pt.y + (Math.random() - 0.5) * 10 },
        per,
        true,
        s.colorIndex
      );
    }

    const owner = this._playerOfSnake(s);
    if (owner) {
      owner.bestScore = Math.max(owner.bestScore, Math.floor(s.score));
      this.emitTo(owner.socketId, 'you_died', {
        score: Math.floor(s.score),
        kills: owner.kills,
        killer: killer ? killer.name : null,
        rank: this._rankOf(s),
      });
    }
    s.path = [];
  }

  // ------------------------------------------------------------------ spawn

  _spawnSnake({ name, colorIndex, skinIndex, isBot, ownerSocket }) {
    const ci = normalizeColorIndex(colorIndex, 0);
    const si = normalizeSkinIndex(skinIndex);
    const pos = this._safeSpawnPoint();
    const angle = Math.atan2(-pos.y, -pos.x) + (Math.random() - 0.5) * 0.8;

    const snake = {
      id: nextSnakeId++,
      name,
      colorIndex: ci,
      color: C.COLORS[ci],
      skinIndex: si,
      isBot,
      ownerSocket: ownerSocket || null,
      x: pos.x,
      y: pos.y,
      angle,
      targetAngle: angle,
      boosting: false,
      boostTrail: 0,
      score: C.START_SCORE,
      radius: this._radiusFor(C.START_SCORE),
      alive: true,
      kills: 0,
      pathAccum: 0,
      path: [],
      eatenIds: [],
      diedAt: 0,
      /** Spawn protection runs out at this wall-clock time. */
      safeUntil: Date.now() + C.SPAWN_SAFE_MS,
    };

    // Lay the starting body out behind the head.
    const back = angle + Math.PI;
    for (let i = 0; i < this._segmentCount(C.START_SCORE); i++) {
      snake.path.push({
        x: pos.x + Math.cos(back) * i * C.SEGMENT_SPACING,
        y: pos.y + Math.sin(back) * i * C.SEGMENT_SPACING,
      });
    }

    this.snakes.set(snake.id, snake);
    return snake;
  }

  _topUpBots() {
    // Drop bots that have been dead a moment, then refill to target population.
    const now = Date.now();
    for (const [id, s] of this.snakes) {
      if (s.isBot && !s.alive && now - s.diedAt > C.BOT_RESPAWN_MS) {
        this.snakes.delete(id);
        this.bots = this.bots.filter((b) => b.snake.id !== id);
      }
    }

    const living = [...this.snakes.values()].filter((s) => s.alive).length;
    const want = Math.max(0, C.BOT_TARGET_POPULATION - living);
    for (let i = 0; i < want; i++) {
      const name = C.BOT_NAMES[Math.floor(Math.random() * C.BOT_NAMES.length)];
      const ci = Math.floor(Math.random() * C.COLORS.length);
      // Bots wear the whole catalogue, so the arena shows off every skin.
      const si = Math.floor(Math.random() * SKINS.length);
      const snake = this._spawnSnake({ name, colorIndex: ci, skinIndex: si, isBot: true });
      snake.score = C.START_SCORE + Math.random() * 60;
      this.bots.push(new Bot(snake));
    }
  }

  /**
   * @param {number} [colorIndex] pellets from a corpse keep the dead snake's
   *   colour, which makes a kill site read at a glance. Loose food is random.
   */
  _spawnFood(pos, value, big = false, colorIndex) {
    const f = {
      id: this.nextFoodId++,
      x: pos.x,
      y: pos.y,
      value,
      radius: big ? C.BIG_FOOD_RADIUS : C.FOOD_RADIUS,
      ci: colorIndex === undefined
        ? Math.floor(Math.random() * C.COLORS.length)
        : normalizeColorIndex(colorIndex, 0),
      eaten: false,
    };
    this.food.set(f.id, f);
    return f;
  }

  _topUpFood() {
    let deficit = C.FOOD_COUNT - this.food.size;
    // Trickle rather than dumping hundreds at once.
    deficit = Math.min(deficit, 12);
    for (let i = 0; i < deficit; i++) this._spawnFood(this._randomPoint(), C.FOOD_VALUE);
  }

  _randomPoint() {
    const a = Math.random() * TAU;
    const r = Math.sqrt(Math.random()) * (this.worldRadius - 40);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  /** A point with no snake body nearby, so you don't spawn inside someone. */
  _safeSpawnPoint() {
    // The hash is otherwise only as current as the last tick — and `start()`
    // spawns every player and bot before any tick has run, against whatever
    // the previous round left behind. Without this the whole lobby can be
    // placed on top of itself and die in the first second.
    this._rebuildBodyHash();
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = this._randomPoint();
      const near = this.bodyHash.query(p.x, p.y, 130);
      if (near.length === 0) return p;
    }
    return this._randomPoint();
  }

  // ------------------------------------------------------------ networking

  /**
   * Send one player only what they can see.
   *
   * A full arena is ~15 snakes and 550 pellets; sending all of it 20x a second
   * would be about 100KB/s per player. Instead each client gets the snakes and
   * food inside its viewport, full bodies only the first time a snake appears,
   * and head-only updates after that.
   */
  _sendView(player, forceFull) {
    const now = Date.now();
    const me = this.snakes.get(player.snakeId);
    // A dead player keeps watching from where they fell.
    const cx = me ? me.x : 0;
    const cy = me ? me.y : 0;
    const halfW = C.VIEW_WIDTH / 2 + C.VIEW_MARGIN;
    const halfH = C.VIEW_HEIGHT / 2 + C.VIEW_MARGIN;

    const enter = [];
    const move = [];
    const visible = new Set();

    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      if (!this._boxNear(s, cx, cy, halfW, halfH)) continue;
      visible.add(s.id);

      const isNew = forceFull || !player.known.has(s.id);
      if (isNew) {
        player.known.add(s.id);
        enter.push({
          id: s.id,
          n: s.name,
          ci: s.colorIndex,
          si: s.skinIndex,
          b: s.isBot ? 1 : 0,
          me: s.id === player.snakeId ? 1 : 0,
          p: s.path.map((pt) => [r1(pt.x), r1(pt.y)]),
          x: r1(s.x),
          y: r1(s.y),
          a: r3(s.angle),
          r: r1(s.radius),
          s: Math.floor(s.score),
          iv: now < s.safeUntil ? 1 : 0,
        });
      } else {
        move.push([
          s.id,
          r1(s.x),
          r1(s.y),
          r3(s.angle),
          r1(s.radius),
          Math.floor(s.score),
          s.boosting ? 1 : 0,
          now < s.safeUntil ? 1 : 0,
        ]);
      }
    }

    // Anything we told them about that's now out of view or dead.
    const leave = [];
    for (const id of player.known) {
      if (!visible.has(id)) {
        leave.push(id);
        player.known.delete(id);
      }
    }

    // Food barely changes between ticks, and there can be ~70 pellets on
    // screen. Sending the whole list 20x a second would dominate the payload,
    // so each client is told only what appeared and what went away.
    if (forceFull) player.knownFood.clear();
    const foodAdd = [];
    const visibleFood = new Set();
    for (const f of this.food.values()) {
      if (Math.abs(f.x - cx) > halfW || Math.abs(f.y - cy) > halfH) continue;
      visibleFood.add(f.id);
      if (!player.knownFood.has(f.id)) {
        player.knownFood.add(f.id);
        foodAdd.push([f.id, r1(f.x), r1(f.y), f.radius, f.value, f.ci]);
      }
    }
    const foodDel = [];
    for (const id of player.knownFood) {
      if (!visibleFood.has(id)) {
        foodDel.push(id);
        player.knownFood.delete(id);
      }
    }

    this.emitTo(player.socketId, 'view', {
      t: this.tickCount,
      me: player.snakeId,
      alive: me ? (me.alive ? 1 : 0) : 0,
      enter,
      move,
      leave,
      fa: foodAdd,
      fd: foodDel,
      full: forceFull ? 1 : 0,
    });
  }

  _boxNear(s, cx, cy, halfW, halfH) {
    // A long snake can be on screen even when its head isn't, so test the head
    // generously and let the client clip the rest.
    if (Math.abs(s.x - cx) < halfW && Math.abs(s.y - cy) < halfH) return true;
    for (let i = 0; i < s.path.length; i += 8) {
      const pt = s.path[i];
      if (Math.abs(pt.x - cx) < halfW && Math.abs(pt.y - cy) < halfH) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ state

  meta() {
    return {
      code: this.code,
      colors: C.COLORS,
      skins: SKINS,
      worldRadius: this.worldRadius,
      tickMs: C.TICK_MS,
      borderWarn: C.BORDER_WARN,
      viewWidth: C.VIEW_WIDTH,
      viewHeight: C.VIEW_HEIGHT,
      segmentSpacing: C.SEGMENT_SPACING,
      baseSpeed: C.BASE_SPEED,
      boostSpeed: C.BOOST_SPEED,
      maxTurnRate: C.MAX_TURN_RATE,
      boostMinScore: C.BOOST_MIN_SCORE,
    };
  }

  leaderboard() {
    const all = [...this.snakes.values()]
      .filter((s) => s.alive)
      .sort((a, b) => b.score - a.score);

    return {
      top: all.slice(0, 10).map((s, i) => ({
        rank: i + 1,
        id: s.id,
        name: s.name,
        score: Math.floor(s.score),
        bot: s.isBot ? 1 : 0,
      })),
      total: all.length,
      // Time left in the round. Sent on every leaderboard tick (2Hz) rather
      // than once at game_start, so the client's clock can never drift out of
      // agreement with the server about when the round ends.
      msLeft: Math.max(0, (C.MAX_MATCH_TICKS - this.tickCount) * C.TICK_MS),
      // Each human's own rank, so a player outside the top 10 still sees theirs.
      you: [...this.players.values()].map((p) => {
        const idx = all.findIndex((s) => s.id === p.snakeId);
        const snake = this.snakes.get(p.snakeId);
        return {
          socketId: p.socketId,
          rank: idx === -1 ? null : idx + 1,
          score: snake ? Math.floor(snake.score) : 0,
          alive: snake ? snake.alive : false,
        };
      }),
    };
  }

  lobbyState() {
    return {
      code: this.code,
      status: this.status,
      hostClientId: this.hostClientId,
      maxPlayers: C.MAX_PLAYERS,
      players: [...this.players.values()]
        .sort((a, b) => a.index - b.index)
        .map((p) => ({
          index: p.index,
          clientId: p.clientId,
          username: p.username,
          color: p.color,
          colorIndex: p.colorIndex,
          skinIndex: p.skinIndex,
          connected: p.connected,
          isHost: p.clientId === this.hostClientId,
        })),
    };
  }

  end() {
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.stop();

    const results = [...this.players.values()]
      .map((p) => {
        const s = this.snakes.get(p.snakeId);
        const score = s && s.alive ? Math.floor(s.score) : p.bestScore;
        return {
          index: p.index,
          clientId: p.clientId,
          userId: p.userId,
          username: p.username,
          score,
          kills: p.kills,
          survived: Boolean(s && s.alive),
        };
      })
      .sort((a, b) => b.score - a.score);

    results.forEach((r, i) => { r.placement = i + 1; });

    const payload = {
      roomCode: this.code,
      durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
      winner: results[0] || null,
      results,
    };
    this.emit(this, 'game_over', payload);
    return payload;
  }

  resetToLobby() {
    if (this.status === 'running') return false;
    this.status = 'lobby';
    this.tickCount = 0;
    this.snakes.clear();
    this.food.clear();
    this.bots = [];
    for (const p of this.players.values()) {
      p.snakeId = null;
      p.bestScore = 0;
      p.kills = 0;
      p.known = new Set();
      p.knownFood = new Set();
    }
    this._armLobbyReaper();
    this.emit(this, 'lobby_state', this.lobbyState());
    return true;
  }

  // ---------------------------------------------------------------- helpers

  _rebuildBodyHash() {
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

  _rebuildHashes() {
    this._rebuildBodyHash();
    this.foodHash.clear();
    for (const f of this.food.values()) this.foodHash.insert(f.x, f.y, f);
  }

  _foodNear(x, y, radius) {
    const near = this.foodHash.query(x, y, radius);
    let best = null;
    let bestD = Infinity;
    for (const f of near) {
      if (f.eaten) continue;
      const d = (f.x - x) ** 2 + (f.y - y) ** 2;
      // Prefer bigger pellets when they're comparably close.
      const weighted = d / (1 + f.value * 0.4);
      if (weighted < bestD) {
        bestD = weighted;
        best = f;
      }
    }
    return best;
  }

  _segmentCount(score) {
    return Math.floor(C.SEGMENTS_BASE + score * C.SEGMENTS_PER_SCORE);
  }

  _radiusFor(score) {
    return Math.min(C.MAX_RADIUS, C.BASE_RADIUS + Math.sqrt(Math.max(0, score)) * C.RADIUS_GROWTH);
  }

  _playerOfSnake(s) {
    if (!s.ownerSocket) return null;
    return this.players.get(s.ownerSocket) || null;
  }

  _rankOf(snake) {
    const all = [...this.snakes.values()]
      .filter((s) => s.alive || s.id === snake.id)
      .sort((a, b) => b.score - a.score);
    return all.findIndex((s) => s.id === snake.id) + 1;
  }

  _claimSlot() {
    for (let i = 0; i < C.MAX_PLAYERS; i++) {
      if (!this.usedSlots.has(i)) {
        this.usedSlots.add(i);
        return i;
      }
    }
    return -1;
  }

  /** Respawn a dead human where they ask to try again. */
  respawn(socketId) {
    const p = this.players.get(socketId);
    if (!p || this.status !== 'running') return false;
    const old = this.snakes.get(p.snakeId);
    if (old && old.alive) return false;
    if (old) this.snakes.delete(old.id);

    const snake = this._spawnSnake({
      name: p.username,
      colorIndex: p.colorIndex,
      skinIndex: p.skinIndex,
      isBot: false,
      ownerSocket: p.socketId,
    });
    p.snakeId = snake.id;
    p.known = new Set();
    p.knownFood = new Set();
    return true;
  }
}

/** Clamp an untrusted colour choice to a real palette slot. */
function normalizeColorIndex(ci, fallback) {
  if (!Number.isInteger(ci) || ci < 0 || ci >= C.COLORS.length) {
    return fallback % C.COLORS.length;
  }
  return ci;
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

module.exports = GameRoom;
module.exports.normalizeAngle = normalizeAngle;
module.exports.normalizeColorIndex = normalizeColorIndex;
