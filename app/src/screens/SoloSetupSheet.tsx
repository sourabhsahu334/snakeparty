import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ARENA_CHOICES,
  DEFAULT_SOLO_SETTINGS,
  FOOD_CHOICES,
  POPULATION_CHOICES,
  SPEED_CHOICES,
  type Choice,
  type SoloSettings,
} from '../game/soloSettings';
import { theme, ui } from '../lib/theme';

type Props = {
  visible: boolean;
  settings: SoloSettings;
  onChange: (next: SoloSettings) => void;
  onStart: () => void;
  onClose: () => void;
  /** 'menu' opens a run; 'paused' re-tunes one already in progress. */
  variant?: 'menu' | 'paused';
  /** Shown as a ghost link under the main button, when there is one. */
  onQuit?: () => void;
};

/**
 * Single-player rules, as a sheet over the menu.
 *
 * Every option is a named step rather than a slider: a slider would need a
 * native dependency for this one screen, and "Fast" is a decision in a way
 * that 1.37x is not. Two columns because the sheet is landscape and short.
 */
export function SoloSetupSheet({
  visible,
  settings,
  onChange,
  onStart,
  onClose,
  variant = 'menu',
  onQuit,
}: Props) {
  const insets = useSafeAreaInsets();
  const paused = variant === 'paused';
  const set = (patch: Partial<SoloSettings>) => onChange({ ...settings, ...patch });
  const isDefault =
    settings.speed === DEFAULT_SOLO_SETTINGS.speed &&
    settings.population === DEFAULT_SOLO_SETTINGS.population &&
    settings.arena === DEFAULT_SOLO_SETTINGS.arena &&
    settings.food === DEFAULT_SOLO_SETTINGS.food;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={['landscape', 'landscape-left', 'landscape-right', 'portrait']}
    >
      <View style={styles.scrim}>
        <View
          style={[
            styles.sheet,
            {
              marginTop: insets.top + 8,
              marginBottom: insets.bottom + 8,
              marginLeft: insets.left + 16,
              marginRight: insets.right + 16,
            },
          ]}
        >
          <View style={[ui.row, { marginBottom: 8 }]}>
            <Text style={styles.title}>{paused ? 'PAUSED' : 'SINGLE PLAYER'}</Text>
            <View style={{ flex: 1 }} />
            {!isDefault && (
              <Pressable onPress={() => onChange(DEFAULT_SOLO_SETTINGS)} hitSlop={10}>
                <Text style={styles.reset}>Reset</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={12} style={{ marginLeft: 14 }}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.grid}>
              <Row
                label="Snake speed"
                hint="Everything in the arena, you included."
                choices={SPEED_CHOICES}
                value={settings.speed}
                onPick={(speed) => set({ speed })}
              />
              <Row
                label="Snakes"
                hint="How many are out there at once."
                choices={POPULATION_CHOICES}
                value={settings.population}
                onPick={(population) => set({ population })}
              />
              <Row
                label="Arena size"
                hint="How far the rim is."
                choices={ARENA_CHOICES}
                value={settings.arena}
                onPick={(arena) => set({ arena })}
              />
              <Row
                label="Food"
                hint="How fast you can grow."
                choices={FOOD_CHOICES}
                value={settings.food}
                onPick={(food) => set({ food })}
              />
            </View>
          </ScrollView>

          {paused && (
            <Text style={styles.note}>
              Changes apply straight away — the run keeps your score.
            </Text>
          )}

          <Pressable onPress={onStart} style={[ui.button, { marginTop: paused ? 4 : 10 }]}>
            <Text style={ui.buttonText}>{paused ? 'RESUME' : 'START RUN'}</Text>
          </Pressable>

          {onQuit && (
            <Pressable onPress={onQuit} style={{ paddingVertical: 8, alignItems: 'center' }}>
              <Text style={styles.quit}>Quit to menu</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** One setting: a label and its options, exactly one of them lit. */
function Row({
  label,
  hint,
  choices,
  value,
  onPick,
}: {
  label: string;
  hint: string;
  choices: Choice[];
  value: number;
  onPick: (v: number) => void;
}) {
  return (
    <View style={styles.rowCell}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowHint}>{hint}</Text>
      <View style={styles.chips}>
        {choices.map((c) => {
          const on = c.value === value;
          return (
            <Pressable
              key={c.label}
              onPress={() => onPick(c.value)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(6,44,60,0.55)' },
  sheet: {
    flex: 1,
    backgroundColor: theme.bgDeep,
    borderRadius: 20,
    padding: 14,
  },

  title: {
    color: theme.white,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
    textShadowColor: theme.outline,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
  reset: { color: theme.white, fontSize: 11, fontWeight: '800', opacity: 0.85 },
  note: {
    color: theme.white,
    fontSize: 9.5,
    fontWeight: '700',
    opacity: 0.75,
    textAlign: 'center',
    marginTop: 2,
  },
  quit: { color: theme.white, fontSize: 12, fontWeight: '800', opacity: 0.8 },
  close: { color: theme.white, fontSize: 15, fontWeight: '900', opacity: 0.85 },

  // Two across, so four settings fit the ~340dp a landscape phone gives us.
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  rowCell: { width: '48.5%', marginBottom: 10 },
  rowLabel: { color: theme.white, fontSize: 12, fontWeight: '900' },
  rowHint: {
    color: theme.white,
    fontSize: 9.5,
    fontWeight: '700',
    opacity: 0.75,
    marginTop: 1,
    marginBottom: 5,
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    marginRight: 5,
    marginBottom: 5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.white },
  chipText: { color: theme.white, fontSize: 11, fontWeight: '800', opacity: 0.9 },
  chipTextOn: { opacity: 1 },
});
