#!/usr/bin/env node
'use strict';
/**
 * Renders the app icon and the store screenshots.
 *
 *   npm run gen:store            everything
 *   npm run gen:store -- icon    the app icon, plus the store listing icons
 *   npm run gen:store -- native  the launcher icons inside android/ and ios/
 *
 * Everything is drawn procedurally in headless Chrome by scripts/brand/*.js —
 * there are no source images to lose. The palette, the skin catalogue and the
 * UI theme are read out of the real sources at render time, so the art cannot
 * drift from the game the way a hand-exported PNG would.
 *
 * Needs Chrome. It uses whatever `npx puppeteer` already downloaded, falls back
 * to the installed Google Chrome, and honours $CHROME.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BRAND = path.join(__dirname, 'brand');
const OUT = path.join(ROOT, 'assets');
const SHOTS = path.join(OUT, 'store');

/* ------------------------------------------------------------------ chrome */
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;

  const cache = path.join(os.homedir(), '.cache', 'puppeteer');
  for (const kind of ['chrome-headless-shell', 'chrome']) {
    const dir = path.join(cache, kind);
    if (!fs.existsSync(dir)) continue;
    // Newest download wins — the directories are named mac_arm-134.0.6998.35.
    const builds = fs.readdirSync(dir).sort().reverse();
    for (const b of builds) {
      const hits = [
        path.join(dir, b, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(dir, b, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
        path.join(dir, b, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        path.join(dir, b, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(dir, b, 'chrome-linux64', 'chrome'),
      ];
      for (const h of hits) if (fs.existsSync(h)) return h;
    }
  }
  for (const h of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]) if (fs.existsSync(h)) return h;

  throw new Error('No Chrome found. Install Google Chrome or set $CHROME.');
}
const CHROME = findChrome();

/* ------------------------------------------------------- sources of truth */
const { SKINS } = require(path.join(ROOT, '../server/src/skins.js'));
const { COLORS } = require(path.join(ROOT, '../server/src/config.js'));

/**
 * Pull the palette out of src/lib/theme.ts.
 *
 * Reading the TypeScript beats keeping a second copy here: the theme is a flat
 * object of string literals, and a copy would silently rot the first time
 * someone retunes the arena colour.
 */
function readTheme() {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/theme.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const theme = {'), src.indexOf('export const ui'));
  const theme = {};
  for (const m of block.matchAll(/^\s*(\w+):\s*'([^']*)',/gm)) theme[m[1]] = m[2];
  const need = ['arena', 'hexLine', 'ink', 'outline', 'gold', 'danger', 'accent', 'panel'];
  const missing = need.filter((k) => !theme[k]);
  if (missing.length) throw new Error('theme.ts is missing ' + missing.join(', '));
  return theme;
}
const THEME = readTheme();

/* ------------------------------------------------------------------ render */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snake-store-'));
const lib = (f) => fs.readFileSync(path.join(BRAND, f), 'utf8');

function shoot(name, html, w, h, outFile, transparent) {
  const page = path.join(tmp, name + '.html');
  fs.writeFileSync(page, html);
  const args = [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--window-size=' + w + ',' + h,
    '--screenshot=' + outFile,
  ];
  if (transparent) args.push('--default-background-color=00000000');
  args.push('file://' + page);
  execFileSync(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log('  ' + path.relative(ROOT, outFile).padEnd(62) + w + 'x' + h + '  ' + kb + 'kB');
}

/** A self-contained page: reset, injected constants, the brand libs, a draw call. */
function page(w, h, scripts, body) {
  return `<!doctype html><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${w}px;height:${h}px;overflow:hidden;background:transparent}
    canvas{display:block;position:absolute;inset:0}
    body{font-family:"SF Pro Display",-apple-system,"Helvetica Neue",Arial,sans-serif;
         -webkit-font-smoothing:antialiased}
  </style>
  <script>
    const THEME = ${JSON.stringify(THEME)};
    const COLORS = ${JSON.stringify(COLORS)};
    const SKINS = ${JSON.stringify(SKINS)};
  </script>
  <script>${lib('scene.js')}</script>
  ${scripts.map((f) => '<script>' + lib(f) + '</script>').join('\n')}
  ${body}`;
}

/* -------------------------------------------------------------------- icon */
function icon(size, outFile, mode) {
  const html = page(size, size, ['icon.js'], `
    <canvas id="c" width="${size}" height="${size}" style="width:${size}px;height:${size}px"></canvas>
    <script>drawIcon(document.getElementById('c').getContext('2d'), ${size}, ${JSON.stringify(mode)});</script>`);
  shoot('icon-' + size + '-' + mode, html, size, size, outFile,
        mode === 'foreground' || mode === 'round');
}

/**
 * Drop the alpha channel. Chrome always writes RGBA, and App Store Connect
 * rejects an icon that has one — even when every pixel in it is opaque.
 */
function flatten(file) {
  const { PNG } = require(path.join(ROOT, 'node_modules', 'pngjs'));
  const png = PNG.sync.read(fs.readFileSync(file));
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 2, inputHasAlpha: true }));
}

/* ------------------------------------------------------------ native apps */
/**
 * The launcher icons inside android/ and ios/.
 *
 * `expo prebuild` derives these from app.json, but the native projects are
 * checked in and rarely regenerated, so this renders them from the same
 * composition instead of letting them drift back to the Expo default. Every
 * density is drawn at its own size rather than downscaled from the 1024, which
 * is what keeps the 48px launcher outline crisp.
 */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const RES = path.join(ROOT, 'android/app/src/main/res');

const CWEBP = (function () {
  for (const h of ['/opt/homebrew/bin/cwebp', '/usr/local/bin/cwebp', '/usr/bin/cwebp']) {
    if (fs.existsSync(h)) return h;
  }
  return null;
})();

/**
 * Android reads whichever extension it finds, so the unused one has to go:
 * ic_launcher.webp and ic_launcher.png side by side is an aapt2 conflict.
 */
function androidIcon(dir, name, size, mode) {
  fs.mkdirSync(dir, { recursive: true });
  const png = path.join(dir, name + '.png');
  const webp = path.join(dir, name + '.webp');
  icon(size, png, mode);
  if (CWEBP) {
    execFileSync(CWEBP, ['-q', '90', '-quiet', png, '-o', webp]);
    fs.rmSync(png);
  } else {
    fs.rmSync(webp, { force: true });
  }
}

const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;

function native() {
  if (!CWEBP) {
    console.log('  cwebp not found — writing PNG launcher icons instead of WebP');
  }
  for (const [dpi, scale] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, 'mipmap-' + dpi);
    androidIcon(dir, 'ic_launcher', Math.round(48 * scale), 'full');
    androidIcon(dir, 'ic_launcher_round', Math.round(48 * scale), 'round');
    // The adaptive layers are 108dp: the launcher masks them down to 72dp.
    androidIcon(dir, 'ic_launcher_foreground', Math.round(108 * scale), 'foreground');
    androidIcon(dir, 'ic_launcher_background', Math.round(108 * scale), 'background');
  }
  const anydpi = path.join(RES, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpi, { recursive: true });
  for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    fs.writeFileSync(path.join(anydpi, f), ADAPTIVE_XML);
    console.log('  ' + path.relative(ROOT, path.join(anydpi, f)));
  }

  const appIcon = path.join(ROOT, 'ios/SnakeParty/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png');
  icon(1024, appIcon, 'full');
  flatten(appIcon);
}

