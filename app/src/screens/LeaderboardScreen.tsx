import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getLeaderboard, type Board, type LeaderMode } from '../lib/session';
import { theme, ui } from '../lib/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

const MODES: { label: string; value: LeaderMode; blurb: string }[] = [
  { label: 'MULTIPLAYER', value: 'multi', blurb: 'Best score in a room, as the server saw it.' },
  { label: 'SINGLE PLAYER', value: 'solo', blurb: 'Best score in a solo run.' },
];

/**
 * All-time boards, one per mode, as a sheet over the menu.
 *
 * Two boards rather than one because the scores are not comparable: a solo run
 * is against bots with settings the player chose, a room is against people.
 * Merging them would rank a generous solo arena above a hard-won room.
 *
 * Multiplayer defaults because it is the honest one — those scores were
 * recorded by the server that ran the round.
 */
export function LeaderboardScreen({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<LeaderMode>('multi');
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (m: LeaderMode) => {
    setLoading(true);
    setFailed(false);
    const res = await getLeaderboard(m, 25);
    setBoard(res);
    setFailed(res === null);
    setLoading(false);
  }, []);

  // Reload on open and on every mode switch — the board is not worth caching
  // across a close, and a stale one is worse than a spinner.
  useEffect(() => {
    if (visible) void load(mode);
  }, [visible, mode, load]);

  const rows = board?.top ?? [];
  const you = board?.you ?? null;
  const blurb = MODES.find((m) => m.value === mode)?.blurb ?? '';

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
              marginTop: insets.top + 10,
              marginBottom: insets.bottom + 10,
              marginLeft: insets.left + 16,
              marginRight: insets.right + 16,
            },
          ]}
        >
          <View style={[ui.row, { marginBottom: 8 }]}>
            <Text style={styles.title}>LEADERBOARD</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.chips}>
            {MODES.map((m) => {
              const on = m.value === mode;
              return (
                <Pressable
                  key={m.value}
                  onPress={() => setMode(m.value)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.blurb}>{blurb}</Text>

          <View style={[ui.panel, { flex: 1, paddingVertical: 4, marginTop: 8 }]}>
            {loading ? (
              <View style={styles.centre}>
                <ActivityIndicator color={theme.ink} />
              </View>
            ) : failed ? (
              <View style={styles.centre}>
                <Text style={styles.empty}>Couldn't reach the leaderboard.</Text>
                <Pressable onPress={() => void load(mode)} style={{ marginTop: 8 }}>
                  <Text style={styles.retry}>Try again</Text>
                </Pressable>
              </View>
            ) : rows.length === 0 ? (
              <View style={styles.centre}>
                <Text style={styles.empty}>
                  {mode === 'solo'
                    ? 'No solo runs yet. Finish one and it lands here.'
                    : 'No rooms played yet. Win one and take the top spot.'}
                </Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ paddingBottom: 4 }}>
                {rows.map((r, i) => {
                  // The board has no notion of "me", so match on the standing
                  // the server returned rather than trying to guess by name.
                  const isYou = !!you && Number(r.score) === Number(you.score) && you.rank === i + 1;
                  return (
                    <View
                      key={`${r.player_id ?? r.username}-${i}`}
                      style={[
                        ui.row,
                        styles.row,
                        { borderTopWidth: i === 0 ? 0 : 1 },
                        isYou && styles.rowYou,
                      ]}
                    >
                      <Text style={[styles.rank, i < 3 && styles.rankTop]}>{i + 1}</Text>
                      <Text numberOfLines={1} style={styles.name}>
                        {r.username}
                        {isYou ? ' (you)' : ''}
                      </Text>
                      <Text style={styles.runs}>
                        {r.runs} {r.runs === 1 ? 'run' : 'runs'}
                      </Text>
                      <Text style={styles.score}>{r.score}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* Somewhere below the top 25 is still somewhere — say where. */}
          {you && !loading && !failed && (
            <View style={styles.youBar}>
              <Text style={styles.youText}>
                Your best: {you.score} · rank #{you.rank} · {you.runs}{' '}
                {you.runs === 1 ? 'run' : 'runs'}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(6,44,60,0.55)' },
  sheet: { flex: 1, backgroundColor: theme.bgDeep, borderRadius: 20, padding: 14 },

  title: {
    color: theme.white,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
    textShadowColor: theme.outline,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
  close: { color: theme.white, fontSize: 15, fontWeight: '900', opacity: 0.85 },

  chips: { flexDirection: 'row' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginRight: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.white },
  chipText: { color: theme.white, fontSize: 11, fontWeight: '800', opacity: 0.9 },
  chipTextOn: { opacity: 1 },
  blurb: {
    color: theme.white,
    fontSize: 9.5,
    fontWeight: '700',
    opacity: 0.75,
    marginTop: 5,
  },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  empty: { color: theme.inkDim, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  retry: { color: theme.ink, fontSize: 12, fontWeight: '900' },

  row: { paddingVertical: 7, paddingHorizontal: 10, borderTopColor: 'rgba(23,56,74,0.12)' },
  rowYou: { backgroundColor: 'rgba(255,255,255,0.5)' },
  rank: {
    color: theme.inkDim,
    fontSize: 12,
    fontWeight: '900',
    width: 26,
  },
  rankTop: { color: theme.ink },
  name: { color: theme.ink, fontSize: 14, fontWeight: '800', flex: 1 },
  runs: { color: theme.inkDim, fontSize: 10, fontWeight: '700', marginRight: 10 },
  score: { color: theme.ink, fontSize: 15, fontWeight: '900', minWidth: 52, textAlign: 'right' },

  youBar: {
    marginTop: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  youText: { color: theme.white, fontSize: 11.5, fontWeight: '800' },
});
