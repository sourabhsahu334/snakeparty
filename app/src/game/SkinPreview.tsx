import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { beadColors, scaleHighlight } from './skins';
import type { Skin } from './protocol';

/**
 * The still, cheap version of a snake: plain Views, no Skia.
 *
 * A gallery shows every skin at once, and thirty-odd live canvases is not a
 * price worth paying for thumbnails — only the big preview animates. Drawn
 * side-on facing right; the gallery rotates the whole thing to stand it up.
 */
const PREVIEW_BEADS = 6;

/**
 * The head ornament, flattened onto the picker's side-on head (which faces
 * right). This is a hint, not the arena drawing — plain Views, no Skia, since
 * the picker is laid out by React and a 40px card only has room for a
 * silhouette anyway.
 */
export function CrownPreview({ crown, d }: { crown: NonNullable<Skin['crown']>; d: number }) {
  const { shape, color, accent } = crown;
  const dot = (size: number, bg: string, style?: object) => ({
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size,
    backgroundColor: bg,
    ...style,
  });

  switch (shape) {
    case 'horns':
      return (
        <>
          <View style={dot(d * 0.34, color, { left: -d * 0.34, top: -d * 0.06 })} />
          <View style={dot(d * 0.34, color, { left: d * 0.02, top: -d * 0.26 })} />
        </>
      );
    case 'plume':
      return (
        <>
          <View style={dot(d * 0.46, color, { left: -d * 0.28, top: -d * 0.2 })} />
          <View style={dot(d * 0.34, color, { left: -d * 0.55, top: -d * 0.06 })} />
          {accent ? <View style={dot(d * 0.2, accent, { left: -d * 0.18, top: -d * 0.12 })} /> : null}
        </>
      );
    case 'topknot':
      return <View style={dot(d * 0.34, color, { left: -d * 0.4, top: -d * 0.05 })} />;
    case 'frill':
      return (
        <>
          <View style={dot(d * 0.3, color, { left: -d * 0.42, top: -d * 0.22 })} />
          <View style={dot(d * 0.3, color, { left: -d * 0.52, top: d * 0.2 })} />
          <View style={dot(d * 0.3, color, { left: -d * 0.18, top: -d * 0.34 })} />
        </>
      );
    case 'hat':
      return (
        <>
          <View style={dot(d * 0.5, color, { left: -d * 0.2, top: -d * 0.3 })} />
          <View style={dot(d * 0.34, color, { left: -d * 0.55, top: -d * 0.42 })} />
          {accent ? (
            <>
              <View style={dot(d * 0.26, accent, { left: -d * 0.78, top: -d * 0.5 })} />
              <View
                style={{
                  position: 'absolute',
                  left: -d * 0.1,
                  top: -d * 0.06,
                  width: d * 1.2,
                  height: d * 0.24,
                  borderRadius: d,
                  backgroundColor: accent,
                }}
              />
            </>
          ) : null}
        </>
      );
    case 'beak':
      return (
        <View
          style={{
            position: 'absolute',
            left: d * 0.9,
            top: d * 0.4,
            width: 0,
            height: 0,
            borderTopWidth: d * 0.26,
            borderBottomWidth: d * 0.26,
            borderLeftWidth: d * 0.62,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: color,
          }}
        />
      );
    case 'snout':
      return (
        <View
          style={{
            position: 'absolute',
            left: d * 0.72,
            top: d * 0.34,
            width: d * 0.72,
            height: d * 0.6,
            borderRadius: d,
            backgroundColor: color,
          }}
        />
      );
    case 'tiara':
      return (
        <>
          {[-0.34, 0, 0.34].map((a, i) => (
            <View
              key={i}
              style={dot(d * (i === 1 ? 0.3 : 0.22), color, {
                left: -d * (i === 1 ? 0.42 : 0.3),
                top: d * (0.3 + a),
              })}
            />
          ))}
          {accent ? <View style={dot(d * 0.16, accent, { left: -d * 0.36, top: d * 0.26 })} /> : null}
        </>
      );
    case 'visor':
      return (
        <>
          <View
            style={{
              position: 'absolute',
              left: d * 0.28,
              top: d * 0.16,
              width: d * 0.44,
              height: d * 0.94,
              borderRadius: d * 0.2,
              backgroundColor: color,
            }}
          />
          {accent ? (
            <View
              style={{
                position: 'absolute',
                left: d * 0.34,
                top: d * 0.34,
                width: d * 0.32,
                height: d * 0.58,
                borderRadius: d * 0.12,
                backgroundColor: accent,
              }}
            />
          ) : null}
        </>
      );
    default:
      return null;
  }
}


/**
 * One flame lick for the still preview: a triangle pointing at the head, with
 * a brighter one nested inside it. The head is to the right here, so the
 * tongues lean that way; the card rotates the whole preview upright.
 */
/**
 * A square with three corners rounded off is a teardrop; turned, its one sharp
 * corner becomes a tip. 225° points back down the body — where flames trail
 * and scales lie — and 45° points at the head, which is where a snout goes.
 */
function drop(size: number, fill: string, left: number, top: number, deg: string) {
  return {
    position: 'absolute' as const,
    left,
    top,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderTopRightRadius: 0,
    backgroundColor: fill,
    transform: [{ rotate: deg }],
  };
}

