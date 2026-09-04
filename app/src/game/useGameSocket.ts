import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, type Socket } from 'socket.io-client';

import { SERVER_URL } from '../lib/env';
import { getClientId } from '../lib/clientId';
import { loadLook, saveLook } from '../lib/prefs';
import { getSession } from '../lib/supabaseClient';
import { GameSimulation } from './prediction';
import { PALETTE } from './palette';
import { SoloGame } from './soloGame';
import { DEFAULT_SOLO_SETTINGS, type SoloSettings } from './soloSettings';
import { LOCAL_SKINS } from './skins.catalog';
import { playKill, preloadSfx } from '../lib/sfx';
import type {
  DeathInfo,
  GameMeta,
  Skin,
  GameOver,
  JoinAck,
  Leaderboard,
  LobbyState,
  ViewUpdate,
} from './protocol';

/** Re-exported so screens keep one import for everything game-related. */
export { PALETTE };

export type Phase = 'home' | 'lobby' | 'playing' | 'results';
/** 'solo' runs entirely on the device; 'online' needs the server. */
export type Mode = 'solo' | 'online';
export type ConnState = 'offline' | 'connecting' | 'online' | 'reconnecting';

export type Me = {
  index: number;
  clientId: string;
  username: string;
  color: string;
  colorIndex: number;
  skinIndex: number;
};


type Ack = { ok: boolean; error?: string };

export type GameSocket = {
  conn: ConnState;
  phase: Phase;
  /** null until a game starts. 'solo' never touches the socket. */
  mode: Mode | null;
  error: string | null;
  clearError: () => void;

  roomCode: string | null;
  lobby: LobbyState | null;
  me: Me | null;
  isHost: boolean;
  results: GameOver | null;

  /** Mutable simulation. Read it from a render loop — it is not React state. */
  sim: GameSimulation;
  leaderboard: Leaderboard | null;
  death: DeathInfo | null;
  alive: boolean;

  /**
   * Start an offline run. No socket, no room, no server — the arena is ticked
   * on the device. Returns immediately into the playing phase.
   */
  startSolo: (username: string, settings?: SoloSettings) => void;
  /** Solo only. Freezes the arena *and* the render loop's prediction. */
  pauseSolo: () => void;
  /** Unfreeze, optionally re-tuning the run on the way back in. */
  resumeSolo: (settings?: SoloSettings) => void;
  paused: boolean;
  soloSettings: SoloSettings;
  connect: (username: string) => Promise<void>;
  /** Re-handshake with a fresh token / display name (after signing in). */
  reauthenticate: (username: string) => Promise<void>;
  createRoom: () => Promise<Ack>;
  joinRoom: (code: string) => Promise<Ack>;
  colorIndex: number;
  setColorIndex: (index: number) => void;
  skinIndex: number;
  setSkinIndex: (index: number) => void;
  /** Skin catalogue — the server's once a game starts, a local copy before. */
  skins: Skin[];
  startGame: () => Promise<Ack>;
  playAgain: () => Promise<Ack>;
  respawn: () => Promise<Ack>;
  endRound: () => Promise<Ack>;
  leaveRoom: () => void;
  /** Steering. Applied locally at once, then sent to the server. */
  setAngle: (angle: number) => void;
  setBoost: (on: boolean) => void;
};

const Ctx = createContext<GameSocket | null>(null);

/**
 * One socket for the whole app. Screens read from here rather than each opening
 * their own connection, and the simulation lives in a ref so 20 state updates a
 * second don't turn into 20 React re-renders.
 */
