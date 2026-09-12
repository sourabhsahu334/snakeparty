import test from 'node:test';
import assert from 'node:assert';

import { beadColors, scaleHighlight } from './skins';
import { LOCAL_SKINS } from './skins.catalog';
import type { Skin } from './protocol';

const classic: Skin = { id: 'classic', name: 'Classic', desc: '', mode: 'bands', pattern: null };
const bumble: Skin = { id: 'bumble', name: 'Bumble', desc: '', mode: 'bands', pattern: ['#FFC300', '#2B2B2B'] };
const ember: Skin = { id: 'ember', name: 'Ember', desc: '', mode: 'gradient', pattern: ['#FFE066', '#C81D11'] };

test('classic wears the colour the player picked', () => {
  const c = beadColors(classic, '#3FA9F5', 10);
  assert.strictEqual(c.length, 10);
  assert.ok(c.every((x) => x === '#3FA9F5'));
});

test('bands repeat the pattern in fixed-width stripes', () => {
  const c = beadColors(bumble, '#000000', 12);
  assert.deepStrictEqual(c.slice(0, 3), ['#FFC300', '#FFC300', '#FFC300']);
  assert.deepStrictEqual(c.slice(3, 6), ['#2B2B2B', '#2B2B2B', '#2B2B2B']);
  assert.strictEqual(c[6], '#FFC300', 'pattern wraps');
});

test('a gradient runs head to tail and is quantised for cheap drawing', () => {
  // Long enough to have run the full span; the ramp is anchored to the head, so
  // a snake shorter than the span simply has not reached the last stop yet.
  const c = beadColors(ember, '#000000', 80);
  assert.strictEqual(c[0], '#ffe066', 'head is the first stop');
  assert.strictEqual(c[c.length - 1], '#c81d11', 'tail is the last stop');
  const distinct = new Set(c).size;
  assert.ok(distinct <= 6, `gradient used ${distinct} colours; should quantise to <= 6 draw calls`);
  assert.ok(distinct > 2, 'but it should actually blend');
});

test('two skins sharing an id but not a pattern do not share cached colours', () => {
  const a: Skin = { id: 'dup', name: 'A', desc: '', mode: 'bands', pattern: ['#FF0000'] };
  const b: Skin = { id: 'dup', name: 'B', desc: '', mode: 'bands', pattern: ['#00FF00'] };
  assert.strictEqual(beadColors(a, '#000000', 4)[0], '#FF0000');
  assert.strictEqual(beadColors(b, '#000000', 4)[0], '#00FF00', 'served the other skin from cache');
});

test('a body only ever needs a few draw calls', () => {
  for (const skin of [classic, bumble, ember]) {
    const distinct = new Set(beadColors(skin, '#3FA9F5', 120)).size;
    assert.ok(distinct <= 6, `${skin.id} needs ${distinct} draws`);
  }
});

test('results are cached, so this is not recomputed every frame', () => {
  const a = beadColors(bumble, '#000000', 30);
  const b = beadColors(bumble, '#000000', 30);
  assert.strictEqual(a, b, 'same array instance returned');
});

test('an undefined skin degrades to the plain colour', () => {
  const c = beadColors(undefined, '#7ED321', 5);
  assert.deepStrictEqual(c, Array(5).fill('#7ED321'));
});

test('edge cases do not throw', () => {
  assert.deepStrictEqual(beadColors(bumble, '#fff', 0), []);
  assert.strictEqual(beadColors(ember, '#fff', 1).length, 1);
});

test('a scale highlight is a lighter shade of the bead it sits on', () => {
  const dark = scaleHighlight({ ...bumble, scales: {} }, '#2B2B2B');
  const light = scaleHighlight({ ...bumble, scales: {} }, '#FFC300');
  // Each highlight must differ from its own bead, or the scale is invisible.
  assert.notStrictEqual(dark, '#2B2B2B');
  assert.notStrictEqual(light, '#FFC300');
  // And they must differ from each other: one fixed highlight would wash out
  // the gold band while barely lifting the black one.
  assert.notStrictEqual(dark, light);
});

test('an explicit tint overrides the automatic highlight', () => {
  const skin: Skin = { ...bumble, scales: { tint: '#6E5CA8' } };
  assert.strictEqual(scaleHighlight(skin, '#2B2B2B'), '#6E5CA8');
  assert.strictEqual(scaleHighlight(skin, '#FFC300'), '#6E5CA8');
});

test('a skin with no scales still yields a usable highlight colour', () => {
  // Callers gate on skin.scales, but the helper must not throw if they do not.
  assert.match(scaleHighlight(undefined, '#3FA9F5'), /^#[0-9a-f]{6}$/i);
  assert.match(scaleHighlight(bumble, '#3FA9F5'), /^#[0-9a-f]{6}$/i);
});

/**
 * Growing must not restyle the body.
 *
 * Colours used to be spread across the snake's own length, so eating shifted
 * every bead's place in the gradient and the whole body flashed — worst during
 * a feast, when it happens several times a second.
 */
test('a body already on screen does not change colour when the snake grows', () => {
  for (const skin of LOCAL_SKINS) {
    const before = beadColors(skin, '#3FA9F5', 40);
    const after = beadColors(skin, '#3FA9F5', 41);
    assert.deepStrictEqual(
      after.slice(0, 40),
      before,
      `${skin.id} re-coloured its existing body on growth`
    );
  }
});

test('growth stays stable across a whole feast, not just one bite', () => {
  const ember = LOCAL_SKINS.find((s) => s.id === 'ember')!;
  let prev = beadColors(ember, '#000000', 8);
  for (let n = 9; n <= 90; n++) {
    const next = beadColors(ember, '#000000', n);
    assert.deepStrictEqual(next.slice(0, n - 1), prev, `changed at ${n} beads`);
    prev = next;
  }
});

test('a gradient still uses its whole range on a grown snake', () => {
  const ember = LOCAL_SKINS.find((s) => s.id === 'ember')!;
  const long = new Set(beadColors(ember, '#000000', 60));
  assert.ok(long.size >= 4, `expected a visible ramp, got ${long.size} colours`);
});
