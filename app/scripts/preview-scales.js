/**
 * Render the scaled skins next to their unscaled selves, so the scale pass can
 * be judged without booting the app on a device.
 *
 * node scripts/preview-scales.js  ->  assets/store/scales-preview.png
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BRAND = path.join(__dirname, 'brand');
const OUT = path.join(ROOT, 'assets', 'store');
const { SKINS } = require(path.join(ROOT, '../server/src/skins.js'));
const { COLORS } = require(path.join(ROOT, '../server/src/config.js'));

function readTheme() {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/theme.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const theme = {'), src.indexOf('export const ui'));
  const theme = {};
  for (const m of block.matchAll(/^\s*(\w+):\s*'([^']*)',/gm)) theme[m[1]] = m[2];
  return theme;
}

function findChrome() {
  const cands = [
    path.join(os.homedir(), '.cache/puppeteer'),
  ];
  for (const base of cands) {
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name === 'chrome-headless-shell' || e.name === 'chrome') return p;
      }
    }
  }
  throw new Error('no headless chrome found under ~/.cache/puppeteer');
}

const SCALED = SKINS.filter((s) => s.scales).map((s) => s.id);
const W = 1100;
const ROW = 150;
const H = ROW * SCALED.length + 60;

const html = `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:${readTheme().arena}}
  canvas{display:block;position:absolute;inset:0}
  body{font-family:"SF Pro Display",-apple-system,Arial,sans-serif}
</style>
<script>
  const THEME = ${JSON.stringify(readTheme())};
  const COLORS = ${JSON.stringify(COLORS)};
  const SKINS = ${JSON.stringify(SKINS)};
</script>
<script>${fs.readFileSync(path.join(BRAND, 'scene.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(BRAND, 'shots.js'), 'utf8')}</script>
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
  const ids = ${JSON.stringify(SCALED)};
  const ctx = document.getElementById('c').getContext('2d');
  ctx.fillStyle = THEME.arena; ctx.fillRect(0,0,${W},${H});
  ctx.font = '600 15px -apple-system, Arial';

  ids.forEach(function (id, row) {
    const cy = 46 + row * ${ROW};
    const sk = SKINS.find(function (s) { return s.id === id; });

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textAlign = 'left';
    ctx.fillText(sk.name, 24, cy - 4);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '400 12px -apple-system, Arial';
    ctx.fillText('without scales', 250, cy - 22);
    ctx.fillText('with scales', 700, cy - 22);
    ctx.font = '600 15px -apple-system, Arial';

    // Same pose twice: left without the scale pass, right with it.
    [false, true].forEach(function (withScales, col) {
      const x0 = 0.22 + col * 0.41;
      const body = [[x0, 0.5],[x0+0.08,0.18],[x0+0.17,0.82],[x0+0.26,0.4]];
      const s = posed(${W}, ${ROW}, body.map(function(p){ return [p[0], p[1]]; }), {
        radius: 26, color: COLORS[0], skin: id, spacing: 9,
      });
      // Strip the scale spec for the left-hand copy.
      s.skin = Object.assign({}, s.skin, withScales ? {} : { scales: undefined });
      ctx.save();
      ctx.translate(0, cy - ${ROW} * 0.5 + 24);
      drawSnake(ctx, s, { outline: '#0E2B3A', outlineWidth: 3 });
      ctx.restore();
    });
  });
</script>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scales-'));
const page = path.join(tmp, 'p.html');
fs.writeFileSync(page, html);
fs.mkdirSync(OUT, { recursive: true });
const out = path.join(OUT, 'scales-preview.png');
execFileSync(findChrome(), [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb',
  '--window-size=' + W + ',' + H, '--screenshot=' + out, 'file://' + page,
], { stdio: ['ignore', 'ignore', 'pipe'] });
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote ' + path.relative(ROOT, out) + '  ' + W + 'x' + H);
