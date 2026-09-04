'use strict';

/**
 * Snake.io-style continuous arena.
 *
 * Everything here is in world units (floats), not grid cells. The client is
 * told the ones it needs in `game_start` so it never hardcodes a copy.
 */
module.exports = {
  TICK_MS: 50,                    // 20Hz authoritative loop
  MAX_PLAYERS: 5,                 // human seats in a private room
  MIN_PLAYERS: 1,

  // ---------------------------------------------------------------- world
  // Sized against how much of the world a phone actually shows. In landscape a
  // client sees roughly 760x340 units; at radius 1800 you'd see another snake
  // about a fifth of the time, which felt empty. This is the main knob if the
  // arena feels too crowded or too lonely.
  WORLD_RADIUS: 1100,             // circular arena; touching the rim kills you
  BORDER_WARN: 250,               // start showing the red edge this far in

  // -------------------------------------------------------------- movement
  // Tuned against the client's zoom (VIEW_ACROSS): apparent speed is
  // BASE_SPEED / VIEW_ACROSS screens per second. ~0.38 feels like snake.io;
  // much below 0.25 and the game feels like it's wading.
  BASE_SPEED: 215,                // units/sec
  BOOST_SPEED: 410,
  MAX_TURN_RATE: 5.4,             // radians/sec — turn radius ≈ speed/this
  SEGMENT_SPACING: 9,             // distance between stored body points

  // ----------------------------------------------------------------- size
  START_SCORE: 10,
  BASE_RADIUS: 9,
  RADIUS_GROWTH: 0.32,            // radius = BASE + sqrt(score) * this
  MAX_RADIUS: 34,
  SEGMENTS_BASE: 12,              // body points at score 0
  SEGMENTS_PER_SCORE: 0.42,       // extra body points per point of score

  // ------------------------------------------------------------ spawn safety
  // Grace period after entering the arena — see GameRoom._resolveCollisions.
  // A fresh snake is placed in a clear spot, but the arena moves: a boosting
  // bot can be across that clearance before the player's thumb finds the
  // joystick. For this long a new snake neither dies to a body nor kills with
  // its own, and the client draws it faded so both sides can see why.
  SPAWN_SAFE_MS: 4000,

  // ----------------------------------------------------------------- boost
  BOOST_MIN_SCORE: 15,            // can't boost below this
  BOOST_DRAIN_PER_SEC: 11,        // score burned while boosting
  BOOST_TRAIL_EVERY: 22,          // drop a pellet every N units while boosting

  // ------------------------------------------------------------------ food
  FOOD_COUNT: 420,                // pellets kept alive in the arena
  FOOD_VALUE: 1,
  FOOD_RADIUS: 5,
  BIG_FOOD_VALUE: 5,              // pellets dropped by a dead snake
  BIG_FOOD_RADIUS: 8,
  EAT_REACH: 14,                  // extra pickup range beyond your radius
  CORPSE_VALUE_RATIO: 0.65,       // fraction of a dead snake's score returned
  CORPSE_SPACING: 14,             // distance between corpse pellets

  // ------------------------------------------------------------------ bots
  // Every extra snake is another stroked body per frame on the client. 10 keeps
  // the arena feeling busy while leaving budget-GPU phones some headroom.
  BOT_TARGET_POPULATION: 10,      // total snakes the room tries to maintain
                                  // (humans + bots, not bots alone) — 5 human
                                  // seats plus 5 bots in a full room.
  BOT_NAMES: [
    'Viper', 'Noodle', 'Slinky', 'Fang', 'Coil', 'Zigzag', 'Mamba', 'Hiss',
    'Twist', 'Rattle', 'Python', 'Wriggle', 'Slither', 'Scales', 'Venom',
    'Loop', 'Squiggle', 'Cobra', 'Ribbon', 'Serpent',
  ],
  BOT_RESPAWN_MS: 3000,

  // -------------------------------------------------------------- networking
  // Culling box, landscape-shaped to match the client. This only has to be
  // comfortably larger than the slice the client actually draws.
  VIEW_WIDTH: 900,
  VIEW_HEIGHT: 520,
  VIEW_MARGIN: 150,               // send a bit beyond the screen edge
  SNAPSHOT_EVERY_TICKS: 60,       // resync safety net (3s)
  LEADERBOARD_EVERY_TICKS: 10,    // 2Hz is plenty for a scoreboard
  MAX_MATCH_TICKS: 20 * 60 * 5,   // 5 minute hard cap — short rounds on purpose

  RECONNECT_GRACE_MS: 15000,

  // A room that is created but never started is only ever freed when its last
  // player leaves. A backgrounded phone usually drops the socket within
  // pingTimeout and cleans itself up, but a client that stays connected and
  // idle would otherwise hold the room forever. Generous on purpose: a host
  // waiting on a friend to type in the code must not have the room yanked.
  LOBBY_MAX_MS: 30 * 60 * 1000,   // 30 minutes in lobby, then reap

  // Rate limit on steering input.
  INPUT_RATE_BURST: 40,
  INPUT_RATE_PER_SEC: 45,

  // Bright, saturated, snake.io-style. This doubles as the skin picker's
  // palette and as the food palette — clients are sent it once at game_start
  // and refer to colours by index after that, which keeps the wire small.
  COLORS: [
    '#FF9E2C', '#FF4FA3', '#7ED321', '#3FA9F5', '#B06AB3',
    '#FF5E5B', '#FFD93D', '#2EC4B6', '#33383D', '#F26430',
    '#9BE564', '#41EAD4', '#F582AE', '#8AC926', '#1982C4',
    '#FF7B00', '#E63946', '#06D6A0', '#7B2CBF', '#FFC300',
  ],
};
