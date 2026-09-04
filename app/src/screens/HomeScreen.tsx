import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PALETTE, useGame } from '../game/useGameSocket';
import { SkinButton } from '../game/SkinGallery';
import { SoloSetupSheet } from './SoloSetupSheet';
import { errorText } from '../game/protocol';
import {
  DEFAULT_SOLO_SETTINGS,
  describe,
  type SoloSettings,
} from '../game/soloSettings';
import { loadSoloSettings, saveSoloSettings } from '../lib/prefs';
import { SERVER_URL } from '../lib/env';
import {
  getSession,
  setUsername as saveUsername,
  signInAnonymously,
  signInWithGoogleAccount,
  signOut,
  type Session,
} from '../lib/session';
import { googleAvailable } from '../lib/google';
import { theme, ui } from '../lib/theme';

const CODE_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

/** The throwaway name we hand a first-time player — safe to replace with Google's. */
const AUTO_NAME = /^Player\d{3}$/;

/** Constant for the process: the native module and the client IDs cannot change. */
const GOOGLE_ON = googleAvailable();

/**
 * The menu.
 *
 * Two columns, because landscape leaves ~360dp of height: who you are on the
 * left, where you're going on the right. The right column is a two-step —
 * pick a mode, and only Multiplayer opens the room controls. Solo never gets
 * near the socket, so the connection status lives inside that second step
 * rather than on the front page where it would be noise.
 */
