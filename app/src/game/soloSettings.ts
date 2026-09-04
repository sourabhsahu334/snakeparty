/**
 * What a solo run is allowed to change.
 *
 * These only exist offline. Multiplayer is server-authoritative — the arena
 * belongs to everyone in it, so a client cannot be trusted to say how fast
 * snakes move. Solo has no such problem: it *is* the authority.
 */
export type SoloSettings = {
  /** Multiplier on how fast everything moves. 1 is the multiplayer pace. */
  speed: number;
  /** Total snakes the arena maintains, you included. 1 is an empty arena. */
  population: number;
  /** World radius, in world units. */
  arena: number;
  /** Pellets kept on the ground. */
  food: number;
};

export const DEFAULT_SOLO_SETTINGS: SoloSettings = {
  speed: 1,
  population: 10,
  arena: 1100,
  food: 300,
};

export type Choice = { label: string; value: number };

/**
 * Every option is a short list of named steps rather than a slider.
 *
 * Partly taste — "Fast" is a decision and 1.37x is not — and partly that a
 * slider would mean a new native dependency for one screen, while chips are
 * plain Pressables that are easier to hit with a thumb.
 */
export const SPEED_CHOICES: Choice[] = [
  { label: 'Chill', value: 0.7 },
  { label: 'Normal', value: 1 },
  { label: 'Fast', value: 1.4 },
  { label: 'Insane', value: 2 },
];

export const POPULATION_CHOICES: Choice[] = [
  { label: 'Just you', value: 1 },
  { label: 'Quiet', value: 5 },
  { label: 'Normal', value: 10 },
  { label: 'Swarm', value: 16 },
];

export const ARENA_CHOICES: Choice[] = [
  { label: 'Tight', value: 700 },
  { label: 'Normal', value: 1100 },
  { label: 'Wide', value: 1700 },
];

export const FOOD_CHOICES: Choice[] = [
  { label: 'Sparse', value: 140 },
  { label: 'Normal', value: 300 },
  { label: 'Feast', value: 550 },
];

/**
 * The numbers the arena actually runs on.
 *
 * Turn rate scales with speed, and that is the whole trick: turn *radius* is
 * speed / turn rate, so doubling the speed alone would double the radius and
 * the snake would handle like a bus. Scaling both together means "Insane" is
 * genuinely the same game played faster, not a different, worse one.
 */
export function derive(s: SoloSettings, base: { speed: number; boost: number; turn: number }) {
  return {
    baseSpeed: base.speed * s.speed,
    boostSpeed: base.boost * s.speed,
    maxTurnRate: base.turn * s.speed,
    worldRadius: s.arena,
    foodCount: s.food,
    population: s.population,
  };
}

/** Pull a stored settings blob back into range; anything odd falls back. */
export function clampSettings(raw: Partial<SoloSettings> | null | undefined): SoloSettings {
  const pick = (v: unknown, choices: Choice[], fallback: number) =>
    choices.some((c) => c.value === v) ? (v as number) : fallback;

  return {
    speed: pick(raw?.speed, SPEED_CHOICES, DEFAULT_SOLO_SETTINGS.speed),
    population: pick(raw?.population, POPULATION_CHOICES, DEFAULT_SOLO_SETTINGS.population),
    arena: pick(raw?.arena, ARENA_CHOICES, DEFAULT_SOLO_SETTINGS.arena),
    food: pick(raw?.food, FOOD_CHOICES, DEFAULT_SOLO_SETTINGS.food),
  };
}

/** One line summarising a configuration, for the button that opens the sheet. */
export function describe(s: SoloSettings): string {
  const name = (v: number, choices: Choice[]) =>
    choices.find((c) => c.value === v)?.label ?? String(v);
  return `${name(s.speed, SPEED_CHOICES)} · ${name(s.population, POPULATION_CHOICES)} · ${name(
    s.arena,
    ARENA_CHOICES
  )} arena`;
}