/** Fire, on the still preview: a tongue per bead with a brighter heart. */
function FlameLick({
  d,
  color,
  flames,
  side,
}: {
  d: number;
  /** The bead's own colour: on a burning skin the flame *is* the body. */
  color: string;
  flames: NonNullable<Skin['flames']>;
  side: 1 | -1;
}) {
  const lean = side * d * 0.1;
  return (
    <>
      <View style={drop(d * 1.25, flames.tint ?? color, -d * 0.4, -d * 0.12 + lean, '225deg')} />
      {flames.core ? (
        <View style={drop(d * 0.6, flames.core, -d * 0.02, d * 0.2 + lean, '225deg')} />
      ) : null}
    </>
  );
}

/**
 * Dragon plating, on the still preview: one scute per bead, staggered across
 * the body so it reads as a lattice rather than a stripe.
 */
function ScaleLick({ d, color, tint, side }: { d: number; color: string; tint: string; side: 1 | -1 }) {
  const stagger = side * d * 0.2;
  return (
    <>
      <View style={drop(d * 1.05, color, -d * 0.18, -d * 0.02 + stagger, '225deg')} />
      <View style={drop(d * 0.78, tint, -d * 0.02, d * 0.12 + stagger, '225deg')} />
    </>
  );
}

/** A little bead chain showing what a skin actually looks like in play. */
export function SkinPreview({
  skin,
  baseColor,
  size,
  beads = PREVIEW_BEADS,
}: {
  skin: Skin;
  baseColor: string;
  size: number;
  /** Body length in beads. Longer bodies read better on a tall card. */
  beads?: number;
}) {
  const colors = useMemo(
    () => beadColors(skin, baseColor, beads),
    [skin, baseColor, beads]
  );
  const d = size / 3.4;
  const ears = skin.ears;
  const flames = skin.flames;
  const dragon = skin.scales?.style === 'dragon' ? skin.scales : undefined;
  // Both are bodies in their own right, so the bead underneath goes.
  const smooth = skin.smooth;
  const sculpted = !!flames || !!dragon || !!smooth;
  const crown = skin.crown;
  return (
    <View style={{ height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* A smooth skin is one capsule with the pattern banded inside it —
            square segments, no overlap, clipped to a rounded outline, so the
            edge has none of the scalloping a bead chain shows. */}
        <View
          style={
            smooth
              ? { flexDirection: 'row', height: d, borderRadius: d / 2, overflow: 'hidden' }
              : { flexDirection: 'row', alignItems: 'center' }
          }
        >
        {colors
          .slice()
          .reverse()
          .map((c, i) =>
            smooth ? (
              <View key={i} style={{ width: d * 0.8, height: d, backgroundColor: c }} />
            ) : (
            <View
              key={i}
              style={{
                width: d,
                height: d,
                borderRadius: d / 2,
                // A burning body has no beads under the fire to show through.
                backgroundColor: sculpted ? 'transparent' : c,
                marginLeft: -d * 0.22,
              }}
            >
              {/* A burning skin needs its flames here too, or the one card in
                  the grid that is on fire looks like a plain orange snake.
                  Two triangles per bead — the arena draws the real curved
                  tongue in Skia; at this size a lick is a lick. */}
              {flames ? <FlameLick d={d} color={c} flames={flames} side={i % 2 ? 1 : -1} /> : null}
              {dragon ? (
                <ScaleLick
                  d={d}
                  color={c}
                  tint={dragon.tint ?? scaleHighlight(skin, c)}
                  side={i % 2 ? 1 : -1}
                />
              ) : null}
            </View>
            )
          )}
        </View>
        {/* head, with ears if the skin has them — otherwise the animal skins
            look identical to plain bands in the picker */}
        <View style={{ marginLeft: -d * 0.3 }}>
          {ears && (
            <View style={styles.earRow}>
              {[0, 1].map((i) => (
                <View
                  key={i}
                  style={{
                    width: ears.shape === 'long' ? d * 0.4 : d * 0.62,
                    height: ears.shape === 'long' ? d * 1.05 : d * 0.62,
                    borderRadius: d,
                    backgroundColor: ears.color,
                    marginHorizontal: d * 0.06,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {ears.inner && (
                    <View
                      style={{
                        width: ears.shape === 'long' ? d * 0.18 : d * 0.28,
                        height: ears.shape === 'long' ? d * 0.6 : d * 0.28,
                        borderRadius: d,
                        backgroundColor: ears.inner,
                      }}
                    />
                  )}
                </View>
              ))}
            </View>
          )}
          <View
            style={{
              width: d * 1.25,
              height: d * 1.25,
              borderRadius: d,
              // A burning skin's head is a flame as well, so the disc goes and
              // the teardrop below stands in for it.
              backgroundColor: sculpted ? 'transparent' : colors[0],
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              marginTop: ears ? -d * 0.3 : 0,
            }}
          >
            {sculpted ? (
              // 45°, not the 225° the body shapes use: the head points the way
              // it is going, everything behind it lies the other way.
              <View
                style={drop(
                  d * 1.35,
                  flames?.tint ?? colors[0],
                  -d * 0.05,
                  -d * 0.05,
                  '45deg'
                )}
              />
            ) : null}
            {crown && <CrownPreview crown={crown} d={d} />}
            {crown?.shape !== 'visor' && (
              <>
                <View
                  style={[styles.eye, { width: d * 0.36, height: d * 0.36, borderRadius: d }]}
                />
                <View
                  style={[
                    styles.eye,
                    { width: d * 0.36, height: d * 0.36, borderRadius: d, marginLeft: d * 0.12 },
                  ]}
                />
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  eye: { backgroundColor: '#FFFFFF' },
  earRow: { flexDirection: 'row', justifyContent: 'center' },
});
