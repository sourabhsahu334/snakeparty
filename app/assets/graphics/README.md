# Dropping in a downloaded model

Everything in this folder is artwork. To install a creature you need two things:
the files here, and one entry in [`../src/js/models.js`](../src/js/models.js).

## What to download

Look for a **side-view sprite sheet with a walk cycle**, laid out as a grid with
one animation per row and every frame the same size. That is the standard layout
on itch.io, OpenGameArt and Kenney, and it is the only layout this renderer
reads.

Worth having, in rough order of how much they add:

| Clip    | Frames typically | Needed?                                   |
| ------- | ---------------- | ----------------------------------------- |
| `walk`  | 4–8              | **Yes** — everything falls back to it     |
| `idle`  | 2–6              | Strongly — it is what a paused pet does   |
| `sit`   | 1–4              | Nice; falls back to `idle`                |
| `sleep` | 1–4              | Nice; falls back to `sit`                 |
| `run`   | 4–8              | Only used when fleeing; falls back to walk |
| `death` | 6–12             | Optional. With one, set `finale: 'collapse'` and the pet dies when you come back instead of running off |
| attacks | 3–8              | Optional. Any number, under any names, listed in `flourishes` |
| `jump`  | 8–12             | Optional. Needs a `lift` — see below |

Practical points, learned the hard way:

- **Side view, not three-quarter or top-down.** The pet walks along the bottom
  of the screen; a top-down sprite will look like it is falling over.
- **One direction is enough.** The renderer flips the art horizontally. Say
  which way it faces with `facesRight`.
- **Transparent background**, PNG. A white box around the art is very obvious
  over a real web page.
- **Uniform frame size**, no padding between frames. If the sheet is packed with
  a `.json` atlas of varying rectangles, it will not work as-is.
- **Small is fine.** 32×32 or 48×48 pixel art scales up crisply — the renderer
  turns off smoothing under 64px tall. A 400px illustration scaled *down* looks
  worse than pixel art scaled up.
- **Check the licence.** CC0 and "free for commercial use" are safe to ship in a
  Chrome Web Store listing. Anything requiring attribution goes in the model's
  `credit` field. Do not ship art you only have a personal-use licence for.

## Clips no brain state asks for

A fight pack ships three attacks, a jump and a hurt, and the brain has states
for none of them — it knows about walking, pausing, sitting, sleeping, fleeing
and dying. Two fields put that artwork to use anyway.

**`flourishes: ['attack1', 'jump', 'attack2']`** — clip names played in turn
during a rest stop, in place of the sitting pose. They hang off `scratch`, the
signal that makes the rig panda scratch an ear: the brain raising it means "you
are stopped, do something". One is chosen per fidget, so a clip cannot change
halfway through, and they are taken in turn rather than at random so a short
visit to a page still shows more than one. Give them `once: true` — a pet that
finishes a swing and stands in the follow-through looks deliberate, where a
looping three-frame slash looks stuck.

**`lift: { px: 26, from: 2.5, to: 10.5 }`** on a jump clip. Jump artwork in
these packs barely leaves its own frame — two or three pixels on a 128px cell —
because it is drawn as take-off, tuck and landing for a game engine to move
through the air itself. Played in place it is a squat. `lift` arcs the pet
`px` rig px up across frames `from` to `to`, leaving the crouch at either end on
the floor where it belongs, and tightens and fades the ground shadow as the gap
opens. Pick `from` and `to` by looking at the strip: they are the frames where
the character is tucked, not the ones where it is still bending its knees.

Nothing uses `hurt`. There is no state that would justify it — the pet is never
harmed by anything, and it already has a death animation for the one moment it
comes to grief.

## If it is a stock illustration, not an animation

A "cartoon set" from a stock library — a few poses of one character, side by
side, on white — has no animation in it and none can be invented. Three good
poses still make a respectable pet, though: one that stands where it appears,
changes posture, and settles down. That is what `stationary: true` is for, and
what the dragon is.

```sh
python3 tools/cut-poses.py ../art-source/dragon-illustration/dragon.jpg \
    assets/dragon/sheet.png --height 256
```

It keys out the white, finds the characters by their empty columns, and aligns
them **by their feet** — the horizontal centre of each pose's lowest slice —
rather than by their bounding boxes, since a rearing pose and a crouching one
have wildly different boxes and aligning those would make the character skate
sideways as it changes pose. It then erases the illustration's own printed drop
shadow by flooding in from the border through pale pixels, which a colour
threshold cannot do without also erasing the teeth and eye whites.

Each pose becomes one row, one frame. Wire them to whichever states suit:
`idle` for standing, `sit` for the interesting one, `sleep` for lying down.

## If the pack is one strip per clip

Some packs — CraftPix's fighter and yokai sets, which is where the shinobi,
samurai, fighter, two tengu and the kitsune come from — ship a single PNG per
animation, laid out as one row of uniform cells: `Walk.png` is eight 128x128
frames side by side. That is nearly the grid the renderer wants, spread over ten
files. `tools/pack-strips.py` stacks them into rows:

```sh
python3 tools/pack-strips.py ../art-source/craftpix-fighters/Shinobi \
    assets/shinobi/sheet.png --cell 128 \
    --clip walk=Walk --clip idle=Idle --clip run=Run \
    --clip sit=Shield --clip death=Dead --id shinobi
```

