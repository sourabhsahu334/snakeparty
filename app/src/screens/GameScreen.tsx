import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameCanvas } from '../game/GameCanvas';
import { BoostButton, Joystick } from '../game/Controls';
import { useGame } from '../game/useGameSocket';
import { SoloSetupSheet } from './SoloSetupSheet';
import type { SoloSettings } from '../game/soloSettings';
import {
  DEFAULT_CONTROL_SIDE,
  loadControlSide,
  saveControlSide,
  saveSoloSettings,
  type ControlSide,
} from '../lib/prefs';
import { theme } from '../lib/theme';

/**
 * The arena screen. The canvas fills the whole display and every HUD element
 * floats on top of it, laid out the way snake.io does: score dead centre at the
 * top, leaderboard top-right, and the stick and boost pad in the bottom
 * corners — which way round is the player's choice, see `controlSide`.
 */
export function GameScreen() {
  const game = useGame();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const solo = game.mode === 'solo';

  // Draft settings, so backing out of the sheet doesn't half-apply an edit.
  const [draft, setDraft] = useState<SoloSettings | null>(null);

  // Handedness. Read once on mount and kept here so the sheet can flip it
  // live — the stick moving under your thumb as you tap is the whole point.
  const [controlSide, setControlSide] = useState<ControlSide>(DEFAULT_CONTROL_SIDE);
  useEffect(() => {
    let cancelled = false;
    void loadControlSide().then((s) => {
      if (!cancelled) setControlSide(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onAngle = useCallback((a: number) => game.setAngle(a), [game]);
  const onBoost = useCallback((b: boolean) => game.setBoost(b), [game]);

  const openSettings = useCallback(() => {
    game.pauseSolo();
    setDraft(game.soloSettings);
  }, [game]);

  const resume = useCallback(
    (next: SoloSettings | null) => {
      setDraft(null);
      if (next) saveSoloSettings(next);
      game.resumeSolo(next ?? undefined);
    },
    [game]
  );

  // Landscape leaves ~360dp of height. A full top-10 board runs into the boost
  // pad, so show as many rows as actually fit above it.
  const maxRows = Math.max(3, Math.min(10, Math.floor((height - 150) / 18)));
  const board = game.leaderboard;

  // Solo is an endless run, so the server only sends msLeft for a real match.
  // The leaderboard arrives at 2Hz, which is frequent enough to render the
  // countdown straight from it — no local interval to drift or leak.
  const msLeft = solo ? undefined : board?.msLeft;
  const clock = useMemo(() => {
    if (typeof msLeft !== 'number') return null;
    const total = Math.max(0, Math.ceil(msLeft / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }, [msLeft]);
  const urgent = typeof msLeft === 'number' && msLeft <= 30000;
  const mine = useMemo(
    () => board?.you?.find((y) => y.rank !== null) ?? board?.you?.[0] ?? null,
    [board]
  );

  return (
    <View style={styles.root}>
      <GameCanvas sim={game.sim} width={width} height={height} showFps={__DEV__} />

      {/* ---------------------------------------------------------- score */}
      <View pointerEvents="none" style={[styles.scoreWrap, { top: insets.top + 6 }]}>
        <Text style={styles.scoreText}>{mine ? mine.score : 0}</Text>
      </View>

      {/* ---------------------------------------------------- leaderboard */}
      {clock && (
        <View pointerEvents="none" style={[styles.clock, { top: insets.top + 8, right: insets.right + 10 }]}>
          <Text style={[styles.clockText, urgent && styles.clockUrgent]}>{clock}</Text>
        </View>
      )}

      {board && (
        <View
          pointerEvents="none"
          style={[styles.board, { top: insets.top + (clock ? 28 : 8), right: insets.right + 10 }]}
        >
          {board.top.slice(0, maxRows).map((row) => (
            <View key={row.id} style={styles.boardRow}>
              <Text style={styles.boardRank}>{row.rank === 1 ? '👑' : row.rank}</Text>
              <Text numberOfLines={1} style={styles.boardName}>
                {row.name}
              </Text>
              <Text style={styles.boardScore}>{row.score}</Text>
            </View>
          ))}
          {mine && mine.rank !== null && mine.rank > maxRows && (
            <View style={[styles.boardRow, styles.boardMine]}>
              <Text style={[styles.boardRank, styles.boardMineText]}>{mine.rank}</Text>
              <Text numberOfLines={1} style={[styles.boardName, styles.boardMineText]}>
                {game.me?.username ?? 'You'}
              </Text>
              <Text style={[styles.boardScore, styles.boardMineText]}>{mine.score}</Text>
            </View>
          )}
        </View>
      )}

      {/* ------------------------------------------------------- room code */}
      <View pointerEvents="none" style={[styles.roomPill, { top: insets.top + 10, left: insets.left + 12 }]}>
        <Text style={styles.roomPillText}>{solo ? 'SOLO RUN' : `ROOM ${game.roomCode}`}</Text>
      </View>

      {/* Offline there is nothing to reconnect to, so the warning would lie. */}
      {!solo && game.conn !== 'online' && (
        <View pointerEvents="none" style={[styles.reconnect, { top: insets.top + 46, left: insets.left + 12 }]}>
          <Text style={styles.reconnectText}>Reconnecting…</Text>
        </View>
      )}

      {/* ---------------------------------------------------------- death */}
      {!game.alive && game.death && (
        <View style={styles.deathScrim}>
          <View style={styles.deathCard}>
            <Text style={styles.deathTitle}>You got eaten</Text>
            <Text style={styles.deathSub}>
              {game.death.killer ? `${game.death.killer} got you` : 'You hit the edge'}
            </Text>

            <View style={styles.deathStats}>
              <Stat label="SCORE" value={game.death.score} />
              <Stat label="RANK" value={`#${game.death.rank}`} />
              <Stat label="KILLS" value={game.death.kills} />
            </View>

            <Pressable onPress={game.respawn} style={styles.respawnBtn}>
              <Text style={styles.respawnText}>{solo ? 'Go again' : 'Respawn'}</Text>
            </Pressable>
            {game.isHost && (
              <Pressable onPress={game.endRound} style={styles.endBtn}>
                <Text style={styles.endText}>
                  {solo ? 'Finish run' : 'End round for everyone'}
                </Text>
              </Pressable>
            )}
            <Pressable onPress={game.leaveRoom} style={styles.endBtn}>
              <Text style={styles.endText}>{solo ? 'Back to menu' : 'Leave room'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* -------------------------------------------------------- controls */}
      {/* --------------------------------------------------- solo settings */}
      {solo && game.alive && (
        <Pressable
          onPress={openSettings}
          hitSlop={10}
          style={[styles.gear, { top: insets.top + 8, left: insets.left + 96 }]}
        >
          <Text style={styles.gearIcon}>⚙</Text>
        </Pressable>
      )}

      {solo && draft && (
        <SoloSetupSheet
          visible
          variant="paused"
          settings={draft}
          onChange={setDraft}
          onStart={() => resume(draft)}
          onClose={() => resume(null)}
          onQuit={() => {
            setDraft(null);
            game.leaveRoom();
          }}
          controlSide={controlSide}
          onControlSide={(side) => {
            setControlSide(side);
            void saveControlSide(side);
          }}
        />
      )}

      {game.alive && (
        <>
          {/* Lifted a little off the bottom edge so neither control is clipped
              by a home indicator or a rounded display corner. The stick takes
              the side the player picked; boost always takes the other one, so
              the two never stack up under one thumb. */}
          <View
            style={[
              styles.stick,
              { bottom: insets.bottom + 20 },
              controlSide === 'left'
                ? { left: insets.left + 12 }
                : { right: insets.right + 12 },
            ]}
          >
            <Joystick onAngle={onAngle} />
          </View>
          <View
            style={[
              styles.boost,
              { bottom: insets.bottom + 14 },
              controlSide === 'left'
                ? { right: insets.right + 16 }
                : { left: insets.left + 16 },
            ]}
          >
            <BoostButton
              onChange={onBoost}
              disabled={!!mine && mine.score <= game.sim.meta.boostMinScore}
            />
          </View>
        </>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const OUTLINE = { textShadowColor: 'rgba(6,44,60,0.95)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 3 };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.arena },

  scoreWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  scoreText: { color: '#FFFFFF', fontSize: 34, fontWeight: '900', ...OUTLINE },

  // Round timer, tucked into the corner above the board. Deliberately small:
  // it is glanceable information, not something to draw the eye off the arena.
  clock: {
    position: 'absolute',
    backgroundColor: 'rgba(6,44,60,0.32)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  clockText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
    ...OUTLINE,
  },
  clockUrgent: { color: theme.danger },

  board: {
    position: 'absolute',
    width: 106,
    backgroundColor: theme.panel,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 5,
  },
  boardRow: { flexDirection: 'row', alignItems: 'center' },
  boardRank: { width: 12, fontSize: 9, fontWeight: '700', color: theme.inkDim },
  // Not flex:1 — that pinned the name left and the score right with the whole
  // row's width between them. Shrinking instead keeps the pair together.
  boardName: { flexShrink: 1, fontSize: 9, fontWeight: '500', color: theme.ink },
  boardScore: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.ink,
    marginLeft: 5,
    fontVariant: ['tabular-nums'],
  },
  boardMine: {
    backgroundColor: theme.ink,
    borderRadius: 6,
    marginTop: 2,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  boardMineText: { color: '#FFFFFF' },

  roomPill: {
    position: 'absolute',
    backgroundColor: 'rgba(6,44,60,0.32)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  roomPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 1 },

  gear: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(6,44,60,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearIcon: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },

  reconnect: {
    position: 'absolute',
    backgroundColor: theme.danger,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  reconnectText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },

  deathScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,44,60,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  deathCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
  },
  deathTitle: { fontSize: 26, fontWeight: '900', color: theme.ink },
  deathSub: { fontSize: 14, fontWeight: '700', color: theme.inkDim, marginTop: 4 },
  deathStats: { flexDirection: 'row', marginTop: 18, marginBottom: 20 },
  stat: { alignItems: 'center', paddingHorizontal: 20 },
  statValue: { fontSize: 24, fontWeight: '900', color: theme.ink },
  statLabel: { fontSize: 10, fontWeight: '800', color: theme.inkDim, letterSpacing: 1, marginTop: 2 },

  respawnBtn: {
    backgroundColor: theme.accent,
    borderRadius: 16,
    paddingVertical: 15,
    width: '100%',
    alignItems: 'center',
    borderBottomWidth: 4,
    borderBottomColor: 'rgba(0,0,0,0.22)',
  },
  respawnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  endBtn: { paddingVertical: 12 },
  endText: { color: theme.inkDim, fontSize: 14, fontWeight: '800' },

  // left/right come from safe-area insets at render time — in landscape the
  // display cutout sits on one side and would otherwise cover the joystick.
  stick: { position: 'absolute' },
  boost: { position: 'absolute' },
});
