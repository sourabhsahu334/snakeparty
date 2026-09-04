import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveSnake } from './LiveSnake';
import { SkinPreview } from './SkinPreview';
import type { Skin } from './protocol';
import { tierOf } from './tiers';
import { theme, ui } from '../lib/theme';

type Props = {
  skins: Skin[];
  colors: string[];
  skinIndex: number;
  colorIndex: number;
  onSkin: (index: number) => void;
  onColor: (index: number) => void;
  onClose: () => void;
  /** Shown over the preview, the way the reference art labels the player. */
  playerName?: string;
};

/** Card art is a standing snake, so the thumbnail is rotated a quarter turn. */
const CARD_W = 74;
/** The tallest a card's art may get; short screens get less (see `cardArt`). */
const CARD_ART_MAX = 96;
/** Floor, past which the thumbnail stops reading as a snake at all. */
const CARD_ART_MIN = 46;
/** The name strip under the art, which does not scale. */
const CARD_NAME_H = 26;
/** Vertical gap below each row of cards. */
const ROW_GAP = 8;
/**
 * The rotated thumbnail is about 1.6 times as long as it is thick, so this is
 * what divides the art box's long side to get a preview that fits inside it.
 */
const ART_ASPECT = 1.6;

/**
 * The full-screen snake gallery.
 *
 * Two columns, because these menus are landscape and short: what you have
 * picked, and every snake there is beside it. No category rails — the whole
 * roster is two rows you scroll sideways through, each row on its own
 * scroller so either half of the list can be browsed independently. Only the
 * big preview is a live canvas — the grid is Views, so opening the gallery
 * costs one animation, not thirty-eight.
 *
 * Type is dark ink rather than white: the background is a bright cyan, and
 * white-on-cyan is the one pairing here that does not carry.
 *
 * Picking applies immediately rather than on a confirm, so the preview and the
 * snake you take into a match can never disagree; the button just closes.
 */
