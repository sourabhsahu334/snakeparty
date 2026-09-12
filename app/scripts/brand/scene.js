/**
 * Drawing primitives for the icon and store screenshots.
 *
 * This is a deliberate re-implementation of `src/game/GameCanvas.tsx` on a 2D
 * canvas: same hex lattice, same bead bodies, same eye geometry, same skin
 * colour rules. Store art that drifts from the real renderer is worse than no
 * store art, so when GameCanvas changes, change this too.
 *
 * Runs in headless Chrome. `THEME`, `COLORS` and `SKINS` are injected by
 * scripts/gen-store-assets.js from the real sources.
 */

/* ------------------------------------------------------------------ random */
/** Seeded so regenerating the assets produces byte-identical output. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------- game maths */
/** radius = BASE_RADIUS + sqrt(score) * RADIUS_GROWTH, capped. (config.js) */
function radiusFor(score) {
  return Math.min(34, 9 + Math.sqrt(Math.max(0, score)) * 0.32);
}
/** SEGMENTS_BASE + score * SEGMENTS_PER_SCORE. (config.js) */
function segmentsFor(score) {
  return Math.round(12 + Math.max(0, score) * 0.42);
}

/* --------------------------------------------------------------- hex field */
/**
 * The baked arena background: flat colour plus a hex lattice, exactly the
 * lattice bakeBackground() draws — flat-top hexes on a 1.5r / sqrt(3)r grid.
 */
function hexField(ctx, w, h, size, ox, oy) {
  ctx.fillStyle = THEME.arena;
  ctx.fillRect(0, 0, w, h);

  const dx = size * 1.5;
  const dy = size * Math.sqrt(3);
  const cols = Math.ceil(w / dx) + 2;
  const rows = Math.ceil(h / dy) + 2;

  ctx.beginPath();
  for (let c = -1; c < cols; c++) {
    for (let r = -1; r < rows; r++) {
      const cx = c * dx + (ox || 0);
      const cy = r * dy + (c % 2 === 0 ? 0 : dy / 2) + (oy || 0);
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const x = cx + Math.cos(a) * size;
        const y = cy + Math.sin(a) * size;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  }
  ctx.strokeStyle = THEME.hexLine;
  ctx.lineWidth = Math.max(1, size / 19);
  ctx.stroke();
}

/* ------------------------------------------------------------------ skins */
const skinById = {};
SKINS.forEach(function (s) { skinById[s.id] = s; });
function skin(id) { return skinById[id]; }

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(function (c) { return c + c; }).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const p = function (i) { return Math.round(ca[i] + (cb[i] - ca[i]) * t); };
  return 'rgb(' + p(0) + ',' + p(1) + ',' + p(2) + ')';
}
function sampleGradient(stops, t) {
  const c = Math.max(0, Math.min(1, t));
  const span = 1 / (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(c / span));
  return mix(stops[idx], stops[idx + 1], (c - idx * span) / span);
}

/** Port of src/game/skins.ts beadColors(). */
function beadColors(sk, baseColor, beads) {
  if (beads <= 0) return [];
  const pattern = sk && sk.pattern && sk.pattern.length ? sk.pattern : [baseColor];
  const STEPS = 6;

  if (sk && sk.mode === 'gradient' && pattern.length > 1) {
    const steps = [];
    for (let i = 0; i < STEPS; i++) steps.push(sampleGradient(pattern, i / (STEPS - 1)));
    return Array.from({ length: beads }, function (_, i) {
      const t = beads === 1 ? 0 : i / (beads - 1);
      return steps[Math.min(STEPS - 1, Math.round(t * (STEPS - 1)))];
    });
  }
  // Same fixed stripe width as skins.ts — alternating every single bead
  // reads as flicker, not a pattern.
  const STRIPE_WIDTH = 3;
  return Array.from({ length: beads }, function (_, i) {
    return pattern[Math.floor(i / STRIPE_WIDTH) % pattern.length];
  });
}

/* ------------------------------------------------------------------ bodies */
/**
 * A body as the server would store it: points spaced SEGMENT_SPACING apart,
 * head first, walking backwards from the head along a smoothly turning heading.
 */
function snakeBody(o) {
  const pts = [];
  let x = o.x, y = o.y, a = o.angle;
  const n = o.count;
  const spacing = o.spacing == null ? 9 : o.spacing;
  for (let i = 0; i < n; i++) {
    pts.push({ x: x, y: y });
    const t = i / n;
    const wobble = Math.sin(i * (o.freq || 0.16) + (o.phase || 0)) * (o.wobble || 0);
    const curl = (o.curl || 0) * (o.curlRamp ? t : 1);
    a += wobble + curl;
    x -= Math.cos(a) * spacing;
    y -= Math.sin(a) * spacing;
  }
  return pts;
}

