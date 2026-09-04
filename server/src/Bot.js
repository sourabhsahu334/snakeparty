'use strict';

const C = require('./config');

const TAU = Math.PI * 2;

/**
 * Bot steering.
 *
 * Deliberately simple and cheap — it runs for every bot every tick. The goal is
 * an arena that feels alive, not an opponent that outplays you: bots chase
 * nearby food, swerve away from bodies they're about to hit, and turn back when
 * they drift toward the rim.
 */
class Bot {
  constructor(snake) {
    this.snake = snake;
    this.wanderAngle = Math.random() * TAU;
    this.retargetIn = 0;
    this.target = null;
    this.boostUntil = 0;
  }

  /**
   * @param {number} dt seconds
   * @param {{foodNear: Function, bodyHash: object, snakes: Iterable}} world
   */
  think(dt, world) {
    const s = this.snake;
    if (!s.alive) return;

    const now = Date.now();
    this.retargetIn -= dt;

    // ---- 1. Steer away from the rim before it kills us -------------------
    const distFromCenter = Math.hypot(s.x, s.y);
    if (distFromCenter > C.WORLD_RADIUS - 220) {
      const inward = Math.atan2(-s.y, -s.x);
      s.targetAngle = inward;
      s.boosting = false;
      return;
    }

    // ---- 2. Dodge any body we're about to run into -----------------------
    const look = s.radius + 46;
    const aheadX = s.x + Math.cos(s.angle) * look;
    const aheadY = s.y + Math.sin(s.angle) * look;
    const threats = world.bodyHash.query(aheadX, aheadY, look);

    let dodge = 0;
    for (const t of threats) {
      if (t.id === s.id) continue;
      const dx = t.x - aheadX;
      const dy = t.y - aheadY;
      const d2 = dx * dx + dy * dy;
      if (d2 > look * look) continue;
      // Turn away from whichever side the obstacle sits on.
      const rel = normalize(Math.atan2(t.y - s.y, t.x - s.x) - s.angle);
      dodge += rel > 0 ? -1 : 1;
    }

    if (dodge !== 0) {
      s.targetAngle = s.angle + (dodge > 0 ? 1.1 : -1.1);
      s.boosting = false;
      this.target = null;
      return;
    }

    // ---- 3. Otherwise go eat something -----------------------------------
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
      const pull = Math.min(1, distFromCenter / C.WORLD_RADIUS);
      s.targetAngle = lerpAngle(this.wanderAngle, inward, pull * 0.6);
    }

    // ---- 4. Occasional sprint, so bots aren't all the same speed ---------
    if (now > this.boostUntil && s.score > 45 && Math.random() < 0.004) {
      this.boostUntil = now + 700 + Math.random() * 900;
    }
    s.boosting = now < this.boostUntil && s.score > C.BOOST_MIN_SCORE;
  }
}

function normalize(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function lerpAngle(a, b, t) {
  return a + normalize(b - a) * t;
}

module.exports = Bot;
module.exports.normalizeAngle = normalize;
