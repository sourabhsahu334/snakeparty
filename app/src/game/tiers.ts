import type { Skin } from './protocol';

/**
 * Tiers: the badge a skin wears in the picker.
 *
 * The reference art marks every card in the corner — a flame on the legendary
 * ones, a paw on the animals, a vehicle on the machines, a plain S on the
 * starters — so a player can tell at a glance what kind of thing they are
 * looking at without reading a single name. This is that, keyed off the skin's
 * `group` so there is nothing extra to keep in sync: one skin, one group, one
 * badge.
 *
 * Presentation only. Nothing in the simulation reads a tier, and a skin with no
 * group (an older server, sending an older catalogue) falls back to the starter
 * tier rather than rendering a hole in the card.
 */

export type Tier = {
  key: string;
  /** Rail and pill label. */
  label: string;
  /** The corner mark. One glyph — it is drawn at about 11px. */
  glyph: string;
  /** Badge fill, also used for the card's selected border. */
  color: string;
  /** Ink that stays readable on `color`. */
  ink: string;
};

export const TIERS: Record<string, Tier> = {
  basics: { key: 'basics', label: 'Starter', glyph: 'S', color: '#8FB8C9', ink: '#0E2B38' },
  animals: { key: 'animals', label: 'Animals', glyph: '🐾', color: '#7ED321', ink: '#12330A' },
  beasts: { key: 'beasts', label: 'Legendary', glyph: '🔥', color: '#FF7A18', ink: '#3B1600' },
  warriors: { key: 'warriors', label: 'Warriors', glyph: '⚔', color: '#8A6BE0', ink: '#1E0F45' },
  machines: { key: 'machines', label: 'Machines', glyph: '⚙', color: '#3FA9F5', ink: '#04263F' },
};

/** Every tier, in the order the rail lists them. */
export const TIER_ORDER = ['basics', 'animals', 'beasts', 'warriors', 'machines'];

export function tierOf(skin: Skin | undefined): Tier {
  return TIERS[skin?.group ?? 'basics'] ?? TIERS.basics;
}