/**
 * A body that follows a hand-drawn centreline.
 *
 * `snakeBody` is right for filling an arena with plausible snakes, but a
 * composition — the icon especially — needs the pose art-directed, not
 * searched for. This takes control points head-first, runs a Catmull-Rom
 * spline through them and resamples it at the server's segment spacing, so the
 * result is still a body the renderer treats identically to a real one.
 */
function curveBody(control, spacing) {
  // Duplicate the ends so the spline actually reaches the first and last point.
  const c = [control[0]].concat(control, [control[control.length - 1]]);
  const dense = [];
  const STEPS = 220;
  for (let i = 0; i < c.length - 3; i++) {
    const [p0, p1, p2, p3] = [c[i], c[i + 1], c[i + 2], c[i + 3]];
    for (let j = 0; j < STEPS; j++) {
      const t = j / STEPS, t2 = t * t, t3 = t2 * t;
      dense.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  dense.push(c[c.length - 2]);

  // Resample at even arc length — the spline is fast through straights and
  // slow through corners, and evenly-spaced beads are the whole look.
  const out = [dense[0]];
  let carry = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i];
    let seg = Math.hypot(b.x - a.x, b.y - a.y);
    let t = 0;
    while (carry + seg >= spacing) {
      const need = (spacing - carry) / seg;
      t += need * (1 - t);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      seg -= spacing - carry;
      carry = 0;
    }
    carry += seg;
  }
  return out;
}

/** Heading of a body at the head, in canvas radians. */
function headAngle(points) {
  const a = points[Math.min(3, points.length - 1)];
  return Math.atan2(points[0].y - a.y, points[0].x - a.x);
}

/** Bounding box of a body, including the bead radius. */
function bodyBounds(points, radius) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0 - radius, y: y0 - radius, w: x1 - x0 + radius * 2, h: y1 - y0 + radius * 2 };
}

/**
 * One snake, drawn the way GameCanvas draws it: a tail-first pass of outlined
 * beads batched per colour, then the head, ears, muzzle and eyes on top.
 *
 * `opts.outline` / `opts.outlineWidth` exist because the arena's near-invisible
 * 22%-navy contact shadow is right in-game and far too weak for an app icon.
 */
