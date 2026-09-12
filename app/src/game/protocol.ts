/**
 * Wire protocol for the continuous arena (server/src/GameRoom.js).
 *
 * The server sends each client only what is inside its viewport. A snake's full
 * body arrives once, when it enters view (`enter`); after that only its head
 * moves (`move`), and the client extends the body itself.
 */

export type Vec = { x: number; y: number };

/** Fixed arena parameters, sent once at game_start. */
/** A procedurally-drawn snake skin. The server owns this catalogue. */
export type Skin = {
  id: string;
  /** Which rail the picker files it under. Cosmetic; the sim ignores it. */
  group?: 'basics' | 'animals' | 'beasts' | 'warriors' | 'machines';
  name: string;
  desc: string;
  mode: 'bands' | 'gradient';
  /** null on 'classic', which wears the player's chosen colour instead. */
  pattern: string[] | null;
  ears?: { shape: 'round' | 'pointed' | 'long'; color: string; inner?: string };
  /**
   * One head ornament. 'horns' | 'plume' | 'topknot' | 'frill' | 'hat' sit
   * behind the head; 'beak' | 'snout' | 'visor' in front of it. `accent` is
   * the trim — a hat's pom, a visor's lens.
   */
  crown?: {
    shape:
      | 'horns'
      | 'plume'
      | 'topknot'
      | 'frill'
      | 'hat'
      | 'beak'
      | 'snout'
      | 'visor'
      | 'tiara';
    color: string;
    accent?: string;
  };
  belly?: string;
  /**
   * 'big' and 'slit' are the cartoon eyes every bead skin wears. 'gem' is the
   * other kind: a dark almond rimmed in metal with a cut pupil and lashes,
   * for the skins drawn as real animals rather than as characters.
   */
  eyes?: 'big' | 'slit' | 'gem';
  /**
   * The sclera behind the pupil. White unless a skin says otherwise — a real
   * viper's eye is the one part of it that is not green, and a white one reads
   * as a cartoon however good the scales are. 'gem' ignores this and draws its
   * own dark stone.
   */
  eyeColor?: string;
  /** A flower on the side of the head. Drawn with the face, not the body. */
  bloom?: { color: string; center?: string };
  /**
   * Overlapping scutes drawn over the body, for anything reptilian.
   *
   * Orthogonal to `mode` on purpose: a dragon wants banded *and* scaled, so
   * this is an overlay rather than a third pattern mode. `tint` overrides the
   * automatic highlight, which is otherwise the bead colour lightened.
   */
  scales?: {
    tint?: string;
    /**
     * 'scute' (the default) is a soft crescent per bead. 'dragon' lays pointed
     * scales in staggered rows, like a pinecone. 'serpent' lays big rounded
     * petals in two layers, each with a lighter core, for the ornamental
     * look — pair it with `serpent` below, which gives it a head to match.
     */
    style?: 'scute' | 'dragon' | 'serpent';
  };
  /**
   * Flame tongues licking up the body toward the head, for anything that is
   * on fire. Like `scales` this is an overlay on top of whatever the pattern
   * painted, and the two are mutually exclusive in practice — a body is either
   * scaled or burning. The tongues replace the beads rather than sitting on
   * top of them, and each takes its bead's colour; `tint` overrides that with
   * one flat colour, `core` is the brighter heart inside each tongue.
   */
  flames?: { tint?: string; core?: string };
  /**
   * Draw the body as one smooth tube rather than a chain of beads: a stroke
   * down the path instead of a disc per segment, so the silhouette has no
   * scallops and no seams. `texture`, if set, stipples it with scales barely a
   * shade darker than the skin — the thing you notice only up close.
   */
  smooth?: { texture?: boolean };
  /**
   * The ornamental serpent head: a broad shield skull with a ridge of plates
   * down the snout, mirrored gold linework swept back along brow and jaw, and
   * big slit eyes.
   *
   * Its own block rather than another `eyes` or `crown` value because it
   * replaces the whole face — skull shape, plating and markings together — and
   * because those three colours only mean anything in combination. Pair it
   * with `scales: { style: 'serpent' }` so the body's plating matches the
   * head's; on its own the head reads as belonging to a different snake.
   */
  /**
   * Name of a painted head sprite to use instead of drawing one.
   *
   * A name, not a path: the catalogue comes from the server, which cannot know
   * what art this build bundles. Art we do not have falls back to the
   * procedural head. A sprite cannot be tinted, so a skin using one wants a
   * body pattern picked to match the artwork.
   */
  headArt?: string;
  serpent?: {
    /** The linework swept back along the brow and jaw. */
    marks: string;
    /** The ridge of plates down the centre of the skull. */
    ridge: string;
    /** The dark edge the whole head is drawn against. */
    outline: string;
  };
};

export type GameMeta = {
  code: string;
  /** The shared palette. Everything else refers to colours by index into this. */
  colors: string[];
  /** The skin catalogue, sent once so snakes can refer to skins by index. */
  skins: Skin[];
  worldRadius: number;
  tickMs: number;
  borderWarn: number;
  viewWidth: number;
  viewHeight: number;
  segmentSpacing: number;
  baseSpeed: number;
  boostSpeed: number;
  maxTurnRate: number;
  boostMinScore: number;
};

