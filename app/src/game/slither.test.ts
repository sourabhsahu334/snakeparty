import test from 'node:test';
import assert from 'node:assert';

import { headingAt, slither } from './slither';

const opts = { beads: 40, length: 200, amplitude: 30, waves: 1.35, phase: 0 };

test('a body is sampled head first, from the head to exactly the tail', () => {
  const pts = slither(opts);
  assert.strictEqual(pts.length, 40);
  assert.deepStrictEqual(pts[0], { x: 0, y: 0 }, 'the head anchors the curve');
  assert.strictEqual(pts[pts.length - 1].y, 200, 'the tail lands at the full length');
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].y > pts[i - 1].y, 'the body only ever runs away from the head');
  }
});

test('the swing never exceeds the amplitude it was given', () => {
  // Every phase, or a preview could poke out of its card at some moment.
  for (let p = 0; p < 7; p += 0.1) {
    for (const { x } of slither({ ...opts, phase: p })) {
      assert.ok(Math.abs(x) <= 30 + 1e-9, `swung to ${x}`);
    }
  }
});

test('advancing the phase moves the body but not the head', () => {
  const a = slither(opts);
  const b = slither({ ...opts, phase: 1.1 });
  assert.strictEqual(b[0].x, a[0].x, 'the head is damped to the axis');
  const moved = a.some((p, i) => Math.abs(p.x - b[i].x) > 1);
  assert.ok(moved, 'the rest of it should have slithered');
});

test('the head is damped, so it sways less than the middle of the body', () => {
  // Phase chosen so the wave is not near a node at either sample point.
  const pts = slither({ ...opts, phase: 0.9 });
  const near = Math.abs(pts[3].x);
  const mid = Math.abs(pts[Math.floor(pts.length / 2)].x);
  assert.ok(near < mid, `head end swung ${near}, middle swung ${mid}`);
});

test('a degenerate bead count still yields a drawable body', () => {
  assert.strictEqual(slither({ ...opts, beads: 0 }).length, 2);
  assert.strictEqual(slither({ ...opts, beads: 1 }).length, 2);
  for (const p of slither({ ...opts, beads: 2 })) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});

test('headings are unit vectors pointing toward the head', () => {
  const pts = slither({ ...opts, phase: 0.4 });
  for (let i = 0; i < pts.length; i++) {
    const h = headingAt(pts, i);
    assert.ok(Math.abs(Math.hypot(h.x, h.y) - 1) < 1e-9, 'not a unit vector');
    // The body runs along +y from the head, so "toward the head" is -y.
    assert.ok(h.y < 0, `bead ${i} pointed backwards`);
  }
});

test('the head borrows the bead behind it rather than spinning', () => {
  const pts = slither({ ...opts, phase: 0.4 });
  const head = headingAt(pts, 0);
  const next = headingAt(pts, 1);
  assert.deepStrictEqual(head, next);
});

test('a collapsed body does not produce a NaN heading', () => {
  const flat = [
    { x: 5, y: 5 },
    { x: 5, y: 5 },
  ];
  const h = headingAt(flat, 0);
  assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y));
});
