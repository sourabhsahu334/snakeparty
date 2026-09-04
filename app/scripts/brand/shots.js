/**
 * The store screenshots and the Play feature graphic.
 *
 * Every scene is composed at the app's own dp values — 132dp joystick, 34dp
 * score, 132dp leaderboard panel — and then scaled by the device pixel ratio,
 * so the HUD in a screenshot lands where the HUD lands on a real phone. The
 * numbers here are lifted from src/screens/GameScreen.tsx and
 * src/game/Controls.tsx; when those styles change, change these.
 *
 * Scene rules, which matter more than the drawing: a store listing may only
 * show what the build does. 1.0.0 ships with multiplayer dark, so nothing here
 * shows a room code or a friend. Solo does run bots and does keep a
 * leaderboard, so those are fair game.
 */

/* ------------------------------------------------------------------ shared */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function text(ctx, str, x, y, size, opts) {
  opts = opts || {};
  ctx.save();
  ctx.font = (opts.weight || '700') + ' ' + size + 'px "SF Pro Display", -apple-system, "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = opts.baseline || 'middle';
  if (opts.tracking) ctx.letterSpacing = opts.tracking + 'px';
  ctx.fillStyle = opts.color || THEME.ink;
  ctx.fillText(str, x, y);
  ctx.restore();
}

/** The arena as GameCanvas bakes it: flat colour, hex lattice, vignette. */
function arena(ctx, w, h, seed) {
  ctx.fillStyle = THEME.arena;
  ctx.fillRect(0, 0, w, h);
  hexField(ctx, w, h, 34, -12 * (seed % 3), -9 * (seed % 5));

  const g = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.12, w / 2, h * 0.5, h * 1.05);
  g.addColorStop(0, 'rgba(220,249,255,0.30)');
  g.addColorStop(0.55, 'rgba(150,222,240,0.05)');
  g.addColorStop(1, 'rgba(20,84,112,0.34)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * A snake posed in camera space.
 *
 * Radius and segment count are camera-space values, not raw score outputs: the
 * real game zooms the camera out as you grow, so a 900-point snake is ~18dp
 * across on screen rather than the 400 segments segmentsFor() would return.
 */
function arenaSnake(o) {
  const pts = snakeBody({
    x: o.x, y: o.y, angle: o.angle, count: o.count,
    spacing: o.spacing || o.radius * 0.52,
    wobble: o.wobble == null ? 0.05 : o.wobble,
    freq: o.freq || 0.16,
    phase: o.phase || 0,
    curl: o.curl || 0,
    curlRamp: o.curlRamp,
  });
  return {
    points: pts,
    radius: o.radius,
    angle: headAngle(pts),
    color: o.color,
    skin: skin(o.skin),
    spacing: o.spacing || o.radius * 0.52,
  };
}

/**
 * An art-directed snake: control points in fractions of the frame, head first.
 *
 * `arenaSnake` walks a heading and lands wherever it lands, which is right for
 * background bots and wrong for the one snake the shot is about — that one has
 * to stay inside the frame and out from under the joystick.
 */
function posed(w, h, control, o) {
  const spacing = o.spacing || o.radius * 0.52;
  const pts = curveBody(control.map(function (p) {
    return { x: p[0] * w, y: p[1] * h };
  }), spacing);
  const cut = o.count ? pts.slice(0, o.count) : pts;
  return {
    points: cut,
    radius: o.radius,
    angle: headAngle(cut),
    color: o.color,
    skin: skin(o.skin),
    spacing: spacing,
  };
}

const SNAKE_OPTS = { outline: 'rgba(0,45,65,0.22)', outlineWidth: 2.5, bigEyes: false };

/** Rect overlap, for keeping bots and pellets off the HUD. */
function hits(b, rects) {
  for (const r of rects) {
    if (b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) return true;
  }
  return false;
}

/**
 * The boxes the HUD occupies, in dp.
 *
 * A bot that ends up under the leaderboard or behind the boost pad makes the
 * shot look like a rendering bug rather than a busy arena, so everything
 * decorative is placed around these.
 */
function hudBoxes(w, h) {
  return [
    { x: 0, y: 0, w: 200, h: 44 },              // solo pill + gear
    { x: w / 2 - 90, y: 0, w: 180, h: 56 },     // score
    { x: w - 152, y: 0, w: 152, h: 116 },       // leaderboard
    { x: 0, y: h - 160, w: 190, h: 160 },       // joystick
    { x: w - 130, y: h - 130, w: 130, h: 130 }, // boost pad
    { x: w / 2 - 340, y: h - 170, w: 680, h: 170 }, // caption
  ];
}

/* --------------------------------------------------------------------- HUD */

/** Score, dead centre at the top. 34dp, white, navy drop-outline. */
function hudScore(ctx, w, value, top) {
  outlinedText(ctx, String(value), w / 2, top + 6 + 17, 34, {
    outline: 'rgba(6,44,60,0.95)',
    outlineWidth: 0.14,
  });
}

/** The 'SOLO RUN' pill, top-left. */
function hudPill(ctx, x, y, label) {
  ctx.save();
  ctx.font = '900 12px "SF Pro Display", -apple-system, Arial, sans-serif';
  ctx.letterSpacing = '1px';
  const w = ctx.measureText(label).width + 24;
  ctx.fillStyle = 'rgba(6,44,60,0.32)';
  roundRect(ctx, x, y, w, 22, 11);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 12, y + 11.5);
  ctx.restore();
  return w;
}