export function SkinGallery({
  skins,
  colors,
  skinIndex,
  colorIndex,
  onSkin,
  onColor,
  onClose,
  playerName,
}: Props) {
  const insets = useSafeAreaInsets();
  const [art, setArt] = useState({ width: 0, height: 0 });
  // How much height is left for the two rows once the header and the footer
  // have taken theirs. 0 until the first layout, which means "assume there is
  // room" — the measurement lands on the same frame.
  const [railBox, setRailBox] = useState(0);

  const current = skins[skinIndex];
  const tier = tierOf(current);
  const baseColor = colors[colorIndex] ?? colors[0];
  // Only 'Classic' has no colours of its own, so the palette is noise elsewhere.
  const usesBaseColor = !current?.pattern || current.pattern.length === 0;

  // Split down the middle so the two rows stay the same length; each row
  // remembers where it started, because the whole app refers to a skin by its
  // index into `skins` and the grid must never renumber anything.
  const half = Math.ceil(skins.length / 2);
  const rows = [
    { offset: 0, items: skins.slice(0, half) },
    { offset: half, items: skins.slice(half) },
  ];

  // Cards are sized from the leftover height rather than fixed, because a
  // short phone in landscape has nowhere near the 260dp two full-size rows
  // want, and the half that loses the argument is the footer — which holds
  // DONE, the only way out of this screen. Two rows and their gaps have to
  // fit `railBox`; below the floor the rows scroll instead of shrinking more.
  const cardArt = railBox
    ? Math.max(
        CARD_ART_MIN,
        Math.min(CARD_ART_MAX, Math.floor(railBox / 2) - ROW_GAP - CARD_NAME_H)
      )
    : CARD_ART_MAX;
  const cardH = cardArt + CARD_NAME_H;
  // The art box shrank on its long side, so the snake inside has to as well,
  // or it is cropped by the card border it used to clear.
  const previewSize = Math.min(CARD_W * 0.68, cardArt / ART_ASPECT);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 8,
        paddingLeft: insets.left + 12,
        paddingRight: insets.right + 12,
      }}
    >
      {/* ---------------- header ---------------- */}
      <View style={[ui.row, { marginBottom: 8 }]}>
        <Pressable onPress={onClose} hitSlop={14} style={styles.back}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.screenTitle}>YOUR SNAKE</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.count}>{skins.length} SKINS</Text>
      </View>

      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* ---------------- left: the one you are wearing ---------------- */}
        <View style={styles.preview}>
          {playerName ? (
            <View style={styles.namePlate}>
              <Text numberOfLines={1} style={styles.nameText}>
                {playerName}
              </Text>
            </View>
          ) : null}
          <View
            style={{ flex: 1, alignSelf: 'stretch' }}
            onLayout={(e) => setArt(e.nativeEvent.layout)}
          >
            {art.width > 0 && art.height > 0 && current ? (
              <LiveSnake
                skin={current}
                baseColor={baseColor}
                width={art.width}
                height={art.height}
              />
            ) : null}
          </View>
          <View style={[styles.tierPill, { backgroundColor: tier.color }]}>
            <Text style={[styles.tierGlyph, { color: tier.ink }]}>{tier.glyph}</Text>
            <Text style={[styles.tierLabel, { color: tier.ink }]}>{tier.label.toUpperCase()}</Text>
          </View>
          <Text numberOfLines={1} style={styles.previewName}>
            {current?.name ?? ''}
          </Text>
        </View>

        {/* ---------------- right: the whole roster ---------------- */}
        <View style={{ flex: 1, minHeight: 0, paddingLeft: 10 }}>
          {/* Two rows, two scrollers. The pair takes whatever the header and
              footer leave and hands that measurement back so the cards can be
              cut to fit; on a screen too short even for the smallest cards it
              scrolls vertically rather than growing over the footer. */}
          <ScrollView
            style={{ flex: 1 }}
            onLayout={(e) => setRailBox(e.nativeEvent.layout.height)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 0 }}
          >
            {rows.map((row) => (
              <ScrollView
                key={row.offset}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0 }}
                contentContainerStyle={styles.rail}
              >
                {row.items.map((s, j) => {
                  const i = row.offset + j;
                  const selected = i === skinIndex;
                  const tier = tierOf(s);
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => onSkin(i)}
                      style={[
                        styles.card,
                        { height: cardH },
                        selected && styles.cardOn,
                        selected && { borderColor: tier.color },
                      ]}
                    >
                      {/* The tier mark, in the corner the reference art puts it. */}
                      <View style={[styles.badge, { backgroundColor: tier.color }]}>
                        <Text style={[styles.badgeGlyph, { color: tier.ink }]}>{tier.glyph}</Text>
                      </View>
                      {/* The thumbnail is drawn side-on facing right, then turned
                          a quarter turn clockwise so it stands head-down like the
                          card art it is imitating. Rotation is not laid out, so
                          the inner box carries the swapped width and height. */}
                      <View style={[styles.cardArt, { height: cardArt }]}>
                        <View
                          style={{
                            width: cardArt,
                            height: CARD_W,
                            transform: [{ rotate: '90deg' }],
                            justifyContent: 'center',
                          }}
                        >
                          <SkinPreview skin={s} baseColor={baseColor} size={previewSize} />
                        </View>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.cardName, selected && styles.cardNameOn]}
                      >
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ))}
          </ScrollView>

          {/* ---------------- footer: blurb, colours, done ----------------
              Never shrinks: it is the only way out of this screen. */}
          <View style={[ui.row, { marginTop: 8, flexShrink: 0, alignItems: 'flex-end' }]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text numberOfLines={2} style={styles.desc}>
                {current?.desc ?? ''}
              </Text>
              {usesBaseColor ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ flexDirection: 'row', paddingTop: 8 }}
                >
                  {colors.map((c, i) => (
                    <Pressable
                      key={c + i}
                      onPress={() => onColor(i)}
                      hitSlop={4}
                      style={[
                        styles.swatch,
                        { backgroundColor: c, borderWidth: i === colorIndex ? 3 : 0 },
                      ]}
                    />
                  ))}
                </ScrollView>
              ) : null}
            </View>
            <Pressable onPress={onClose} style={[ui.button, { paddingHorizontal: 26 }]}>
              <Text style={styles.doneText}>DONE</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * The menus' entry point to the gallery: a plate showing the snake you are
 * wearing, which opens the full screen when tapped.
 *
 * The modal owns its own open state because both menus want the same thing and
 * neither has any other use for it. `supportedOrientations` is not optional —
 * without it iOS swings the modal back to portrait and the three columns
 * collapse.
 */
