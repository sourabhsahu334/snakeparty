/**
 * The app icon.
 *
 * Composed in a 1000x1000 design space and scaled to whatever size is asked
 * for, so one composition serves the 1024 store icon, the Android adaptive
 * foreground and a 48px favicon. Look at the 48px render before changing
 * anything — that is where icons actually live.
 *
 * `mode` is one of:
 *   full        opaque square — iOS, the store listings, the web favicon
 *   round       the same, circle-masked, for Android's legacy round launcher
 *   foreground  transparent; the Android adaptive foreground layer, where
 *               everything shrinks into the centre 66% safe zone
 *   background  the backdrop alone, full bleed — the adaptive background layer,
 *               so Android shows the same cyan arena as iOS instead of a flat
 *               colour behind the snake
 */

/** How much of the frame the body may occupy, leaving room for the food. */
const ICON_FILL = 0.7;

/**
 * The pose, drawn rather than tuned: head high on the left looking up out of
 * the frame, body sweeping right, down the right side and back along the
 * bottom. It fills a square evenly, keeps a clear gap between the two arms,
 * and leaves the top-left corner open for the food the head is lunging at.
 * Head first, in design-space units.
 */
const ICON_POSE = [
  { x: 318, y: 288 },
  { x: 502, y: 400 },
  { x: 700, y: 470 },
  { x: 714, y: 676 },
  { x: 500, y: 754 },
  { x: 286, y: 700 },
];

function drawIcon(ctx, size, mode) {
  const S = size / 1000;
  const px = function (v) { return v * S; };
  const foreground = mode === 'foreground';

  ctx.save();
  ctx.clearRect(0, 0, size, size);

  // Mask before anything is drawn, so the hex field and the gradient stop at
  // the edge of the circle rather than being cropped out of a finished square.
  if (mode === 'round') {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
  }

  /* ------------------------------------------------------------ backdrop */
  if (!foreground) {
    hexField(ctx, size, size, px(82), px(-24), px(-14));

    // Lift the centre and sink the corners, so the snake sits in a pool of
    // light and the iOS corner mask has something to bite into.
    const g = ctx.createRadialGradient(px(470), px(430), px(60), px(500), px(520), px(780));
    g.addColorStop(0, 'rgba(220,249,255,0.95)');
    g.addColorStop(0.45, 'rgba(150,222,240,0.32)');
    g.addColorStop(1, 'rgba(20,84,112,0.46)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // The adaptive background layer is the backdrop and nothing else: the snake
  // rides above it, in the foreground layer, where the launcher can parallax it.
  if (mode === 'background') {
    ctx.restore();
    return;
  }

  // Android crops the outer third away, so the composition shrinks and
  // recentres rather than losing its tail to the mask. 0.56 rather than the
  // 0.66 safe zone itself: the pellets sit outside the body's bounds, and at
  // 0.66 the circular mask bites through them.
  const inset = foreground ? 0.56 : 1;
  ctx.translate(size / 2, size / 2);
  ctx.scale(inset, inset);
  ctx.translate(-size / 2, -size / 2);

  /* --------------------------------------------------------------- snake */
  const spacing = px(20);
  const radius = px(104);
  const body = curveBody(ICON_POSE.map(function (p) {
    return { x: px(p.x), y: px(p.y) };
  }), spacing);
  const angle = headAngle(body);

  // Centre by the body's own bounds, so retouching a control point above
  // cannot knock the composition off-centre.
  const b = bodyBounds(body, radius);
  const fill = size * ICON_FILL;
  const k = Math.min(fill / b.w, fill / b.h);
  const dx = (size - b.w * k) / 2 - b.x * k;
  const dy = (size - b.h * k) / 2 - b.y * k;

  /* ----------------------------------------------------------- the snake */
  ctx.save();
  ctx.translate(dx, dy);
  ctx.scale(k, k);

  /* ------------------------------------------------------------- pellets */
  // In design space and inside the fit transform, so they travel with the
  // snake: retouching the pose moves the food with it instead of leaving it
  // stranded in a corner. Drawn first, so the head lunges past them.
  const pellets = [
    { x: px(124), y: px(138), r: px(29), color: COLORS[6] },  // just past the tongue
    { x: px(248), y: px(88),  r: px(20), color: COLORS[3] },
    { x: px(76),  y: px(345), r: px(21), color: COLORS[2] },
  ];
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#0E2B3A';
  for (const p of pellets) {
    ctx.beginPath(); ctx.arc(p.x, p.y + px(8), p.r + px(5), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  drawPellets(ctx, pellets);
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#FFFFFF';
  for (const p of pellets) {
    ctx.beginPath(); ctx.arc(p.x - p.r * 0.28, p.y - p.r * 0.34, p.r * 0.42, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  const s = {
    points: body,
    radius: radius,
    angle: angle,
    color: COLORS[0],
    skin: skin('ember'),
    spacing: spacing,
  };

  // Ground shadow: the same body, fatter and offset down. Cheap depth that
  // survives the iOS corner mask.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.translate(0, px(22));
  drawSnake(ctx, s, { outline: '#062C3C', outlineWidth: px(16), gloss: false });
  ctx.restore();

  drawSnake(ctx, s, {
    outline: '#0E2B3A',
    outlineWidth: px(14),
    tongue: 1.6,
    bigEyes: true,
    eyeOutline: true,
    eyeOut: 0.44,
    eyeFwd: 0.26,
    eyeR: 0.38,
  });
  ctx.restore();

  ctx.restore();
}
