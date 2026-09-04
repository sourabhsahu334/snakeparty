import test from 'node:test';
import assert from 'node:assert';

import { beadColors, scaleHighlight } from './skins';
import type { Skin } from './protocol';

const classic: Skin = { id: 'classic', name: 'Classic', desc: '', mode: 'bands', pattern: null, band: 1 };
const bumble: Skin = { id: 'bumble', name: 'Bumble', desc: '', mode: 'bands', pattern: ['#FFC300', '#2B2B2B'], band: 3 };
const ember: Skin = { id: 'ember', name: 'Ember', desc: '', mode: 'gradient', pattern: ['#FFE066', '#C81D11'] };

test('classic wears the colour the player picked', () => {
  const c = beadColors(classic, '#3FA9F5', 10);
  assert.strictEqual(c.length, 10);
  assert.ok(c.every((x) => x === '#3FA9F5'));
});

test('bands repeat the pattern, `band` beads at a time', () => {
  const c = beadColors(bumble, '#000000', 12);
  assert.deepStrictEqual(c.slice(0, 3), ['#FFC300', '#FFC300', '#FFC300']);
  assert.deepStrictEqual(c.slice(3, 6), ['#2B2B2B', '#2B2B2B', '#2B2B2B']);
  assert.strictEqual(c[6], '#FFC300', 'pattern wraps');
});

test('a gradient runs head to tail and is quantised for cheap drawing', () => {
  const c = beadColors(ember, '#000000', 40);
  assert.strictEqual(c[0], '#ffe066', 'head is the first stop');
  assert.strictEqual(c[c.length - 1], '#c81d11', 'tail is the last stop');
  const distinct = new Set(c).size;
  assert.ok(distinct <= 6, `gradient used ${distinct} colours; should quantise to <= 6 draw calls`);
  assert.ok(distinct > 2, 'but it should actually blend');
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