/** The settings gear, a 30dp translucent disc. */
function hudGear(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,44,60,0.32)';
  ctx.beginPath();
  ctx.arc(x + 15, y + 15, 15, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, '⚙', x + 15, y + 15.5, 15, { align: 'center', color: '#FFFFFF', weight: '900' });
  ctx.restore();
}

/**
 * The leaderboard panel, top-right. `rows` is [rank, name, score] and `mine`
 * is the pinned dark row the real HUD adds when you are off the bottom.
 */
function hudBoard(ctx, right, top, rows, mine) {
  const W = 132;
  const rowH = 13;
  const h = 8 + rows.length * rowH + (mine ? rowH + 7 : 0);
  const x = right - W;

  ctx.save();
  ctx.fillStyle = THEME.panel;
  roundRect(ctx, x, top, W, h, 10);
  ctx.fill();

  let y = top + 4 + rowH / 2;
  for (const r of rows) {
    text(ctx, r[0] === 1 ? '👑' : String(r[0]), x + 7, y, 10, { color: THEME.inkDim, weight: '700' });
    text(ctx, r[1], x + 22, y, 10, { color: THEME.ink, weight: '500' });
    text(ctx, String(r[2]), x + W - 7, y, 10, { color: THEME.ink, weight: '700', align: 'right' });
    y += rowH;
  }

  if (mine) {
    ctx.fillStyle = THEME.ink;
    roundRect(ctx, x + 4, y - rowH / 2 + 1, W - 8, rowH + 4, 7);
    ctx.fill();
    const my = y + 2;
    text(ctx, String(mine[0]), x + 10, my, 10, { color: '#FFFFFF', weight: '700' });
    text(ctx, mine[1], x + 25, my, 10, { color: '#FFFFFF', weight: '500' });
    text(ctx, String(mine[2]), x + W - 10, my, 10, { color: '#FFFFFF', weight: '700', align: 'right' });
  }
  ctx.restore();
}