function drawSnake(ctx, s, opts) {
  opts = opts || {};
  const pts = s.points;
  if (pts.length < 2) return;
  const r = s.radius;
  const colors = beadColors(s.skin, s.color, pts.length);

  // Beads must overlap or the body reads as a dotted line. The game steps
  // ~0.5r, which scallops the silhouette; a still can afford 0.3r.
  const stride = Math.max(1, Math.round((r * 0.3) / (s.spacing || 9)));
  const xs = [], ys = [], idx = [];
  for (let i = pts.length - 1; i >= 0; i -= stride) {
    xs.push(pts[i].x); ys.push(pts[i].y); idx.push(i);
  }

  const ow = opts.outlineWidth == null ? 2 : opts.outlineWidth;
  ctx.fillStyle = opts.outline || 'rgba(0,45,65,0.22)';
  ctx.beginPath();
  for (let k = 0; k < xs.length; k++) {
    ctx.moveTo(xs[k] + r + ow, ys[k]);
    ctx.arc(xs[k], ys[k], r + ow, 0, Math.PI * 2);
  }
  ctx.fill();

  if (s.boosting) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    for (let k = 0; k < xs.length; k++) {
      ctx.moveTo(xs[k] + r + ow + 6, ys[k]);
      ctx.arc(xs[k], ys[k], r + ow + 6, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Body: one path per colour the skin actually uses.
  const byColor = new Map();
  for (let k = 0; k < xs.length; k++) {
    const c = colors[idx[k]] || s.color;
    if (!byColor.has(c)) byColor.set(c, []);
    byColor.get(c).push(k);
  }
  byColor.forEach(function (ks, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    for (const k of ks) { ctx.moveTo(xs[k] + r, ys[k]); ctx.arc(xs[k], ys[k], r, 0, Math.PI * 2); }
    ctx.fill();
  });

  // Scales: mirrors GameCanvas.tsx — a lighter disc pushed toward the head on
  // each bead, leaving the base colour as a crescent at the trailing edge.
  // Kept in step with the game renderer so a preview is not a lie.
  if (s.skin && s.skin.scales) {
    const SCALE_OFFSET = 0.34, SCALE_RADIUS = 0.72, SCALE_PITCH = 0.95;
    const byScale = new Map();
    let lastX = Infinity, lastY = Infinity;
    const pitch = r * SCALE_PITCH;
    for (let k = 0; k < xs.length; k++) {
      if (Math.hypot(xs[k] - lastX, ys[k] - lastY) < pitch) continue;
      lastX = xs[k]; lastY = ys[k];
      const i = idx[k];
      const ahead = pts[Math.max(0, i - 1)];
      const here = pts[i];
      let dx = ahead.x - here.x, dy = ahead.y - here.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
      const base = colors[i] || s.color;
      const c = (s.skin.scales.tint) || mix(base, '#FFFFFF', 0.26);
      if (!byScale.has(c)) byScale.set(c, []);
      byScale.get(c).push([xs[k] + dx * r * SCALE_OFFSET, ys[k] + dy * r * SCALE_OFFSET]);
    }
    byScale.forEach(function (ps, c) {
      ctx.fillStyle = c;
      ctx.beginPath();
      for (const [x, y] of ps) { ctx.moveTo(x + r * SCALE_RADIUS, y); ctx.arc(x, y, r * SCALE_RADIUS, 0, Math.PI * 2); }
      ctx.fill();
    });
  }

  // A top-light over the whole snake. Doing this per bead scallops the body
  // into visible scales — the highlights overlap where the beads do — so the
  // union of the beads is used as a clip and one gradient is laid over it.
  if (opts.gloss !== false) {
    let y0 = Infinity, y1 = -Infinity;
    for (const y of ys) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    ctx.save();
    ctx.beginPath();
    for (let k = 0; k < xs.length; k++) {
      ctx.moveTo(xs[k] + r, ys[k]);
      ctx.arc(xs[k], ys[k], r, 0, Math.PI * 2);
    }
    ctx.clip();
    const g = ctx.createLinearGradient(0, y0 - r, 0, y1 + r);
    g.addColorStop(0, 'rgba(255,255,255,0.30)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,40,60,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(xs.reduce((a, b) => Math.min(a, b), Infinity) - r, y0 - r,
                 xs.reduce((a, b) => Math.max(a, b), -Infinity) - xs.reduce((a, b) => Math.min(a, b), Infinity) + r * 2,
                 y1 - y0 + r * 2);
    ctx.restore();
  }

  drawHead(ctx, s, colors[0] || s.color, opts);
}

function drawHead(ctx, s, headColor, opts) {
  const r = s.radius;
  const hx = s.points[0].x, hy = s.points[0].y;
  const ang = s.angle;
  const perp = ang + Math.PI / 2;
  const ow = opts.outlineWidth == null ? 2 : opts.outlineWidth;
  const sk = s.skin;
  const circle = function (x, y, rad, fill) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  };

  // Ears sit behind the head so they read as poking out from it.
  const ears = sk && sk.ears;
  if (ears) {
    const long = ears.shape === 'long';
    const earR = r * (long ? 0.62 : 0.78);
    const outAmt = r * (long ? 0.5 : 0.85);
    const backAmt = r * (long ? 0.1 : 0.3);
    for (const side of [1, -1]) {
      const bx = hx + Math.cos(perp) * outAmt * side - Math.cos(ang) * backAmt;
      const by = hy + Math.sin(perp) * outAmt * side - Math.sin(ang) * backAmt;
      if (long) {
        for (let k = 0; k < 3; k++) {
          const t = k * earR * 0.72;
          circle(bx - Math.cos(ang) * t, by - Math.sin(ang) * t, earR * (1 - k * 0.12), ears.color);
        }
      } else {
        circle(bx, by, earR, ears.color);
      }
      if (ears.inner) circle(bx, by, earR * 0.5, ears.inner);
    }
  }

  // Tongue, on the icon only — a flicking fork sells "snake" at 40px in a way
  // that a plain round head does not.
  if (opts.tongue) {
    const tl = r * (opts.tongue === true ? 1.55 : opts.tongue);
    ctx.strokeStyle = '#0E2B3A';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? '#F0426A' : '#0E2B3A';
      ctx.lineWidth = r * (pass ? 0.17 : 0.3);
      for (const side of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(ang) * r * 0.7, hy + Math.sin(ang) * r * 0.7);
        ctx.lineTo(hx + Math.cos(ang) * tl * 0.82, hy + Math.sin(ang) * tl * 0.82);
        ctx.lineTo(
          hx + Math.cos(ang) * tl + Math.cos(perp) * r * 0.34 * side,
          hy + Math.sin(ang) * tl + Math.sin(perp) * r * 0.34 * side
        );
        ctx.stroke();
      }
    }
  }

  circle(hx, hy, r + ow, opts.outline || 'rgba(0,45,65,0.22)');
  circle(hx, hy, r, headColor);
  if (opts.gloss !== false) {
    ctx.save();
    ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.clip();
    const hg = ctx.createLinearGradient(0, hy - r, 0, hy + r);
    hg.addColorStop(0, 'rgba(255,255,255,0.34)');
    hg.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    hg.addColorStop(1, 'rgba(0,40,60,0.12)');
    ctx.fillStyle = hg;
    ctx.fillRect(hx - r, hy - r, r * 2, r * 2);
    ctx.restore();
  }

  // A pale muzzle on the animal skins.
  if (sk && sk.belly) {
    circle(hx + Math.cos(ang) * r * 0.24, hy + Math.sin(ang) * r * 0.24, r * 0.6, sk.belly);
  }

  if (s.isLocal) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2 * (opts.uiScale || 1);
    ctx.beginPath(); ctx.arc(hx, hy, r + 5 * (opts.uiScale || 1), 0, Math.PI * 2); ctx.stroke();
  }

  // The icon overrides these: googly eyes that bulge past the silhouette are
  // right at 1024px and turn to mush at 48px.
  const big = (sk && sk.eyes === 'big') || opts.bigEyes;
  const eyeOut = r * (opts.eyeOut || (big ? 0.42 : 0.46));
  const eyeFwd = r * (opts.eyeFwd == null ? 0.4 : opts.eyeFwd);
  const eyeR = Math.max(2, r * (opts.eyeR || (big ? 0.44 : 0.34)));
  const pupilR = eyeR * 0.5;
  for (const side of [1, -1]) {
    const ex = hx + Math.cos(perp) * eyeOut * side + Math.cos(ang) * eyeFwd;
    const ey = hy + Math.sin(perp) * eyeOut * side + Math.sin(ang) * eyeFwd;
    if (opts.eyeOutline) circle(ex, ey, eyeR + ow * 0.8, opts.outline);
    circle(ex, ey, eyeR, (sk && sk.eyeColor) || '#FFFFFF');
    circle(ex + Math.cos(ang) * eyeR * 0.36, ey + Math.sin(ang) * eyeR * 0.36, pupilR, '#20272E');
    // Catchlight — the one liberty taken over the in-game head.
    if (opts.gloss !== false) {
      circle(ex - Math.cos(ang) * eyeR * 0.3 - eyeR * 0.18, ey - eyeR * 0.34, eyeR * 0.2, 'rgba(255,255,255,0.95)');
    }
  }
}

