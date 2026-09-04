import test from 'node:test';
import assert from 'node:assert';

import { LOCAL_SKINS } from './skins.catalog';
import { TIERS, TIER_ORDER, tierOf } from './tiers';

test('every skin in the catalogue lands on a real tier', () => {
  for (const s of LOCAL_SKINS) {
    const t = tierOf(s);
    assert.ok(TIER_ORDER.includes(t.key), `${s.id} fell off the rails as ${t.key}`);
    assert.strictEqual(t.key, s.group, `${s.id} is grouped ${s.group} but badged ${t.key}`);
  }
});

test('the rail order covers the tier table exactly', () => {
  assert.deepStrictEqual([...TIER_ORDER].sort(), Object.keys(TIERS).sort());
});

test('a skin from an older server still gets a badge', () => {
  // `group` arrives from the server's catalogue, so a stale server sends none.
  const { group, ...legacy } = LOCAL_SKINS[0];
  assert.strictEqual(tierOf(legacy).key, 'basics');
  assert.strictEqual(tierOf(undefined).key, 'basics');
  assert.strictEqual(tierOf({ ...legacy, group: 'nonsense' as never }).key, 'basics');
});

test('each tier is distinguishable at a glance', () => {
  const glyphs = new Set(TIER_ORDER.map((k) => TIERS[k].glyph));
  const colors = new Set(TIER_ORDER.map((k) => TIERS[k].color));
  assert.strictEqual(glyphs.size, TIER_ORDER.length, 'two tiers share a glyph');
  assert.strictEqual(colors.size, TIER_ORDER.length, 'two tiers share a colour');
  for (const k of TIER_ORDER) {
    assert.match(TIERS[k].color, /^#[0-9A-Fa-f]{6}$/);
    assert.match(TIERS[k].ink, /^#[0-9A-Fa-f]{6}$/);
    assert.ok(TIERS[k].label.length > 0);
  }
});

test('every tier is actually worn by something', () => {
  // A rail that filters to nothing is a dead end in the UI.
  for (const k of TIER_ORDER) {
    assert.ok(
      LOCAL_SKINS.some((s) => s.group === k),
      `no skin wears the ${k} badge`
    );
  }
});