/** The 132dp joystick, bottom-left, knob pushed toward `angle`. */
function hudStick(ctx, cx, cy, angle) {
  const R = 66;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, R - 1.5, 0, Math.PI * 2); ctx.stroke();

  const off = 39; // (STICK_SIZE - KNOB_SIZE) / 2
  const kx = cx + Math.cos(angle) * off;
  const ky = cy + Math.sin(angle) * off;
  ctx.fillStyle = 'rgba(11,58,74,0.25)';
  ctx.beginPath(); ctx.arc(kx, ky + 3, 27, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(kx, ky, 27, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** The 72x80dp boost pad, bottom-right. */
function hudBoost(ctx, cx, cy, active) {
  ctx.save();
  ctx.fillStyle = active ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.14)';
  ctx.strokeStyle = active ? '#FFFFFF' : 'rgba(255,255,255,0.72)';
  ctx.lineWidth = 2.5;
  roundRect(ctx, cx - 36, cy - 40, 72, 80, 19);
  ctx.fill();
  ctx.stroke();

  text(ctx, '▲', cx, cy - 12, 21, { align: 'center', color: '#FFFFFF', weight: '900' });
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy + 6 + i * 7, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The listing caption.
 *
 * Big enough to survive the Play grid, where a phone screenshot is shown about
 * 160px wide — at that size anything under ~26dp of type is a grey smear.
 */
function caption(ctx, w, y, line, sub) {
  outlinedText(ctx, line, w / 2, y, 30, {
    outline: 'rgba(6,44,60,0.92)',
    outlineWidth: 0.2,
  });
  if (sub) {
    outlinedText(ctx, sub, w / 2, y + 26, 14, {
      outline: 'rgba(6,44,60,0.85)',
      outlineWidth: 0.24,
      color: 'rgba(255,255,255,0.94)',
    });
  }
}

/* ------------------------------------------------------------------ scenes */

/** Bots scattered through the arena, behind the player. */
function bots(ctx, w, h, seed, n, avoid) {
  const rand = rng(seed);
  const keepOut = hudBoxes(w, h).concat(avoid || []);
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 60) {
    const radius = 8 + rand() * 6;
    const s = arenaSnake({
      x: 60 + rand() * (w - 120),
      y: 60 + rand() * (h - 120),
      angle: rand() * Math.PI * 2,
      count: 18 + Math.floor(rand() * 22),
      radius: radius,
      color: COLORS[Math.floor(rand() * COLORS.length)],
      skin: SKINS[Math.floor(rand() * SKINS.length)].id,
      phase: rand() * 6,
      curl: (rand() - 0.5) * 0.06,
    });
    const b = bodyBounds(s.points, radius);
    // Off the edge reads as a clipping bug at this size; on the HUD reads worse.
    if (b.x < 8 || b.y < 8 || b.x + b.w > w - 8 || b.y + b.h > h - 8) continue;
    if (hits(b, keepOut)) continue;
    keepOut.push(b);
    out.push(s);
  }
  for (const s of out) drawSnake(ctx, s, SNAKE_OPTS);
  return out;
}

const SCENE = {
  /* ---------------------------------------------------------------- hero */
  hero(ctx, w, h) {
    arena(ctx, w, h, 1);
    const rand = rng(7);

    // A sweep from lower-left to upper-right, head lunging at the food it is
    // about to reach — the one frame that says what the game is.
    const hero = posed(w, h, [
      [0.62, 0.30], [0.50, 0.28], [0.40, 0.38], [0.36, 0.53], [0.28, 0.64], [0.17, 0.66],
    ], { radius: 19, color: COLORS[0], skin: 'ember' });

    bots(ctx, w, h, 3, 4, [bodyBounds(hero.points, 19 + 24)]);

    drawPellets(ctx, scatterPellets(rand, w, h, 46, 4.5,
      [{ x: hero.points[0].x, y: hero.points[0].y, r: 46 }]));
    // The pellet the head is going for, big and dead ahead.
    drawPellets(ctx, [{ x: w * 0.70, y: h * 0.25, r: 9, color: COLORS[6] }]);

    drawSnake(ctx, hero, SNAKE_OPTS);

    hudPill(ctx, 12, 10, 'SOLO RUN');
    hudGear(ctx, 96, 8);
    hudScore(ctx, w, 1240, 6);
    hudBoard(ctx, w - 10, 8, [
      [1, 'You', 1240], [2, 'Mamba', 980], [3, 'Viper', 742],
      [4, 'Noodle', 610], [5, 'Coil', 455], [6, 'Fang', 288],
    ]);
    hudStick(ctx, 16 + 66, h - 14 - 66, -0.6);
    hudBoost(ctx, w - 16 - 36, h - 14 - 40, false);

    caption(ctx, w, h - 118, 'A whole arena in your pocket', 'No signup. No wifi needed.');
  },

  /* --------------------------------------------------------------- boost */
  boost(ctx, w, h) {
    arena(ctx, w, h, 2);
    const rand = rng(21);

    // Running flat out to the left, body strung out behind — a boosting snake
    // is straighter than a cruising one.
    const hero = posed(w, h, [
      [0.30, 0.36], [0.44, 0.34], [0.58, 0.40], [0.70, 0.52], [0.80, 0.60],
    ], { radius: 21, color: COLORS[7], skin: 'toxic' });

    bots(ctx, w, h, 11, 3, [bodyBounds(hero.points, 21 + 30)]);
    drawPellets(ctx, scatterPellets(rand, w, h, 38, 4.5,
      [{ x: hero.points[0].x, y: hero.points[0].y, r: 60 }]));

    // Speed lines: the boost trail, drawn along the body's own heading.
    // What boosting actually looks like: BOOST_TRAIL_EVERY drops a pellet at the
    // tail every 22 world units, so the cost of the speed is lying on the floor
    // behind you. Drawn before the snake, so the tail sits on top of it.
    const tail = hero.points[hero.points.length - 1];
    const prev = hero.points[hero.points.length - 4];
    const ta = Math.atan2(tail.y - prev.y, tail.x - prev.x);
    const drops = [];
    for (let i = 1; i <= 9; i++) {
      const d = i * 26;
      drops.push({
        x: tail.x + Math.cos(ta) * d + Math.sin(ta) * Math.sin(i) * 7,
        y: tail.y + Math.sin(ta) * d - Math.cos(ta) * Math.sin(i) * 7,
        r: 5.5,
        color: COLORS[7],
      });
    }
    drawPellets(ctx, drops);

    // A short white wake off the head, where the speed reads.
    ctx.save();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineCap = 'round';
    const ha = hero.angle;
    for (let i = 0; i < 6; i++) {
      const side = (i % 2 ? 1 : -1) * (26 + (i % 3) * 7);
      const back = 18 + i * 16;
      const nx = Math.cos(ha + Math.PI / 2), ny = Math.sin(ha + Math.PI / 2);
      const ox = hero.points[0].x - Math.cos(ha) * back + nx * side;
      const oy = hero.points[0].y - Math.sin(ha) * back + ny * side;
      ctx.lineWidth = 4 - i * 0.4;
      ctx.globalAlpha = 0.55 - i * 0.07;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox - Math.cos(ha) * (46 - i * 4), oy - Math.sin(ha) * (46 - i * 4));
      ctx.stroke();
    }
    ctx.restore();

    drawSnake(ctx, hero, SNAKE_OPTS);

    hudPill(ctx, 12, 10, 'SOLO RUN');
    hudGear(ctx, 96, 8);
    hudScore(ctx, w, 2115, 6);
    hudBoard(ctx, w - 10, 8, [
      [1, 'You', 2115], [2, 'Rattle', 1408], [3, 'Python', 1120],
      [4, 'Hiss', 863], [5, 'Twist', 590],
    ]);
    hudStick(ctx, 16 + 66, h - 14 - 66, Math.PI - 0.4);
    hudBoost(ctx, w - 16 - 36, h - 14 - 40, true);

    caption(ctx, w, h - 118, 'Burn score for speed', 'Boost to cut them off — it costs you length.');
  },

  /* ---------------------------------------------------------------- grow */
  grow(ctx, w, h) {
    arena(ctx, w, h, 4);
    const rand = rng(33);

    // Fat and long enough to fill the frame: this is the shot that has to make
    // 6,480 points look like 6,480 points.
    const hero = posed(w, h, [
      [0.30, 0.24], [0.46, 0.22], [0.60, 0.30], [0.66, 0.46], [0.58, 0.60],
      [0.42, 0.64], [0.30, 0.58], [0.24, 0.44],
    ], { radius: 27, color: COLORS[10], skin: 'rainbow' });

    bots(ctx, w, h, 44, 3, [bodyBounds(hero.points, 27 + 26)]);
    drawPellets(ctx, scatterPellets(rand, w, h, 30, 5,
      [{ x: hero.points[0].x, y: hero.points[0].y, r: 70 }]));
    drawSnake(ctx, hero, SNAKE_OPTS);

    hudPill(ctx, 12, 10, 'SOLO RUN');
    hudGear(ctx, 96, 8);
    hudScore(ctx, w, 6480, 6);
    hudBoard(ctx, w - 10, 8, [
      [1, 'You', 6480], [2, 'Serpent', 2240], [3, 'Cobra', 1755],
      [4, 'Scales', 1190], [5, 'Ribbon', 902], [6, 'Loop', 664],
    ]);
    hudStick(ctx, 16 + 66, h - 14 - 66, 0.5);
    hudBoost(ctx, w - 16 - 36, h - 14 - 40, false);

    caption(ctx, w, h - 118, 'Eat. Grow. Take the top spot.', 'Bots fight back — the board is never yours for long.');
  },

  /* --------------------------------------------------------------- skins */
  skins(ctx, w, h) {
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
    hexField(ctx, w, h, 40, -10, -6);

    outlinedText(ctx, String(SKINS.length) + ' SNAKES TO WEAR', w / 2, 46, 34, {
      outline: THEME.outline, outlineWidth: 0.15,
    });
    outlinedText(ctx, 'Every one drawn in-engine. All free, all unlocked.', w / 2, 76, 14, {
      outline: THEME.outline, outlineWidth: 0.22, color: 'rgba(255,255,255,0.95)',
    });

    // The whole catalogue, 6 x 5, in catalogue order — so the sheet doubles as
    // a check that no skin renders wrong. Each body is centred in its cell and
    // named underneath; a label that drifts off its snake is worse than none.
    const cols = 6;
    const rows = Math.ceil(SKINS.length / cols);
    const gridTop = 104;
    const gridH = h - gridTop - 24;
    const cellW = w / cols;
    const cellH = gridH / rows;
    const bodyLen = Math.min(96, cellW - 46);

    for (let i = 0; i < SKINS.length; i++) {
      const cx = (i % cols) * cellW + cellW / 2;
      const cy = gridTop + Math.floor(i / cols) * cellH + cellH / 2 - 7;
      const sk = SKINS[i];

      const radius = Math.min(12, cellH * 0.17);
      const spacing = bodyLen / 14;
      const body = arenaSnake({
        x: cx - bodyLen / 2, y: cy, angle: Math.PI,
        count: 15, radius: radius, spacing: spacing,
        color: COLORS[i % COLORS.length], skin: sk.id,
        wobble: 0.13, freq: 0.55, phase: i * 1.7,
      });
      drawSnake(ctx, body, SNAKE_OPTS);

      outlinedText(ctx, sk.name, cx, cy + radius + 19, 13, {
        outline: THEME.outline, outlineWidth: 0.26,
      });
    }
  },

  /* ---------------------------------------------------------------- menu */
  menu(ctx, w, h) {
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
    hexField(ctx, w, h, 40, -10, -6);

    const padX = 34;
    const colW = (w - padX * 3) * 0.52;

    /* ---- left: who you are. Both columns centre vertically, as they do in
       HomeScreen — anchoring to the top leaves the shot bottom-heavy on a
       taller frame. */
    const blockH = 44 + 16 + 18 + 44 + 18 + 18 + 100;
    let y = (h - blockH) / 2;

    outlinedText(ctx, 'SNAKE PARTY', padX, y + 22, 42, {
      align: 'left', outline: THEME.outline, outlineWidth: 0.12,
    });
    y += 44 + 16;

    text(ctx, 'YOUR NAME', padX, y + 6, 12, { color: 'rgba(255,255,255,0.92)', weight: '800', tracking: 1 });
    y += 18;
    ctx.fillStyle = THEME.panelSolid;
    roundRect(ctx, padX, y, colW, 44, 14);
    ctx.fill();
    text(ctx, 'Sourabh', padX + 16, y + 23, 17, { color: THEME.ink, weight: '700' });
    y += 44 + 18;

    text(ctx, 'YOUR SNAKE', padX, y + 6, 12, { color: 'rgba(255,255,255,0.92)', weight: '800', tracking: 1 });
    y += 18;
    const pickerY = y;
    const pickerH = 100;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    roundRect(ctx, padX, pickerY, colW, pickerH, 14);
    ctx.fill();
    // Clip, so the preview body stops at the panel edge the way an overflow
    // hidden View does rather than crawling across the mode cards.
    ctx.clip();

    text(ctx, 'Tiger', padX + 16, pickerY + 26, 15, { color: THEME.ink, weight: '800' });
    const preview = arenaSnake({
      x: padX + colW - 96, y: pickerY + 28, angle: Math.PI,
      count: 14, radius: 12, spacing: 6.6,
      color: COLORS[0], skin: 'tiger', wobble: 0.14, freq: 0.5,
    });
    drawSnake(ctx, preview, SNAKE_OPTS);

    for (let i = 0; i < 8; i++) {
      const cx = padX + 26 + i * 30;
      ctx.fillStyle = COLORS[i];
      ctx.beginPath(); ctx.arc(cx, pickerY + 70, 10, 0, Math.PI * 2); ctx.fill();
      if (i === 0) {
        ctx.strokeStyle = THEME.ink;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, pickerY + 70, 14, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();

    /* ---- right: where you're going */
    const rx = padX * 2 + colW;
    const rw = w - rx - padX;
    const cardH = 84;
    modeCard(ctx, rx, h / 2 - cardH - 7, rw, cardH, {
      primary: true, icon: '▶', title: 'SINGLE PLAYER',
      blurb: 'Normal pace · 10 snakes · Normal arena',
    });
    modeCard(ctx, rx, h / 2 + 7, rw, cardH, {
      icon: '⚔️', title: 'MULTIPLAYER', tag: 'SOON',
      blurb: 'Rooms and friend codes land in the next update.',
    });
  },
};

/** One ModeCard from HomeScreen, at store scale. */
function modeCard(ctx, x, y, w, h, o) {
  ctx.save();
  ctx.fillStyle = o.primary ? THEME.accent : 'rgba(255,255,255,0.18)';
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  if (o.primary) {
    // The 4dp bottom border the real button carries.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    roundRect(ctx, x, y + h - 6, w, 6, 18);
    ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 18);
    ctx.stroke();
  }

  const badge = 40;
  ctx.fillStyle = o.primary ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.22)';
  roundRect(ctx, x + 16, y + h / 2 - badge / 2, badge, badge, 13);
  ctx.fill();
  text(ctx, o.icon, x + 16 + badge / 2, y + h / 2 + 1, 19, {
    align: 'center', weight: '900', color: o.primary ? THEME.accent : '#FFFFFF',
  });

  const tx = x + 16 + badge + 14;
  const titleSize = 19;
  text(ctx, o.title, tx, y + h / 2 - 12, titleSize, { color: '#FFFFFF', weight: '900', tracking: 0.5 });

  if (o.tag) {
    // Measured in the title's own font — measuring in whatever font happened to
    // be set is how the pill ended up on top of the word.
    ctx.save();
    ctx.font = '900 ' + titleSize + 'px "SF Pro Display", -apple-system, Arial, sans-serif';
    ctx.letterSpacing = '0.5px';
    const titleW = ctx.measureText(o.title).width;
    ctx.font = '900 11px "SF Pro Display", -apple-system, Arial, sans-serif';
    const tagW = ctx.measureText(o.tag).width + 14;
    const gx = tx + titleW + 10;
    ctx.fillStyle = THEME.gold;
    roundRect(ctx, gx, y + h / 2 - 21, tagW, 18, 5);
    ctx.fill();
    ctx.fillStyle = THEME.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(o.tag, gx + 7, y + h / 2 - 11.5);
    ctx.restore();
  }

  text(ctx, o.blurb, tx, y + h / 2 + 14, 14, {
    color: o.primary ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.86)', weight: '600',
  });
  ctx.restore();
}

