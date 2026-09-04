'use strict';

/**
 * Skin catalogue.
 *
 * Everything here is drawn procedurally by the client — no image assets — so a
 * skin is described as a colour pattern plus optional head decoration. The full
 * table is sent to clients once in `game_start`; after that a snake refers to
 * its skin by index.
 *
 * group: which rail the picker files it under — 'basics' | 'animals' |
 *       'beasts' | 'warriors' | 'machines'. Cosmetic only; nothing in the
 *       simulation reads it.
 *
 * mode:
 *   'bands'    repeat `pattern` along the body, `band` beads per colour
 *   'gradient' blend across `pattern` from head to tail
 *
 * ears: drawn on the head. 'round' = panda/mouse, 'pointed' = cat/fox,
 *       'long' = rabbit.
 *
 * scales: draws overlapping scutes over the body. Orthogonal to `mode`, so a
 *       skin can be banded *and* scaled. `tint` overrides the automatic
 *       highlight, which is otherwise the body colour lightened. `style:
 *       'dragon'` swaps the one-crescent-per-bead default for pointed scales
 *       laid in staggered rows — armour rather than a sheen. `style:
 *       'serpent'` lays big rounded petals in two layers, each with a lighter
 *       core, for the ornamental look — pair it with `serpent` below.
 *
 * headArt: name of a painted head sprite to blit instead of drawing one. A
 *       name rather than a path, because the app resolves it against whatever
 *       art it bundles — art it does not have falls back to the procedural
 *       head. Worth it only for a head that is a piece of artwork rather than
 *       a set of features; the sprite cannot be tinted, so the body pattern
 *       has to be picked to match it.
 *
 * serpent: the ornamental head — a broad shield skull, a ridge of plates down
 *       the snout, mirrored gold linework along brow and jaw, and big slit
 *       eyes. `marks` is the linework, `ridge` the plates, `outline` the dark
 *       edge the whole head is drawn against. Its own block rather than
 *       another `eyes` value because it replaces the entire face, and because
 *       the three colours only mean anything together.
 *
 * eyes:  'big' and 'slit' are the cartoon pair. 'gem' is a dark almond rimmed
 *       in metal, with a cut pupil and lashes — only worth it on a skin whose
 *       head is drawn as an animal's rather than as a character's.
 *
 * eyeColor: the sclera behind the pupil, white unless a skin says otherwise.
 *       A real viper's eye is the one part of it that is not green, and a
 *       white one reads as a cartoon however good the scales are. Only the
 *       'big'/'slit' pair use it; 'gem' draws its own dark stone.
 *
 * bloom: a flower on the side of the head, drawn with the face.
 *
 * crown: one head ornament, drawn either behind the head ('horns', 'plume',
 *       'topknot', 'frill', 'hat') or in front of it ('beak', 'snout',
 *       'visor', 'tiara'). `color` is the ornament, `accent` its trim — the pom
 *       on a hat, the lens in a visor, the pearls on a tiara. A 'visor' hides
 *       the eyes, since it is one.
 *
 * flames: draws flame tongues up the body instead of scutes. Same idea as
 *       `scales` — an overlay, not a pattern mode — but the shape licks
 *       backward — fire trails behind whatever carries it — and alternates
 *       sides, so a body reads as fire rather than as an orange snake. The
 *       tongues *replace* the beads, and each carries its bead's colour so the
 *       pattern still runs head to tail; `tint` overrides that with one flat
 *       colour, and `core` is the brighter heart drawn inside each tongue.
 *
 * smooth: draws the body as one continuous tube instead of a bead chain — no
 *       scalloped edges, no seams. `texture` stipples it with scales a shade
 *       darker than the skin, felt more than seen. For anything that should
 *       read as a real animal rather than as plating.
 *
 * The block of skins at the end is drawn from the sprite sheets in
 * `app/assets/assets/`: `app/scripts/sample-art-palette.js` reads each
 * sheet.png and prints its dominant body and head colours, and those hexes are
 * pasted in below. The art itself never ships — only the numbers taken off it.
 */