export function useGameSocket(): GameSocket {
  const socketRef = useRef<Socket | null>(null);
  const soloRef = useRef<SoloGame | null>(null);
  const modeRef = useRef<Mode | null>(null);
  const simRef = useRef<GameSimulation>(new GameSimulation());
  const meRef = useRef<Me | null>(null);
  const roomRef = useRef<string | null>(null);
  /** Set while a round is live, so a reconnect knows to rejoin rather than idle. */
  const wantRejoinRef = useRef(false);
  const phaseRef = useRef<Phase>('home');

  const [conn, setConn] = useState<ConnState>('offline');
  const [phase, setPhase] = useState<Phase>('home');
  const [mode, setModeState] = useState<Mode | null>(null);
  const [paused, setPaused] = useState(false);
  const [soloSettings, setSoloSettings] = useState<SoloSettings>(DEFAULT_SOLO_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [results, setResults] = useState<GameOver | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [death, setDeath] = useState<DeathInfo | null>(null);
  const [alive, setAlive] = useState(false);
  const [colorIndex, setColorIndexState] = useState(0);
  const colorRef = useRef(0);
  const [skinIndex, setSkinIndexState] = useState(0);
  const skinRef = useRef(0);
  const [skins, setSkins] = useState<Skin[]>(LOCAL_SKINS);

  // Restore the remembered look on mount.
  useEffect(() => {
    loadLook().then(({ colorIndex: c, skinIndex: k }) => {
      colorRef.current = c;
      setColorIndexState(c);
      skinRef.current = k;
      setSkinIndexState(k);
    });
  }, []);

  /**
   * Pick a skin. Applied locally at once, persisted, and pushed to the server
   * if we're already sitting in a lobby so everyone sees the change.
   */
  const setColorIndex = useCallback((index: number) => {
    colorRef.current = index;
    setColorIndexState(index);
    saveLook({ colorIndex: index, skinIndex: skinRef.current });
    socketRef.current?.emit('set_look', { colorIndex: index, skinIndex: skinRef.current });
  }, []);

  const setSkinIndex = useCallback((index: number) => {
    skinRef.current = index;
    setSkinIndexState(index);
    saveLook({ colorIndex: colorRef.current, skinIndex: index });
    socketRef.current?.emit('set_look', { colorIndex: colorRef.current, skinIndex: index });
  }, []);

  const setMeBoth = useCallback((m: Me | null) => {
    meRef.current = m;
    setMe(m);
  }, []);

  const setRoomBoth = useCallback((c: string | null) => {
    roomRef.current = c;
    setRoomCode(c);
  }, []);

  const setMode = useCallback((m: Mode | null) => {
    modeRef.current = m;
    setModeState(m);
  }, []);

  // ------------------------------------------------------------------- solo

  const stopSolo = useCallback(() => {
    soloRef.current?.stop();
    soloRef.current = null;
    setPaused(false);
  }, []);

  const pauseSolo = useCallback(() => {
    const solo = soloRef.current;
    if (!solo || !solo.isRunning) return;
    solo.pause();
    simRef.current.setPaused(true);
    setPaused(true);
  }, []);

  const resumeSolo = useCallback((settings?: SoloSettings) => {
    const solo = soloRef.current;
    if (!solo) return;
    if (settings) {
      solo.applySettings(settings);
      // The sim holds its own copy of the meta, and predicts the player's
      // snake from it — hand it the re-tuned one or it keeps using the old
      // speed and fights the arena all the way back.
      simRef.current.setMeta(solo.meta);
      soloSettingsRef.current = settings;
      setSoloSettings(settings);
    }
    simRef.current.setPaused(false);
    solo.resume();
    setPaused(false);
  }, []);

  /**
   * Spin up the offline arena.
   *
   * It reports through the same callbacks the socket's handlers use, so from
   * here down — prediction, canvas, HUD, death card — nothing knows the
   * difference between a solo run and a networked one.
   */
  /** The rules the current run was started with, so 'run again' repeats them. */
  const soloSettingsRef = useRef<SoloSettings>(DEFAULT_SOLO_SETTINGS);

  const startSolo = useCallback(
    (username: string, settings?: SoloSettings) => {
      stopSolo();
      const name = username.trim() || 'You';
      if (settings) {
        soloSettingsRef.current = settings;
        setSoloSettings(settings);
      }
      setPaused(false);

      simRef.current.reset();
      preloadSfx();
      const solo = new SoloGame(
        {
          name,
          colorIndex: colorRef.current,
          skinIndex: skinRef.current,
          skins: LOCAL_SKINS,
          settings: soloSettingsRef.current,
        },
        {
          onView: (v) => {
            simRef.current.applyView(v);
            setAlive((prev) => (prev === (v.alive === 1) ? prev : v.alive === 1));
          },
          onLeaderboard: (b) => setLeaderboard(b),
          onKill: () => playKill(),
          onDeath: (d) => {
            setDeath(d);
            setAlive(false);
          },
        }
      );
      soloRef.current = solo;
      simRef.current.setMeta(solo.meta);

      setSkins(LOCAL_SKINS);
      setMode('solo');
      setMeBoth({
        index: 0,
        clientId: 'solo',
        username: name,
        color: PALETTE[colorRef.current] ?? PALETTE[0],
        colorIndex: colorRef.current,
        skinIndex: skinRef.current,
      });
      setRoomBoth(null);
      setLobby(null);
      setResults(null);
      setDeath(null);
      setLeaderboard(null);
      setAlive(true);
      setPhase('playing');
      solo.start();
    },
    [setMeBoth, setMode, setRoomBoth, stopSolo]
  );

  // ------------------------------------------------------------- connection

  const connect = useCallback(
    async (username: string) => {
      // Multiplayer can now be opened, backed out of and opened again, so this
      // has to be safe to call repeatedly: build the socket once and reuse it,
      // or each visit leaks another live connection.
      const existing = socketRef.current;
      if (existing) {
        if (!existing.connected) existing.connect();
        return;
      }

      const [clientId, session] = await Promise.all([getClientId(), getSession()]);
      setConn('connecting');

      const socket = io(SERVER_URL, {
        transports: ['websocket'],
        auth: {
          clientId,
          username,
          accessToken: session?.accessToken,
          colorIndex: colorRef.current,
          skinIndex: skinRef.current,
        },
        // ngrok shows an interstitial warning page to browser-like clients on
        // its free tier; this header opts out of it.
        extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
        timeout: 8000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setConn('online');
        setError(null);

        // Came back after a drop mid-round: reclaim the seat the server held.
        if (wantRejoinRef.current && roomRef.current) {
          socket.emit('rejoin_room', { code: roomRef.current }, (res: JoinAck) => {
            if (!res.ok) {
              wantRejoinRef.current = false;
              setRoomBoth(null);
              setPhase('home');
              setError('Lost your seat in that room.');
              return;
            }
            setMeBoth(res.you);
            setLobby(res.lobby);
            if (res.status === 'running' && res.meta) {
              simRef.current.reset();
              simRef.current.setMeta(res.meta);
              setPhase('playing');
            } else {
              setPhase('lobby');
            }
          });
        }
      });

      socket.io.on('reconnect_attempt', () => setConn('reconnecting'));
      socket.on('disconnect', () => setConn('reconnecting'));
      socket.on('connect_error', (err: Error) => {
        setConn('offline');
        setError(`Can't reach the game server (${SERVER_URL}).`);
        console.warn('[socket] connect_error', err.message);
      });

      // -------------------------------------------------------- game events

      socket.on('lobby_state', (state: LobbyState) => {
        setLobby(state);
        // The host reset the room while we were looking at the scoreboard.
        if (state.status === 'lobby' && phaseRef.current === 'results') {
          simRef.current.reset();
          setResults(null);
          setPhase('lobby');
        }
      });

      socket.on('game_start', (meta: GameMeta) => {
        simRef.current.reset();
        simRef.current.setMeta(meta);
        // The server owns the catalogue; adopt it so the picker and the arena
        // can never disagree about what a skin looks like.
        if (meta.skins?.length) setSkins(meta.skins);
        setResults(null);
        setDeath(null);
        setAlive(true);
        wantRejoinRef.current = true;
        setPhase('playing');
      });

      socket.on('view', (v: ViewUpdate) => {
        simRef.current.applyView(v);
        // Cheap enough to mirror into React: it only flips on death/respawn.
        setAlive((prev) => (prev === (v.alive === 1) ? prev : v.alive === 1));
      });

      socket.on('leaderboard', (b: Leaderboard) => setLeaderboard(b));

      // The online half of the same signal the solo sim raises through onKill.
      socket.on('you_killed', () => playKill());

      socket.on('you_died', (info: DeathInfo) => {
        setDeath(info);
        setAlive(false);
      });

      socket.on('game_over', (payload: GameOver) => {
        wantRejoinRef.current = false;
        setResults(payload);
        setPhase('results');
      });

      socket.on('player_left', () => {
        /* lobby_state follows immediately; nothing extra to do */
      });
    },
    [setMeBoth, setRoomBoth]
  );

  /**
   * Re-open the handshake with the current credentials.
   *
   * Anonymous sign-in happens *after* the socket is already up, so without this
   * the server would still see the guest that connected at launch and the match
   * result would be written with no user id attached. Also picks up a display
   * name the player edited on the home screen.
   */
  const reauthenticate = useCallback(async (username: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    const [clientId, session] = await Promise.all([getClientId(), getSession()]);
    const next = {
      clientId,
      username,
      accessToken: session?.accessToken,
      colorIndex: colorRef.current,
      skinIndex: skinRef.current,
    };
    const current = socket.auth as Record<string, unknown> | undefined;

    if (
      socket.connected &&
      current?.username === next.username &&
      current?.accessToken === next.accessToken
    ) {
      return; // nothing changed — don't churn the connection
    }

    socket.auth = next;
    await new Promise<void>((resolve) => {
      const done = () => {
        socket.off('connect', done);
        resolve();
      };
      socket.on('connect', done);
      if (socket.connected) socket.disconnect();
      socket.connect();
      setTimeout(done, 5000);
    });
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    return () => {
      soloRef.current?.stop();
      soloRef.current = null;
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------- actions

  const request = useCallback(<T extends Ack>(event: string, payload?: unknown): Promise<T> => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      return Promise.resolve({ ok: false, error: 'OFFLINE' } as T);
    }
    return new Promise<T>((resolve) => {
      let settled = false;
      const done = (res: T) => {
        if (settled) return;
        settled = true;
        resolve(res);
      };
      socket.emit(event, payload ?? {}, done);
      setTimeout(() => done({ ok: false, error: 'TIMEOUT' } as T), 8000);
    });
  }, []);

  const createRoom = useCallback(async () => {
    const res = await request<JoinAck & Ack>('create_room', {
      colorIndex: colorRef.current,
      skinIndex: skinRef.current,
    });
    if (res.ok) {
      setMode('online');
      setRoomBoth(res.code);
      setMeBoth(res.you);
      setLobby(res.lobby);
      setPhase('lobby');
    }
    return res;
  }, [request, setMeBoth, setMode, setRoomBoth]);

  const joinRoom = useCallback(
    async (code: string) => {
      const res = await request<JoinAck & Ack>('join_room', {
        code: code.trim().toUpperCase(),
        colorIndex: colorRef.current,
        skinIndex: skinRef.current,
      });
      if (res.ok) {
        setMode('online');
        setRoomBoth(res.code);
        setMeBoth(res.you);
        setLobby(res.lobby);
        setPhase('lobby');
      }
      return res;
    },
    [request, setMeBoth, setMode, setRoomBoth]
  );

  const startGame = useCallback(() => request('start_game'), [request]);

  const playAgain = useCallback(async () => {
    if (modeRef.current === 'solo') {
      startSolo(meRef.current?.username ?? 'You');
      return { ok: true };
    }
    const res = await request('play_again');
    if (res.ok) {
      setResults(null);
      setDeath(null);
      setLeaderboard(null);
      simRef.current.reset();
      setPhase('lobby');
    }
    return res;
  }, [request, startSolo]);

  const leaveRoom = useCallback(() => {
    if (modeRef.current === 'solo') stopSolo();
    else socketRef.current?.emit('leave_room', {});
    setMode(null);
    wantRejoinRef.current = false;
    simRef.current.reset();
    setRoomBoth(null);
    setLobby(null);
    setMeBoth(null);
    setResults(null);
    setDeath(null);
    setLeaderboard(null);
    setPhase('home');
  }, [setMeBoth, setMode, setRoomBoth, stopSolo]);

  /**
   * Hot path. The heading is applied to the local simulation immediately so the
   * snake responds this frame, and pushed to the server on a fixed 20Hz clock —
   * sending one packet per joystick sample would blow straight through the
   * server's rate limit.
   */
  const setAngle = useCallback((angle: number) => {
    simRef.current.setDesiredAngle(angle);
    pushSoloInput();
  }, []);

  const setBoost = useCallback((on: boolean) => {
    simRef.current.setBoosting(on);
    pushSoloInput();
  }, []);

  /**
   * Offline there is nobody to send to, so input goes straight into the arena
   * on the frame it happens rather than waiting for the 20Hz uplink below.
   */
  function pushSoloInput() {
    const solo = soloRef.current;
    if (!solo) return;
    const { a, b } = simRef.current.getInput();
    solo.setInput(a, b);
  }

  useEffect(() => {
    if (phase !== 'playing' || modeRef.current === 'solo') return;
    const id = setInterval(() => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return;
      socket.emit('set_input', simRef.current.getInput());
    }, 50);
    return () => clearInterval(id);
  }, [phase]);

  const respawn = useCallback(async () => {
    const solo = soloRef.current;
    if (solo) {
      solo.respawn();
      setDeath(null);
      setAlive(true);
      return { ok: true };
    }
    const res = await request('respawn');
    if (res.ok) {
      setDeath(null);
      setAlive(true);
    }
    return res;
  }, [request]);

  /** Online: the host ends the round for everyone. Solo: bank the run. */
  const endRound = useCallback(async () => {
    const solo = soloRef.current;
    if (solo) {
      setResults(solo.summary());
      solo.stop();
      setPhase('results');
      return { ok: true };
    }
    return request('end_round');
  }, [request]);

  const isHost = useMemo(
    () => mode === 'solo' || (!!lobby && !!me && lobby.hostClientId === me.clientId),
    [lobby, me, mode]
  );

  return {
    conn,
    phase,
    mode,
    error,
    clearError: () => setError(null),
    roomCode,
    lobby,
    me,
    isHost,
    results,
    sim: simRef.current,
    leaderboard,
    death,
    alive,
    paused,
    soloSettings,
    startSolo,
    pauseSolo,
    resumeSolo,
    connect,
    reauthenticate,
    createRoom,
    joinRoom,
    colorIndex,
    setColorIndex,
    skinIndex,
    setSkinIndex,
    skins,
    startGame,
    playAgain,
    respawn,
    endRound,
    leaveRoom,
    setAngle,
    setBoost,
  };
}

export const GameSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const value = useGameSocket();
  return React.createElement(Ctx.Provider, { value }, children);
};

export function useGame(): GameSocket {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGame must be used inside <GameSocketProvider>');
  return ctx;
}