export function SkinButton(props: Omit<Props, 'onClose'>) {
  const [open, setOpen] = useState(false);
  const current = props.skins[props.skinIndex];
  const tier = tierOf(current);
  const baseColor = props.colors[props.colorIndex] ?? props.colors[0];

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.slot}>
        <View style={{ width: 74 }}>
          {current ? <SkinPreview skin={current} baseColor={baseColor} size={30} /> : null}
        </View>
        <View style={{ flex: 1, paddingLeft: 8 }}>
          <Text numberOfLines={1} style={styles.slotName}>
            {current?.name ?? 'Pick a snake'}
          </Text>
          <View style={[ui.row, { marginTop: 2 }]}>
            <View style={[styles.tierPill, { backgroundColor: tier.color, marginBottom: 0 }]}>
              <Text style={[styles.tierGlyph, { color: tier.ink }]}>{tier.glyph}</Text>
              <Text style={[styles.tierLabel, { color: tier.ink }]}>{tier.label.toUpperCase()}</Text>
            </View>
            <Text numberOfLines={1} style={[styles.slotHint, { marginLeft: 6 }]}>
              Tap to change
            </Text>
          </View>
        </View>
        <Text style={styles.slotChevron}>›</Text>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <SkinGallery {...props} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: theme.radius,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  slotName: { color: theme.ink, fontSize: 17, fontWeight: '900' },
  slotHint: { color: theme.ink, fontSize: 12, fontWeight: '800', opacity: 0.75 },
  slotChevron: { color: theme.ink, fontSize: 28, fontWeight: '900', marginLeft: 4 },

  back: {
    width: 42,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    color: theme.ink,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    marginTop: -3,
  },
  screenTitle: {
    color: theme.ink,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginLeft: 10,
  },
  count: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
    opacity: 0.8,
  },

  preview: {
    width: 146,
    backgroundColor: theme.panelSolid,
    borderRadius: theme.radius,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  namePlate: {
    backgroundColor: theme.bg,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  nameText: { color: theme.ink, fontSize: 15, fontWeight: '900' },
  previewName: {
    color: theme.ink,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },

  /** One horizontal row of cards; there are two of them, stacked. */
  rail: { flexDirection: 'row', alignItems: 'flex-start' },
  card: {
    width: CARD_W,
    marginRight: 8,
    marginBottom: ROW_GAP,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    overflow: 'hidden',
  },
  cardOn: { backgroundColor: theme.panelSolid, borderColor: theme.accent },
  cardArt: {
    // Height comes from the layout — see `cardArt` above. The width is the
    // card's short side, which the standing thumbnail never needed all of.
    width: CARD_W - 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 3,
    left: 3,
    zIndex: 2,
    width: 17,
    height: 17,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeGlyph: { fontSize: 9, fontWeight: '900', lineHeight: 13 },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 1,
  },
  tierGlyph: { fontSize: 11, marginRight: 4 },
  tierLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  cardName: {
    fontSize: 11,
    fontWeight: '900',
    color: theme.ink,
    paddingHorizontal: 2,
  },
  cardNameOn: { color: theme.ink },

  desc: { color: theme.ink, fontSize: 15, fontWeight: '700', opacity: 0.95 },
  doneText: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginRight: 8,
    borderColor: theme.ink,
  },
});