const SKINS = [
  {
    id: 'classic',
    group: 'basics',
    name: 'Classic',
    desc: 'Plain and quick. Uses whichever colour you pick.',
    mode: 'bands',
    pattern: null, // filled in from the player's chosen colour
    band: 1,
  },
  {
    id: 'ember',
    group: 'basics',
    name: 'Ember',
    desc: 'Burns brightest at the head.',
    mode: 'gradient',
    pattern: ['#FFE066', '#FF9E2C', '#FF5E1A', '#C81D11'],
  },
  {
    id: 'bumble',
    group: 'basics',
    name: 'Bumble',
    desc: 'Small, loud, and best left alone.',
    mode: 'bands',
    pattern: ['#FFC300', '#2B2B2B'],
    band: 3,
  },
  {
    id: 'tiger',
    group: 'basics',
    name: 'Tiger',
    desc: 'Stripes earned the hard way.',
    mode: 'bands',
    pattern: ['#FF8A1E', '#FF8A1E', '#2B2B2B'],
    band: 2,
  },
  {
    id: 'panda',
    group: 'animals',
    name: 'Panda',
    desc: 'Looks harmless. Is not.',
    mode: 'bands',
    pattern: ['#F7F7F7', '#F7F7F7', '#2B2B2B'],
    band: 3,
    ears: { shape: 'round', color: '#2B2B2B' },
    belly: '#FFFFFF',
  },
  {
    id: 'bunny',
    group: 'animals',
    name: 'Bunny',
    desc: 'Hops between snacks.',
    mode: 'bands',
    pattern: ['#FFFFFF', '#FFF0F3'],
    band: 4,
    ears: { shape: 'long', color: '#FFFFFF', inner: '#FFAFC5' },
    belly: '#FFFFFF',
  },
  {
    id: 'cat',
    group: 'animals',
    name: 'Alley Cat',
    desc: 'Nine lives, one arena.',
    mode: 'bands',
    pattern: ['#3A3F47', '#2B2B2B'],
    band: 3,
    ears: { shape: 'pointed', color: '#3A3F47', inner: '#FF9EB5' },
  },
  {
    id: 'cow',
    group: 'animals',
    name: 'Moo',
    desc: 'Grazes on whatever is nearest.',
    mode: 'bands',
    pattern: ['#FFFFFF', '#FFFFFF', '#2B2B2B', '#FFFFFF', '#2B2B2B', '#FFFFFF'],
    band: 2,
    ears: { shape: 'round', color: '#F2AFC4' },
    belly: '#FFFFFF',
  },
  {
    id: 'toxic',
    group: 'basics',
    name: 'Toxic',
    desc: 'Do not eat.',
    mode: 'bands',
    pattern: ['#9BE564', '#1F3A17'],
    band: 2,
  },
  {
    id: 'candy',
    group: 'basics',
    name: 'Candy',
    desc: 'Sweet right up until it isn’t.',
    mode: 'bands',
    pattern: ['#FF6FB5', '#FFFFFF'],
    band: 2,
  },
  {
    id: 'galaxy',
    group: 'basics',
    name: 'Galaxy',
    desc: 'Made of the good kind of space dust.',
    mode: 'gradient',
    pattern: ['#F582AE', '#7B2CBF', '#3A0CA3', '#4CC9F0'],
  },
  {
    id: 'ocean',
    group: 'basics',
    name: 'Deep',
    desc: 'Comes up from somewhere cold.',
    mode: 'gradient',
    pattern: ['#7FE0F0', '#1982C4', '#0B3A66'],
  },
  {
    id: 'mint',
    group: 'basics',
    name: 'Mint',
    desc: 'Cool headed.',
    mode: 'gradient',
    pattern: ['#EAFFF6', '#41EAD4', '#0F8B7E'],
  },
  {
    id: 'lava',
    group: 'basics',
    name: 'Lava',
    desc: 'Cooling on the outside only.',
    mode: 'bands',
    pattern: ['#FF4800', '#2B2B2B', '#FF7B00', '#2B2B2B'],
    band: 2,
  },
  {
    id: 'ghost',
    group: 'basics',
    name: 'Ghost',
    desc: 'Hard to read, harder to catch.',
    mode: 'gradient',
    pattern: ['#FFFFFF', '#D9E8F5', '#9FB6C9'],
    eyes: 'big',
  },
  {
    id: 'rainbow',
    group: 'basics',
    name: 'Rainbow',
    desc: 'Every colour, all at once.',
    mode: 'bands',
    pattern: ['#FF5E5B', '#FF9E2C', '#FFD93D', '#7ED321', '#3FA9F5', '#7B2CBF'],
    band: 2,
  },

  // ---- drawn from the sprite sheets in app/assets/assets ------------------
  // Palettes sampled by scripts/sample-art-palette.js; heads chosen to match
  // each character's silhouette. Appended, never reordered — a snake refers to
  // its skin by index, so inserting above would repaint everyone mid-match.
  {
    id: 'rex',
    group: 'beasts',
    name: 'Rex',
    desc: 'Small arms. Big opinions.',
    mode: 'bands',
    pattern: ['#ABD144', '#86B22D'],
    band: 3,
    scales: {},
    belly: '#E4E897',
    crown: { shape: 'snout', color: '#E4E897', accent: '#5F8020' },
    eyes: 'big',
  },
  {
    id: 'wyrm',
    group: 'beasts',
    name: 'Wyrm',
    desc: 'Crimson scales, gold on the wing.',
    mode: 'bands',
    pattern: ['#C63756', '#B02F4B'],
    band: 3,
    scales: {},
    crown: { shape: 'horns', color: '#E6D958' },
    eyes: 'slit',
  },
  {
    id: 'jade',
    group: 'beasts',
    name: 'Jade Dragon',
    desc: 'Older than the arena. Unimpressed by it.',
    mode: 'bands',
    pattern: ['#2E9E6B', '#2E9E6B', '#1F7A50'],
    band: 3,
    scales: {},
    belly: '#D8E8B0',
    crown: { shape: 'horns', color: '#E8D98A' },
    eyes: 'slit',
  },
  {
    id: 'obsidian',
    group: 'beasts',
    name: 'Obsidian',
    desc: 'Scales that drink the light.',
    mode: 'gradient',
    pattern: ['#3A3550', '#241F36', '#12101D'],
    scales: { tint: '#4C4470' },
    crown: { shape: 'horns', color: '#6E5CA8' },
    eyes: 'slit',
  },
  {
    id: 'goldscale',
    group: 'beasts',
    name: 'Goldscale',
    desc: 'A hoard with a snake wrapped round it.',
    mode: 'bands',
    pattern: ['#F0CB57', '#D9A32B'],
    band: 2,
    scales: { tint: '#F6DE9A' },
    crown: { shape: 'horns', color: '#F5E3A1' },
    eyes: 'slit',
  },
  {
    id: 'umbra',
    group: 'beasts',
    name: 'Umbra',
    desc: 'You hear it before you see it.',
    mode: 'gradient',
    pattern: ['#474656', '#292835', '#0C0A27'],
    crown: { shape: 'horns', color: '#8A87A8' },
    eyes: 'slit',
  },
  {
    id: 'gorgon',
    group: 'beasts',
    name: 'Gorgon',
    desc: 'Already half snake. This is a promotion.',
    mode: 'gradient',
    pattern: ['#B67867', '#462748', '#26152B'],
    crown: { shape: 'frill', color: '#7D3833', accent: '#E8A696' },
    eyes: 'slit',
  },
  {
    id: 'paladin',
    group: 'warriors',
    name: 'Paladin',
    desc: 'Polished this morning. Dented by lunch.',
    mode: 'bands',
    pattern: ['#FBFBFC', '#CBD4D5'],
    band: 3,
    belly: '#E6EAEB',
    crown: { shape: 'plume', color: '#C70000', accent: '#FFFD00' },
  },
  {
    id: 'mech',
    group: 'machines',
    name: 'Mech',
    desc: 'No eyes. Sees everything.',
    mode: 'bands',
    pattern: ['#EDEBE3', '#FECB00'],
    band: 2,
    crown: { shape: 'visor', color: '#FECB00', accent: '#E01B1B' },
  },
  {
    id: 'kris',
    group: 'warriors',
    name: 'Kris',
    desc: 'Knows exactly which of you has been good.',
    mode: 'bands',
    pattern: ['#E90000', '#F9F9FA'],
    band: 3,
    belly: '#F9F9FA',
    crown: { shape: 'hat', color: '#E90000', accent: '#F9F9FA' },
  },
  {
    id: 'brawler',
    group: 'warriors',
    name: 'Brawler',
    desc: 'Leads with the hair.',
    mode: 'bands',
    pattern: ['#477D85', '#3A3F5E'],
    band: 3,
    belly: '#E9B5A3',
    crown: { shape: 'plume', color: '#FA6A0A', accent: '#F9A31B' },
  },
  {
    id: 'ronin',
    group: 'warriors',
    name: 'Ronin',
    desc: 'Serves nobody. Turns beautifully.',
    mode: 'bands',
    pattern: ['#242234', '#3A3F5E', '#1B2447'],
    band: 3,
    belly: '#E9B5A3',
    crown: { shape: 'topknot', color: '#242234', accent: '#B3B9D1' },
  },
  {
    id: 'shinobi',
    group: 'warriors',
    name: 'Shinobi',
    desc: 'Was behind you a moment ago.',
    mode: 'bands',
    pattern: ['#283540', '#2B2B45', '#3B2027'],
    band: 3,
    belly: '#E9B5A3',
    crown: { shape: 'topknot', color: '#3B2027', accent: '#B9BFFB' },
  },
  {
    id: 'ninja',
    group: 'warriors',
    name: 'Red Mask',
    desc: 'The mask is the whole personality.',
    mode: 'bands',
    pattern: ['#4A2323', '#753C3C'],
    band: 3,
    belly: '#FE6767',
    crown: { shape: 'plume', color: '#351919', accent: '#FEE6AC' },
  },
  {
    id: 'karasu',
    group: 'warriors',
    name: 'Karasu',
    desc: 'Crow tengu. Takes what it likes.',
    mode: 'bands',
    pattern: ['#242234', '#14182E', '#7D3833'],
    band: 3,
    crown: { shape: 'beak', color: '#AB5130' },
  },
  {
    id: 'yamabushi',
    group: 'warriors',
    name: 'Yamabushi',
    desc: 'Came down off the mountain for this.',
    mode: 'bands',
    pattern: ['#242234', '#7D3833', '#DFE0E8'],
    band: 3,
    crown: { shape: 'beak', color: '#DFE0E8', accent: '#4C6885' },
  },
  {
    id: 'kitsune',
    group: 'animals',
    name: 'Kitsune',
    desc: 'Nine tails, and only one of them is here.',
    mode: 'bands',
    pattern: ['#FFEE83', '#FFAE70'],
    band: 3,
    belly: '#FFF6C9',
    ears: { shape: 'pointed', color: '#FFEE83', inner: '#BD6A62' },
  },
  // ---- five from the reference gallery ------------------------------------
  // Same rule as the block above: appended, never reordered.
  {
    id: 'agni',
    group: 'beasts',
    name: 'Agni',
    desc: 'A fire that decided to go somewhere.',
    mode: 'gradient',
    pattern: ['#FFF6C9', '#FFC53D', '#FF8A1E', '#F04E06'],
    flames: { core: '#FFE9A3' },
    eyes: 'big',
  },
  {
    id: 'aspmodeus',
    group: 'beasts',
    name: 'Aspmodeus',
    desc: 'Came up for the leaderboard.',
    mode: 'gradient',
    pattern: ['#D32011', '#6B241B', '#2A1614'],
    scales: { tint: '#E8503A' },
    crown: { shape: 'horns', color: '#37211E' },
    eyes: 'slit',
  },
  {
    id: 'sirius',
    group: 'animals',
    name: 'Sirius Bite',
    desc: 'Hunts by starlight. Yours.',
    mode: 'bands',
    pattern: ['#242A6E', '#3D4BC4', '#6FCBFF'],
    band: 2,
    scales: { tint: '#A6EEFF' },
    ears: { shape: 'pointed', color: '#242A6E', inner: '#6FCBFF' },
    eyes: 'slit',
  },
  {
    id: 'express',
    group: 'machines',
    name: 'Scaly Express',
    desc: 'Always reaches its destination, whatever the cost.',
    mode: 'bands',
    pattern: ['#D62828', '#1D3557', '#F4A300', '#1D3557'],
    band: 2,
    crown: { shape: 'visor', color: '#1D3557', accent: '#F7D046' },
  },
  {
    id: 'anky',
    group: 'beasts',
    name: 'Anky',
    desc: 'Armoured at both ends.',
    mode: 'bands',
    pattern: ['#6F8B3E', '#5A7433'],
    band: 3,
    scales: { tint: '#DCCFA2', style: 'dragon' },
    belly: '#CFC48F',
    eyes: 'slit',
  },
  {
    id: 'blacksmith',
    group: 'beasts',
    name: 'Black Smith',
    desc: 'Forged, cooled, and polished. Not a scale out of place.',
    mode: 'gradient',
    // Close stops on purpose: the gradient is quantised into a handful of
    // solid strokes, and stops any further apart read as visible bands down a
    // body this smooth.
    pattern: ['#35353D', '#28282F', '#1B1B20'],
    smooth: { texture: true },
    eyes: 'slit',
  },
  {
    id: 'elena',
    group: 'animals',
    name: 'Elena',
    desc: 'Dressed for the occasion. The occasion is eating you.',
    mode: 'gradient',
    // Close stops, like every smooth skin: the gradient is quantised into a
    // few solid strokes and wider stops read as bands.
    pattern: ['#E3B5AC', '#D6A099', '#C68C8A'],
    smooth: { texture: true },
    eyes: 'gem',
    crown: { shape: 'tiara', color: '#D9A188', accent: '#FBEFE9' },
    bloom: { color: '#F3C3CE', center: '#E9A0B4' },
  },
  {
    id: 'basilisk',
    group: 'beasts',
    name: 'Basilisk',
    desc: 'Green on green on gold. Watches you back.',
    // Four stops rather than three: the gold is an accent, so it gets one
    // band in five and the greens carry the rest. Ordered dark-first because
    // the head wears pattern[0] and this one is deep green, plated in a
    // lighter shade of itself by the dragon-scale pass.
    mode: 'bands',
    // Mid green leads, because pattern[0] is the head: against the dark edge
    // and the pale ridge it is what makes the face read, and a deep green head
    // just went muddy next to the body.
    pattern: ['#2CA04B', '#0F7038', '#63B840', '#2CA04B', '#E9B824'],
    band: 2,
    // No tint on purpose. Left automatic, every scale is a lighter version of
    // the band it sits on, so the gold bands get gold scutes and the green
    // ones green — which is what makes the body read as tiled rather than as
    // one colour with a sheen laid over it.
    scales: { style: 'serpent' },
    eyes: 'slit',
    eyeColor: '#F5C518',
    serpent: { marks: '#F2C230', ridge: '#7CC93F', outline: '#0A4A26' },
    // Painted head. The procedural `serpent` block above stays as the fallback
    // for a build that does not bundle the art; the body pattern is chosen to
    // match the sprite's greens, since a bitmap head cannot be tinted.
    headArt: 'basilisk',
  },
];

/** Clamp an untrusted skin choice to a real entry. */
function normalizeSkinIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= SKINS.length) return 0;
  return index;
}

module.exports = { SKINS, normalizeSkinIndex };