/** A snake appearing in view for the first time — carries its whole body. */
export type SnakeEnter = {
  id: number;
  n: string;      // name
  ci: number;     // palette index
  si: number;     // skin index
  b: 0 | 1;       // is a bot
  me: 0 | 1;      // is you
  p: [number, number][]; // body path, head first
  x: number;
  y: number;
  a: number;      // heading, radians
  r: number;      // radius
  s: number;      // score
  /**
   * Spawn protection: this snake can neither kill nor be killed by a body
   * right now. Optional so a client stays compatible with an older server
   * that doesn't send it — absent means "not protected".
   */
  iv?: 0 | 1;
};

/**
 * Head-only update: [id, x, y, angle, radius, score, boosting, invulnerable]
 *
 * The last slot is optional for the same reason `SnakeEnter.iv` is.
 */
export type SnakeMove = [
  number,
  number,
  number,
  number,
  number,
  number,
  0 | 1,
  (0 | 1)?,
];

/** Food pellet: [id, x, y, radius, value, colourIndex] */
export type FoodWire = [number, number, number, number, number, number];

export type ViewUpdate = {
  t: number;
  me: number | null;
  alive: 0 | 1;
  enter: SnakeEnter[];
  move: SnakeMove[];
  leave: number[];
  /** Food that just came into view. */
  fa: FoodWire[];
  /** Ids of food that went out of view or was eaten. */
  fd: number[];
  full: 0 | 1;
};

export type LeaderboardRow = {
  rank: number;
  id: number;
  name: string;
  score: number;
  bot: 0 | 1;
};

export type Leaderboard = {
  top: LeaderboardRow[];
  total: number;
  /** Milliseconds left in the round. Absent in solo, which is an endless run. */
  msLeft?: number;
  you: Array<{ socketId: string; rank: number | null; score: number; alive: boolean }>;
};

export type DeathInfo = {
  score: number;
  kills: number;
  killer: string | null;
  rank: number;
};

export type LobbyPlayer = {
  index: number;
  clientId: string;
  username: string;
  color: string;
  colorIndex: number;
  skinIndex: number;
  connected: boolean;
  isHost: boolean;
};

export type LobbyState = {
  code: string;
  status: 'lobby' | 'running' | 'finished';
  hostClientId: string;
  maxPlayers: number;
  players: LobbyPlayer[];
};

export type MatchResult = {
  index: number;
  clientId: string;
  userId: string | null;
  username: string;
  score: number;
  kills: number;
  placement: number;
  survived: boolean;
};

export type GameOver = {
  roomCode: string;
  durationMs: number;
  winner: MatchResult | null;
  results: MatchResult[];
};

export type JoinAck =
  | {
      ok: true;
      code: string;
      you: {
        index: number;
        clientId: string;
        username: string;
        color: string;
        colorIndex: number;
        skinIndex: number;
      };
      lobby: LobbyState;
      status?: LobbyState['status'];
      meta?: GameMeta | null;
    }
  | { ok: false; error: string };

export const TAU = Math.PI * 2;

/** Wrap an angle into (-PI, PI] — the short way round. */
export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + normalizeAngle(to - from) * t;
}

/** Today's free room allowance, as the server reports it. */
export type Credits = {
  remaining: number;
  perDay: number;
  /** ISO instant of the next reset. Absent on a successful create. */
  resetsAt?: string;
};

/**
 * "4h 12m" until the daily rooms come back.
 *
 * Rounded up, so a player is never told "0 min" while still being refused —
 * and capped at hours because the reset is at most a day away.
 */
export function timeUntil(iso?: string): string {
  if (!iso) return 'a few hours';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 'a few hours';
  if (ms <= 0) return 'a moment';
  const mins = Math.ceil(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * What to tell a player who has run out of rooms.
 *
 * Deliberately says they can still join: the limit is on hosting, and someone
 * who reads this as "I cannot play until tomorrow" has been told the wrong
 * thing.
 */
export function noCreditsText(credits?: Credits): string {
  const perDay = credits?.perDay ?? 2;
  return (
    `You've used today's ${perDay} free rooms. ` +
    `They refill in ${timeUntil(credits?.resetsAt)} — ` +
    'you can still join a friend\'s room for free.'
  );
}

export const ERROR_TEXT: Record<string, string> = {
  NO_ROOM_CREDITS: "You've used today's free rooms. You can still join a friend's room.",
  ROOM_NOT_FOUND: "That code doesn't match any room.",
  ROOM_FULL: 'That room is already full.',
  ROOM_IN_PROGRESS: 'That game has already started.',
  ALREADY_IN_ROOM: "You're already in a room.",
  NOT_HOST: 'Only the host can do that.',
  NOT_IN_ROOM: 'You left the room.',
  NOT_ENOUGH_PLAYERS: 'You need at least one player.',
  NO_SEAT_HELD: 'Your seat in that room is gone.',
  CANNOT_START: "The game couldn't start.",
  OFFLINE: "You're not connected to the server.",
  TIMEOUT: 'The server took too long to answer.',
};

export const errorText = (code?: string) =>
  (code && ERROR_TEXT[code]) || 'Something went wrong. Try again.';