export function HomeScreen() {
  const game = useGame();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [step, setStep] = useState<'modes' | 'online'>('modes');
  const [setup, setSetup] = useState(false);
  const [solo, setSolo] = useState<SoloSettings>(DEFAULT_SOLO_SETTINGS);

  // No connection is opened here. Single player must work with the server
  // switched off entirely, so the socket waits until Multiplayer is picked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      setUsername((u) => u || s?.username || `Player${Math.floor(Math.random() * 900 + 100)}`);
      const saved = await loadSoloSettings();
      if (!cancelled) setSolo(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureIdentity = useCallback(async () => {
    const name = username.trim() || 'Player';
    // Everyone gets an identity now, guest or not: it is what the daily room
    // credits are counted against, so there is nothing to gate this on.
    if (!session) {
      const s = await signInAnonymously(name);
      if (s) setSession(s);
    } else if (session.username !== name) {
      const renamed = await saveUsername(name);
      setSession(renamed ?? { ...session, username: name });
    }
    await game.reauthenticate(name);
  }, [game, session, username]);

  const onGoogle = useCallback(async () => {
    setLocalError(null);
    setAuthBusy(true);
    const res = await signInWithGoogleAccount();
    setAuthBusy(false);
    if (res.cancelled) return;
    if (!res.session) {
      setLocalError(res.error ?? 'Google sign-in failed.');
      return;
    }

    // A name the player actually typed beats the Google one; the placeholder
    // we generated at launch does not.
    const typed = username.trim();
    const keep = typed.length > 0 && !AUTO_NAME.test(typed);
    const name = (keep ? typed : res.session.username?.trim() || typed) || 'Player';

    setUsername(name);
    if (name !== res.session.username) {
      await saveUsername(name);
      setSession({ ...res.session, username: name });
    } else {
      setSession(res.session);
    }
    // Hands the socket the new token if one is already open; a no-op otherwise.
    await game.reauthenticate(name);
  }, [game, username]);

  const onSignOut = useCallback(async () => {
    setLocalError(null);
    setAuthBusy(true);
    await signOut();
    setAuthBusy(false);
    setSession(null);
    await game.reauthenticate(username.trim() || 'Player');
  }, [game, username]);

  const startRun = useCallback(() => {
    setSetup(false);
    saveSoloSettings(solo);
    game.startSolo(username, solo);
  }, [game, solo, username]);

  const onMultiplayer = useCallback(() => {
    Alert.alert(
      'Coming soon',
      'Multiplayer rooms are still in the works. Single player is ready to go.',
      [{ text: 'OK' }],
    );
  }, []);

  const onCreate = useCallback(async () => {
    setLocalError(null);
    setBusy('create');
    await ensureIdentity();
    const res = await game.createRoom();
    setBusy(null);
    if (!res.ok) setLocalError(errorText(res.error));
  }, [ensureIdentity, game]);

  const onJoin = useCallback(async () => {
    setLocalError(null);
    if (code.length !== 5) {
      setLocalError('Room codes are 5 characters.');
      return;
    }
    setBusy('join');
    await ensureIdentity();
    const res = await game.joinRoom(code);
    setBusy(null);
    if (!res.ok) setLocalError(errorText(res.error));
  }, [code, ensureIdentity, game]);

  const online = game.conn === 'online';
  const blocked = !online || busy !== null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          paddingTop: insets.top + 10,
          paddingBottom: insets.bottom + 10,
          paddingLeft: insets.left + 18,
          paddingRight: insets.right + 18,
        }}
      >
        {/* ---------------- left: who you are ---------------- */}
        <View style={styles.left}>
          <Text style={styles.title}>SNAKE PARTY</Text>

          <Text style={[styles.label, { marginTop: 12 }]}>Your name</Text>
          <TextInput
            style={[ui.input, styles.nameInput]}
            value={username}
            onChangeText={(t) => setUsername(t.slice(0, 20))}
            placeholder="Player"
            placeholderTextColor={theme.inkDim}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
          />

          {GOOGLE_ON ? (
            session && !session.isGuest ? (
              <View style={styles.account}>
                <View style={styles.gBadge}>
                  <Text style={styles.gBadgeText}>G</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.accountName}>
                    {session.username ?? 'Signed in'}
                  </Text>
                  <Text numberOfLines={1} style={styles.accountMail}>
                    {session.email ?? 'Google account'}
                  </Text>
                </View>
                <Pressable onPress={onSignOut} disabled={authBusy} hitSlop={12}>
                  <Text style={styles.signOut}>{authBusy ? '…' : 'SIGN OUT'}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={onGoogle}
                disabled={authBusy}
                style={({ pressed }) => [
                  styles.account,
                  styles.googleButton,
                  pressed && styles.cardPressed,
                  authBusy && ui.disabled,
                ]}
              >
                <View style={styles.gBadge}>
                  <Text style={styles.gBadgeText}>G</Text>
                </View>
                {authBusy ? (
                  <ActivityIndicator color={theme.ink} size="small" />
                ) : (
                  <Text style={styles.googleText}>SIGN IN WITH GOOGLE</Text>
                )}
              </Pressable>
            )
          ) : null}

          <Text style={[styles.label, { marginTop: 12 }]}>Your snake</Text>
          <SkinButton
            skins={game.skins}
            colors={PALETTE}
            skinIndex={game.skinIndex}
            colorIndex={game.colorIndex}
            onSkin={game.setSkinIndex}
            onColor={game.setColorIndex}
            playerName={username.trim() || 'Player'}
          />
        </View>

        {/* ---------------- right: where you're going ---------------- */}
        <View style={styles.right}>
          {step === 'modes' ? (
            <>
              <ModeCard
                primary
                icon="▶"
                title="SINGLE PLAYER"
                blurb={describe(solo)}
                onPress={() => setSetup(true)}
              />
              <ModeCard
                icon="⚔"
                title="MULTIPLAYER"
                blurb="Make a room, or join a friend with their 5-letter code."
                onPress={onMultiplayer}
              />
            </>
          ) : (
            <>
              <View style={[ui.row, { marginBottom: 8 }]}>
                <Pressable onPress={() => setStep('modes')} hitSlop={12}>
                  <Text style={styles.back}>
                    <Text style={styles.backArrow}>‹</Text> Modes
                  </Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <View
                  style={[styles.dot, { backgroundColor: online ? theme.good : theme.danger }]}
                />
                <Text numberOfLines={1} style={styles.status}>
                  {online ? 'Connected' : game.conn === 'offline' ? 'No server' : 'Connecting…'}
                </Text>
              </View>

              <Pressable
                onPress={onCreate}
                disabled={blocked}
                style={[ui.button, blocked && ui.disabled]}
              >
                {busy === 'create' ? (
                  <ActivityIndicator color={theme.ink} size="small" />
                ) : (
                  <Text style={styles.buttonText}>CREATE ROOM</Text>
                )}
              </Pressable>

              <View style={styles.divider}>
                <View style={styles.rule} />
                <Text style={styles.dividerText}>OR JOIN A CODE</Text>
                <View style={styles.rule} />
              </View>

              <View style={ui.row}>
                <TextInput
                  style={[ui.input, styles.codeInput]}
                  value={code}
                  onChangeText={(t) =>
                    setCode(t.toUpperCase().replace(CODE_CHARS, '').slice(0, 5))
                  }
                  placeholder="ABCDE"
                  placeholderTextColor="#B9D7E0"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={5}
                  returnKeyType="go"
                  onSubmitEditing={onJoin}
                />
                <Pressable
                  onPress={onJoin}
                  disabled={blocked || code.length !== 5}
                  style={[
                    ui.button,
                    styles.joinButton,
                    (blocked || code.length !== 5) && ui.disabled,
                  ]}
                >
                  {busy === 'join' ? (
                    <ActivityIndicator color={theme.ink} size="small" />
                  ) : (
                    <Text style={styles.buttonText}>JOIN</Text>
                  )}
                </Pressable>
              </View>

              {localError || game.error ? (
                <Text numberOfLines={2} style={[ui.error, styles.errorText]}>
                  {localError ?? game.error}
                </Text>
              ) : (
                <Text numberOfLines={1} style={styles.server}>
                  {SERVER_URL.replace(/^https?:\/\//, '')}
                  {session && !session.isGuest ? ' · history on' : ' · guest'}
                </Text>
              )}
            </>
          )}
        </View>
      </View>

      <SoloSetupSheet
        visible={setup}
        settings={solo}
        onChange={setSolo}
        onStart={startRun}
        onClose={() => setSetup(false)}
      />
    </KeyboardAvoidingView>
  );
}

