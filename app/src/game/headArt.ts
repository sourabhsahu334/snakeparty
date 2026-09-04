import { useMemo } from 'react';
import { useImage, type SkImage } from '@shopify/react-native-skia';

/**
 * Painted head sprites, keyed by the name a skin asks for in `headArt`.
 *
 * Why a name and not a path: the skin catalogue arrives from the server, which
 * has no idea what art is bundled in this build of the app. A skin asking for
 * a sprite we do not have simply falls back to its procedural head, so an old
 * app and a new server never disagree about more than how pretty a snake is.
 *
 * A sprite is worth it exactly when a skin's head is a piece of artwork rather
 * than a set of features — something with linework too fine to describe as
 * curves, which is the whole reason the procedural path exists. It costs the
 * skin its tinting: a bitmap cannot take the player's colour the way a drawn
 * head does, so the body pattern has to be chosen to match the art.
 */
type HeadArtSpec = {
  source: number;
  /** Sprite length along the heading, in body radii. */
  length: number;
  /**
   * Where the head bead sits along the sprite: 0 is the cut neck, 1 the nose.
   *
   * The body is drawn from this point backwards, so it wants to be far enough
   * forward that the beads come out from under the hood rather than floating
   * off the back of it.
   */
  anchor: number;
};

const SPECS: Record<string, HeadArtSpec> = {
  basilisk: {
    source: require('../../assets/heads/basilisk.png'),
    // 3.8 body radii long. The sprite is 384x271, so that puts the hood at
    // ~2.7r across against a 2r body — the head reads wider than the neck, the
    // way a viper's does, instead of looking like one more bead.
    length: 3.8,
    anchor: 0.34,
  },
};

/** Fixed at module load, which is what lets the hook below loop safely. */
const KEYS = Object.keys(SPECS);

export type HeadArt = { image: SkImage; length: number; anchor: number };

/**
 * Load every head sprite once, up front.
 *
 * `useImage` is a hook, so the set it is called over has to be the same on
 * every render — it is, because `KEYS` is a module constant. Loading the lot
 * rather than just the skin in play keeps that true when the player switches
 * skin mid-session, and the whole set is a few hundred KB of texture.
 */
export function useHeadArt(): Record<string, HeadArt> {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const images = KEYS.map((k) => useImage(SPECS[k].source));
  return useMemo(() => {
    const out: Record<string, HeadArt> = {};
    KEYS.forEach((k, i) => {
      const image = images[i];
      if (image) out[k] = { image, length: SPECS[k].length, anchor: SPECS[k].anchor };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, images);
}
