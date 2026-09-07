import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { PALETTE, useGame } from '../game/useGameSocket';
import { SkinButton } from '../game/SkinGallery';
import { errorText } from '../game/protocol';
import { theme, ui } from '../lib/theme';

/**
 * Two columns, because landscape leaves ~360dp of height: the code and sharing
 * live on the left, the roster and the start button on the right where they
 * stay reachable without scrolling.
 */
export function LobbyScreen() {
  const game = useGame();
  const insets = useSafeAreaInsets();
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);

  const code = game.roomCode ?? '';
  const players = game.lobby?.players ?? [];
  const maxPlayers = game.lobby?.maxPlayers ?? 5;

  /**
   * Keep the roster honest without a refresh button.
   *
   * The server pushes `lobby_state` on every change, so this is a backstop for
   * the pushes that never arrive — a frame dropped on a bad link, or the app
   * coming back from the background having missed the ones sent while it was
   * away. Pull once as the screen opens, again whenever it is foregrounded,
   * and slowly while it sits open, which is when someone is most likely to be
   * joining. A stale roster is the difference between "nobody came" and a
   * player standing in the room unseen.
   */
  const refresh = useRef(game.refreshLobby);
  refresh.current = game.refreshLobby;

  useEffect(() => {
    void refresh.current();
    const timer = setInterval(() => void refresh.current(), 5000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh.current();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [code]);

  const share = useCallback(async () => {
    try {
      await Share.share({ message: `Join my Snake room — code ${code}` });
    } catch {
      /* dismissed */
    }
  }, [code]);

  const start = useCallback(async () => {
    setStarting(true);
    const res = await game.startGame();
    setStarting(false);
    if (!res.ok) Alert.alert('Could not start', errorText(res.error));
  }, [game]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        paddingTop: insets.top + 10,
        paddingBottom: insets.bottom + 10,
        paddingLeft: insets.left + 18,
        paddingRight: insets.right + 18,
      }}
    >
      <Pressable onPress={game.leaveRoom} hitSlop={14} style={{ marginBottom: 4 }}>
        <Text style={{ color: theme.white, fontSize: 15, fontWeight: '800' }}>‹ Leave</Text>
      </Pressable>

      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* -------- left: the code -------- */}
        <View style={{ flex: 1, paddingRight: 14, justifyContent: 'center' }}>
          <Text style={ui.label}>Room code</Text>
          <Pressable onPress={copy}>
            <Text
              style={{
                color: theme.white,
                fontSize: 52,
                fontWeight: '900',
                letterSpacing: 6,
                textShadowColor: theme.outline,
                textShadowOffset: { width: 0, height: 3 },
                textShadowRadius: 0,
              }}
            >
              {code}
            </Text>
          </Pressable>
          <Text style={{ color: theme.white, fontSize: 12, fontWeight: '700', opacity: 0.9 }}>
            {copied ? 'Copied to clipboard' : 'Tap the code to copy it'}
          </Text>
          <Pressable onPress={share} style={[ui.buttonGhost, { marginTop: 10, paddingVertical: 10 }]}>
            <Text style={ui.buttonGhostText}>Share code</Text>
          </Pressable>

          <Text style={[ui.label, { marginTop: 10, marginBottom: 4 }]}>Your snake</Text>
          <SkinButton
            skins={game.skins}
            colors={PALETTE}
            skinIndex={game.skinIndex}
            colorIndex={game.colorIndex}
            onSkin={game.setSkinIndex}
            onColor={game.setColorIndex}
          />
        </View>

        {/* -------- right: roster + start -------- */}
        <View style={{ flex: 1, paddingLeft: 4 }}>
          <Text style={[ui.label, { marginBottom: 6 }]}>
            Players · {players.length}/{maxPlayers}
          </Text>

          <ScrollView
            style={[ui.panel, { flex: 1, paddingVertical: 6 }]}
            contentContainerStyle={{ paddingBottom: 4 }}
          >
            {players.map((p, i) => (
              <View
                key={p.clientId}
                style={[
                  ui.row,
                  {
                    paddingVertical: 8,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: 'rgba(23,56,74,0.12)',
                  },
                ]}
              >
                <View
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 7,
                    backgroundColor: p.color,
                    marginRight: 9,
                  }}
                />
                <Text
                  numberOfLines={1}
                  style={{ color: theme.ink, fontSize: 14, fontWeight: '800', flex: 1 }}
                >
                  {p.username}
                  {p.clientId === game.me?.clientId ? ' (you)' : ''}
                </Text>
                {p.isHost && (
                  <Text style={{ color: theme.inkDim, fontSize: 10, fontWeight: '900' }}>HOST</Text>
                )}
                {!p.connected && (
                  <Text style={{ color: theme.danger, fontSize: 10, marginLeft: 6, fontWeight: '800' }}>
                    offline
                  </Text>
                )}
              </View>
            ))}
            <Text style={{ color: theme.inkDim, fontSize: 11, paddingTop: 8, fontWeight: '600' }}>
              The arena fills out with AI snakes, so it plays well even with two of you.
            </Text>
          </ScrollView>

          {game.isHost ? (
            <Pressable
              onPress={start}
              disabled={starting}
              style={[ui.button, { marginTop: 8, paddingVertical: 13 }, starting && ui.disabled]}
            >
              {starting ? (
                <ActivityIndicator color={theme.white} />
              ) : (
                <Text style={ui.buttonText}>START GAME</Text>
              )}
            </Pressable>
          ) : (
            <View style={[ui.panel, { marginTop: 8, alignItems: 'center', paddingVertical: 12 }]}>
              <Text style={{ color: theme.ink, fontSize: 13, fontWeight: '700' }}>
                Waiting for the host…
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