/**
 * `drawShot` is the entry point gen-store-assets.js calls. Everything above
 * works in dp; the scale here is the only place the device ratio appears.
 */
function drawShot(ctx, scene, cssW, cssH, dpr) {
  ctx.save();
  ctx.scale(dpr, dpr);
  const fn = SCENE[scene];
  if (!fn) throw new Error('unknown scene: ' + scene);
  fn(ctx, cssW, cssH);
  ctx.restore();
}

/* -------------------------------------------------------- feature graphic */

/**
 * 1024x500, the Play listing banner.
 *
 * Play crops this hard on some surfaces and overlays the app icon on others,
 * so the wordmark sits left of centre and the right third carries only art.
 */
function drawFeatureGraphic(ctx, w, h) {
  ctx.fillStyle = THEME.arena;
  ctx.fillRect(0, 0, w, h);
  hexField(ctx, w, h, 46, -14, -8);

  const g = ctx.createRadialGradient(w * 0.34, h * 0.44, 40, w * 0.4, h * 0.5, w * 0.8);
  g.addColorStop(0, 'rgba(220,249,255,0.55)');
  g.addColorStop(0.5, 'rgba(150,222,240,0.16)');
  g.addColorStop(1, 'rgba(20,84,112,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const rand = rng(99);

  // Both snakes are posed to stay inside the frame. A body that runs off the
  // edge reads as a crop accident in a banner this short, and Play scales it
  // down further on some surfaces.
  const hero = posed(w, h, [
    [0.575, 0.28], [0.70, 0.20], [0.83, 0.28], [0.88, 0.46],
    [0.82, 0.64], [0.69, 0.72], [0.575, 0.68],
  ], { radius: 25, color: COLORS[0], skin: 'ember' });

  const chaser = posed(w, h, [
    [0.47, 0.80], [0.58, 0.86], [0.70, 0.82], [0.79, 0.86],
  ], { radius: 13, color: COLORS[2], skin: 'toxic' });

  drawPellets(ctx, scatterPellets(rand, w, h, 26, 6,
    [{ x: w * 0.30, y: h * 0.5, r: 250 }]));

  drawSnake(ctx, chaser, SNAKE_OPTS);
  drawSnake(ctx, hero, { outline: '#0E2B3A', outlineWidth: 4 });

  outlinedText(ctx, 'SNAKE', 62, h * 0.40, 92, {
    align: 'left', outline: '#0E2B3A', outlineWidth: 0.13,
  });
  outlinedText(ctx, 'PARTY', 62, h * 0.40 + 84, 92, {
    align: 'left', outline: '#0E2B3A', outlineWidth: 0.13, color: THEME.gold,
  });
  outlinedText(ctx, String(SKINS.length) + ' SKINS  ·  NO ADS', 66, h * 0.40 + 150, 20, {
    align: 'left', outline: '#0E2B3A', outlineWidth: 0.24, color: '#FFFFFF',
  });
}
