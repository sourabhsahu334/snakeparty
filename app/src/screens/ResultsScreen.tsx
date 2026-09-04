import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGame } from '../game/useGameSocket';
import { theme, ui } from '../lib/theme';

const MEDALS = ['🥇', '🥈', '🥉'];

export function ResultsScreen() {
  const game = useGame();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const results = game.results;
  const meIndex = game.me?.index;

  const again = useCallback(async () => {
    setBusy(true);
    await game.playAgain();
    setBusy(false);
  }, [game]);

  if (!results) return null;
  const solo = game.mode === 'solo';
  const iWon = results.winner?.index === meIndex;

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        backgroundColor: theme.bg,
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 12,
        paddingLeft: insets.left + 20,
        paddingRight: insets.right + 20,
      }}
    >
      {/* -------- left: headline + actions -------- */}
      <View style={{ flex: 1, paddingRight: 16, justifyContent: 'center' }}>
        <Text style={ui.title}>
          {iWon ? 'YOU WIN!' : solo ? 'RUN OVER' : 'ROUND OVER'}
        </Text>
        <Text style={[ui.subtitle, { marginTop: 3 }]}>
          {results.winner ? `${results.winner.username} topped the board` : 'Nobody survived'}
          {' · '}
          {Math.round(results.durationMs / 1000)}s
        </Text>

        {game.isHost ? (
          <Pressable onPress={again} disabled={busy} style={[ui.button, { marginTop: 16 }, busy && ui.disabled]}>
            {busy ? (
              <ActivityIndicator color={theme.white} size="small" />
            ) : (
              <Text style={ui.buttonText}>{solo ? 'RUN AGAIN' : 'PLAY AGAIN'}</Text>
            )}
          </Pressable>
        ) : (
          <View style={[ui.panel, { marginTop: 16, alignItems: 'center', paddingVertical: 12 }]}>
            <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 13 }}>
              Waiting for the host…
            </Text>
          </View>
        )}

        <Pressable onPress={game.leaveRoom} style={[ui.buttonGhost, { marginTop: 8, paddingVertical: 11 }]}>
          <Text style={ui.buttonGhostText}>Back to menu</Text>
        </Pressable>
      </View>

      {/* -------- right: the board -------- */}
      <ScrollView style={[ui.panel, { flex: 1, paddingVertical: 6 }]}>
        {results.results.map((r, i) => (
          <View
            key={r.clientId}
            style={[
              ui.row,
              {
                paddingVertical: 9,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: 'rgba(23,56,74,0.12)',
              },
            ]}
          >
            <Text style={{ fontSize: 15, width: 28 }}>
              {MEDALS[r.placement - 1] ?? `${r.placement}.`}
            </Text>
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: r.index === meIndex ? theme.accent : theme.ink,
                  fontSize: 15,
                  fontWeight: '900',
                }}
              >
                {r.username}
                {r.index === meIndex ? ' (you)' : ''}
              </Text>
              <Text style={{ color: theme.inkDim, fontSize: 10, fontWeight: '700' }}>
                {r.kills} {r.kills === 1 ? 'kill' : 'kills'}
                {r.survived ? ' · survived' : ''}
              </Text>
            </View>
            <Text style={{ color: theme.ink, fontSize: 18, fontWeight: '900' }}>{r.score}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