/** One of the two ways in. The primary one is filled; the other is a ghost. */
function ModeCard({
  icon,
  title,
  blurb,
  onPress,
  primary,
  tag,
}: {
  icon: string;
  title: string;
  blurb: string;
  onPress: () => void;
  primary?: boolean;
  /** A short pill after the title — 'SOON' for a mode that is not live yet. */
  tag?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        primary ? styles.cardPrimary : styles.cardGhost,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={[styles.badge, primary ? styles.badgePrimary : styles.badgeGhost]}>
        <Text style={[styles.badgeIcon, primary && { color: theme.accent }]}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle}>{title}</Text>
          {tag ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={2} style={styles.cardBlurb}>
          {blurb}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  left: { flex: 1.15, paddingRight: 14, justifyContent: 'center' },
  right: { flex: 1, justifyContent: 'center' },

  // The menu sits on bright cyan, so every word on it is dark ink. The shared
  // `ui` type is white for the in-game HUD; these override it here only.
  title: {
    color: theme.ink,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  label: {
    color: theme.ink,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 5,
    opacity: 0.85,
  },
  nameInput: { fontSize: 18 },

  // Sits between the name field and the snake picker, so "who you are" reads as
  // one block: the name you show, and the account it is attached to.
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    borderRadius: theme.radius,
    paddingVertical: 7,
    paddingHorizontal: 9,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  googleButton: {
    justifyContent: 'center',
    backgroundColor: theme.white,
    borderBottomWidth: 3,
    borderBottomColor: 'rgba(0,0,0,0.14)',
  },
  googleText: { color: theme.ink, fontSize: 14, fontWeight: '900', letterSpacing: 0.6 },
  gBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.white,
    borderWidth: 1.5,
    borderColor: 'rgba(23,56,74,0.25)',
  },
  gBadgeText: { color: '#4285F4', fontSize: 15, fontWeight: '900' },
  accountName: { color: theme.ink, fontSize: 14, fontWeight: '900' },
  accountMail: { color: theme.ink, fontSize: 11, fontWeight: '700', opacity: 0.7 },
  signOut: {
    color: theme.ink,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    opacity: 0.8,
    paddingLeft: 8,
  },
  buttonText: {
    color: theme.ink,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  errorText: { fontSize: 14 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.radius,
    paddingVertical: 10,
    paddingHorizontal: 11,
    marginBottom: 9,
    borderBottomWidth: 3,
  },
  cardPrimary: {
    backgroundColor: theme.accent,
    borderBottomColor: 'rgba(0,0,0,0.22)',
  },
  cardGhost: {
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderBottomColor: 'rgba(0,0,0,0.14)',
  },
  // Push the card down onto its own shadow, so a tap reads as a press.
  cardPressed: { transform: [{ translateY: 2 }], borderBottomWidth: 1, marginBottom: 11 },

  badge: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  badgePrimary: { backgroundColor: theme.white },
  badgeGhost: { backgroundColor: 'rgba(255,255,255,0.4)' },
  badgeIcon: { fontSize: 18, fontWeight: '900', color: theme.ink },

  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: theme.gold,
  },
  tagText: { color: theme.ink, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },

  cardTitle: {
    color: theme.ink,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  cardBlurb: {
    color: theme.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    opacity: 0.9,
    marginTop: 2,
  },
  chevron: { color: theme.ink, fontSize: 26, fontWeight: '900', opacity: 0.8, marginLeft: 4 },

  back: { color: theme.ink, fontSize: 20, fontWeight: '900' },
  backArrow: { fontSize: 30, fontWeight: '900', lineHeight: 22 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  status: { color: theme.ink, fontSize: 13, fontWeight: '800', opacity: 0.95 },

  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 10 },
  rule: { flex: 1, height: 1.5, backgroundColor: 'rgba(23,56,74,0.35)' },
  dividerText: {
    color: theme.ink,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginHorizontal: 8,
    opacity: 0.9,
  },

  codeInput: {
    flex: 1,
    letterSpacing: 5,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  joinButton: { marginLeft: 7, paddingHorizontal: 16 },

  server: {
    color: theme.ink,
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.75,
    marginTop: 8,
    textAlign: 'center',
  },
});