/* ------------------------------------------------------------- screenshots */
/**
 * Screens are composed at iPhone landscape point sizes and rendered at a
 * device scale factor, so the HUD can reuse the same dp values as the React
 * Native styles and land pixel-for-pixel on the real thing.
 */
function screenshot(scene, cssW, cssH, dpr, outFile) {
  const w = cssW * dpr;
  const h = cssH * dpr;
  const html = page(w, h, ['shots.js'], `
    <canvas id="c" width="${w}" height="${h}" style="width:${w}px;height:${h}px"></canvas>
    <script>drawShot(document.getElementById('c').getContext('2d'), ${JSON.stringify(scene)}, ${cssW}, ${cssH}, ${dpr});</script>`);
  shoot('shot-' + scene + '-' + w, html, w, h, outFile);
}

/* -------------------------------------------------------------------- main */
// `npm run gen:store -- icon` re-renders just the icon, which is the piece you
// actually iterate on; `-- native` then stamps it into the checked-in projects.
const only = process.argv[2];
const want = (group) => !only || only === group;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

console.log('chrome: ' + CHROME);
if (want('icon')) {
  console.log('\nicon');
  icon(1024, path.join(OUT, 'icon.png'), 'full');
  icon(1024, path.join(OUT, 'adaptive-icon.png'), 'foreground');
  icon(1024, path.join(OUT, 'adaptive-icon-background.png'), 'background');
  icon(512, path.join(OUT, 'splash-icon.png'), 'foreground');
  icon(48, path.join(OUT, 'favicon.png'), 'full');

  // The listing icons. Apple wants 1024 with no alpha channel, Play wants 512.
  console.log('\nstore icons');
  const appStore = path.join(SHOTS, 'app-store-icon.png');
  icon(1024, appStore, 'full');
  flatten(appStore);
  icon(512, path.join(SHOTS, 'play-store-icon.png'), 'full');
}

if (want('native')) {
  console.log('\nnative launcher icons');
  native();
}

// Solo-only, because 1.0.0 is solo-only: a listing may not show a mode the
// build does not have. Bots and the leaderboard are real in single player, so
// those stay.
const SCENES = ['hero', 'boost', 'grow', 'skins', 'menu'];

// 2796x1290 is the 6.7" iPhone landscape slot, and the largest App Store
// accepts; 1920x1080 is Play's landscape phone screenshot.
// shots.js is still a stub. Rendering it would fill assets/store with blank
// PNGs that look like finished screenshots, so skip the group until it draws.
if (want('shots') && !lib('shots.js').trim()) {
  console.log('\nscreenshots — skipped, scripts/brand/shots.js is empty');
} else if (want('shots')) {
  console.log('\nscreenshots — App Store 6.7" landscape');
  SCENES.forEach((s, i) => {
    screenshot(s, 932, 430, 3, path.join(SHOTS, `ios-67-${i + 1}-${s}.png`));
  });
  console.log('\nscreenshots — Play Store landscape');
  SCENES.forEach((s, i) => {
    screenshot(s, 960, 540, 2, path.join(SHOTS, `play-${i + 1}-${s}.png`));
  });

  // Play's feature graphic slot is 1024x500 and rejects an alpha channel.
  console.log('\nPlay Store feature graphic');
  const html = page(1024, 500, ['shots.js'], `
    <canvas id="c" width="1024" height="500" style="width:1024px;height:500px"></canvas>
    <script>drawFeatureGraphic(document.getElementById('c').getContext('2d'), 1024, 500);</script>`);
  const feature = path.join(SHOTS, 'play-feature-graphic.png');
  shoot('feature', html, 1024, 500, feature);
  flatten(feature);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\ndone.');