/** Food pellets, batched per palette colour like the game does. */
function drawPellets(ctx, list) {
  const byColor = new Map();
  for (const f of list) {
    if (!byColor.has(f.color)) byColor.set(f.color, []);
    byColor.get(f.color).push(f);
  }
  byColor.forEach(function (fs, c) {
    ctx.fillStyle = c;
    ctx.beginPath();
    for (const f of fs) { ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); }
    ctx.fill();
  });
}

/** Scatter pellets over a rect, avoiding a list of {x,y,r} keep-out circles. */
function scatterPellets(rand, w, h, n, r, avoid) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 40) {
    const x = rand() * w, y = rand() * h;
    let ok = true;
    for (const a of avoid || []) {
      if (Math.hypot(x - a.x, y - a.y) < a.r) { ok = false; break; }
    }
    if (!ok) continue;
    out.push({ x: x, y: y, r: r * (rand() < 0.12 ? 1.6 : 1), color: COLORS[Math.floor(rand() * COLORS.length)] });
  }
  return out;
}

/** Chunky white type with the navy drop-outline the game's HUD uses. */
function outlinedText(ctx, text, x, y, size, opts) {
  opts = opts || {};
  ctx.save();
  ctx.font = '900 ' + size + 'px ' + (opts.font || '"SF Pro Display", -apple-system, "Helvetica Neue", Arial, sans-serif');
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = opts.baseline || 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (opts.shadow !== false) {
    ctx.strokeStyle = opts.outline || '#0E2B3A';
    ctx.lineWidth = size * (opts.outlineWidth || 0.16);
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.color || '#FFFFFF';
  ctx.fillText(text, x, y);
  ctx.restore();
}
