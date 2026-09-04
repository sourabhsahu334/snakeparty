#!/usr/bin/env node
'use strict';
/**
 * Read the sprite sheets in `assets/assets/` and print the colours each
 * character is actually made of, so a skin can be built from the art rather
 * than guessed at.
 *
 *   node scripts/sample-art-palette.js            # every sheet
 *   node scripts/sample-art-palette.js dragon     # just one
 *
 * Nothing consumes the output automatically — the hexes are pasted into
 * `server/src/skins.js` by hand, because which of a character's ten colours
 * make a readable snake is a judgement call. This only saves eyedroppering.
 *
 * Two figures are printed per sheet:
 *
 *   body  the whole sheet, so the dominant costume colours
 *   head  the top fifth of each column's opaque run — for a side-view sprite
 *         that is the head, helmet, horns or hair, whichever frame it is in
 *
 * Near-black pixels (value < 0.14) are skipped in both. Pixel art is drawn
 * with heavy dark outlines, and counting them makes every character come out
 * charcoal.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '../assets/assets');
/** Colours are binned 4 bits per channel; near-identical shades are one entry. */
const BIN = 4;
const TOP = 8;
/** Fraction of a column's opaque run that counts as "head". */
const HEAD = 0.22;

const hex = (r, g, b) =>
  '#' +
  [r, g, b]
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

const value = (r, g, b) => Math.max(r, g, b) / 255;

/** Dominant colours of the pixels `keep(x, y)` accepts, commonest first. */
function dominant(png, keep) {
  const { width, height, data } = png;
  const bins = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 200) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (value(r, g, b) < 0.14) continue;
      if (keep && !keep(x, y)) continue;
      const key = ((r >> BIN) << 16) | ((g >> BIN) << 8) | (b >> BIN);
      let e = bins.get(key);
      if (!e) bins.set(key, (e = { n: 0, r: 0, g: 0, b: 0 }));
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    }
  }
  const total = [...bins.values()].reduce((a, e) => a + e.n, 0) || 1;
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, TOP)
    .map((e) => `${hex(e.r / e.n, e.g / e.n, e.b / e.n)} ${Math.round((e.n / total) * 100)}%`);
}

/** For each column, the y below which pixels count as the character's head. */
function headCutoffs(png) {
  const { width, height, data } = png;
  const cut = new Int32Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      if (data[(y * width + x) * 4 + 3] > 200) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0 || bottom - top < 8) continue;
    cut[x] = top + Math.max(2, Math.round((bottom - top) * HEAD));
  }
  return cut;
}

const only = process.argv.slice(2);
const ids = fs
  .readdirSync(ROOT)
  .filter((id) => fs.existsSync(path.join(ROOT, id, 'sheet.png')))
  .filter((id) => only.length === 0 || only.includes(id))
  .sort();

if (ids.length === 0) {
  console.error(`no sheets matched${only.length ? ` ${only.join(', ')}` : ''} in ${ROOT}`);
  process.exit(1);
}

for (const id of ids) {
  const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, id, 'sheet.png')));
  const cut = headCutoffs(png);
  console.log(`\n${id}  ${png.width}x${png.height}`);
  console.log('  body', dominant(png, null).join('  '));
  console.log('  head', dominant(png, (x, y) => cut[x] >= 0 && y <= cut[x]).join('  '));
}