It crops every frame identically, for the same reason `pack-frames.py` does, and
prints the entry to paste. Three of the numbers it prints are worth understanding:

- **No `--height`.** Pixel art is packed at its own size and marked
  `pixelated: true`, so the renderer scales it with nearest-neighbour and it
  stays crisp at 6x. Resampling it to twice the drawn size here only smears it,
  and permanently — the three fighters are 20 KB each against the knight's 1.6 MB.
- **`anchor`** comes from the walk clip's own footprint, not the middle of the
  frame. One sprawling clip — a swung chain, a death — pads the crop well past
  the body, and a 0.5 anchor would hang the pet to one side of where it walks.
- **`shadow`** is narrowed for the same reason: the default ground shadow is
  0.84 of the frame, which on a padded frame spills out either side of the feet.

The yokai went in the same way, ten clips apiece — the whole pack, not just the
walk:

```sh
python3 tools/pack-strips.py ../art-source/craftpix-yokai/Karasu_tengu \
    assets/karasu/sheet.png --cell 128 --id karasu \
    --clip walk=Walk --clip idle=Idle --clip run=Run --clip sit=Idle_2 \
    --clip death=Dead --clip attack1=Attack_1 --clip attack2=Attack_2 \
    --clip attack3=Attack_3 --clip jump=Jump --clip hurt=Hurt
```

Two things it cannot tell you. The printed `anchor` and `shadow` come from the
walk clip's whole footprint, wings included, which for a tengu is half a frame
wider than the bird actually stands — measure the bottom few rows of the walk
frames instead and you get 0.53 and 0.46 rather than 0.43 and 0.68. And the
tengu's `Jump.png` is not a jump: it is a flight, three frames of flapping up,
a long tucked glide and wings out to land, so it is wired up as `fly` with a
`lift` big enough to matter. The kitsune's own jump really is a hop, off the
ground for three frames of ten.

Kitsune `Fire_1.png` and `Fire_2.png` are left out: they are 64px-tall
projectile strips, not the character, so they do not fit the 128 grid.

## If the pack is loose frames, not a sheet

Most character packs ship as `Walk (1).png`, `Walk (2).png`, … — dozens of large,
mostly-transparent files. `tools/pack-frames.py` turns them into the one sheet
the renderer wants and prints the entry to paste:

```sh
python3 tools/pack-frames.py art-source/freeknight/png assets/knight/sheet.png \
    --clip walk=Walk --clip idle=Idle --clip run=Run --clip "sleep=Dead:8-10" \
    --height 256 --id knight
```

It crops **every frame identically**, to the union of all their opaque areas —
never to each frame's own bounding box, which re-centres them and makes the
character jitter. Where a pack draws one clip on a bigger canvas (death
animations usually), each canvas is placed by its content baseline so the feet
stay on the same ground line when the clip changes.

The four shipped models went from ~50 MB of loose PNGs to ~6 MB of sheets.

**Pack at roughly twice the size you will draw at** — `--height 256` for a pet
drawn ~76px tall. The size slider goes to 6x, and a sheet packed at the drawn
size is a blurry mess up there.

Two things the packer will not guess for you: `pxPerFrame` (start from its
suggestion, then watch for moonwalking) and `motion` (set `amble` so the walk
cycle lands near a second — `frames x pxPerFrame / amble`).

**Keep the raw pack outside the extension folder.** Chrome packages everything
under it, so the originals live in `../../art-source/` and only the packed sheet
ships.

## Where to put it

```
assets/<model-id>/sheet.png     one sheet per creature
```

## Then describe it

Add an entry to `MODELS` in `src/js/models.js`:

```js
{
  id: 'cat',
  name: 'Cat',
  blurb: 'Struts, sits, and washes itself when it thinks nobody is looking.',
  kind: 'sprite',
  sheet: 'assets/cat/walk.png',
  frame: { w: 32, h: 32 },   // one cell of the grid, in source pixels
  height: 58,                // how tall to draw it, in rig px (the panda is ~80)
  facesRight: true,
  anchor: { x: 0.5, y: 1 },  // where the feet are within a frame
  motion: { amble: 26, brisk: 40, flee: 140 },
  clips: {
    walk:  { row: 0, frames: 8, pxPerFrame: 7 },
    idle:  { row: 1, frames: 4, fps: 6 },
    sit:   { row: 2, frames: 2, fps: 2 },
    sleep: { row: 3, frames: 2, fps: 1.2 },
    run:   { row: 4, frames: 8, pxPerFrame: 12 },
  },
  finale: 'collapse',        // needs a death clip; otherwise it flees
  credit: 'Artist Name (CC0)',
}
```

Two fields decide whether it looks alive:

- **`pxPerFrame`** — walk and run advance a frame every *this many pixels
  travelled*, not on a timer, so the feet keep up when the pet speeds up. Start
  at `frame width ÷ number of frames` and adjust: if it moonwalks, lower it; if
  it skitters, raise it.
- **`motion`** — how fast the creature moves at all. A cat is quicker than a
  bear. These are the numbers to tune first, because everything else follows.

`tools/sheet-info.py` will read a sheet and tell you the grid it found, which
saves counting frames by eye:

```sh
python3 tools/sheet-info.py assets/cat/walk.png 32 32
```
