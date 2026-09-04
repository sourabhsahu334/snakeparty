import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/**
 * Game sound effects.
 *
 * One player per sound, built on first use and kept for the life of the app: a
 * kill sound has to fire the instant it happens, and loading a file at that
 * moment would land it well after the snake it belongs to has burst.
 *
 * Everything here is deliberately best-effort. A device with audio focus taken
 * by something else, a codec that will not open, a player disposed mid-teardown
 * — none of that is worth interrupting a game over, so every path swallows its
 * error and the game carries on silently.
 */

const kill = require('../../assets/ElevenLabs_selecting_something_in_a__game_short_05sec.mp3');

let killPlayer: AudioPlayer | null = null;
let configured = false;

/**
 * Let the sound through the silent switch and mix with whatever else is
 * playing — nobody wants a game to stop their music to say "you killed a
 * snake".
 */
function configureOnce(): void {
  if (configured) return;
  configured = true;
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'mixWithOthers',
  }).catch(() => {
    /* the sound still plays, just under the phone's own rules */
  });
}

/** Warm the player up, so the first kill of a run is not the slow one. */
export function preloadSfx(): void {
  try {
    configureOnce();
    if (!killPlayer) killPlayer = createAudioPlayer(kill);
  } catch {
    killPlayer = null;
  }
}

/** You killed a snake. */
export function playKill(): void {
  try {
    preloadSfx();
    if (!killPlayer) return;
    // Rewind first: kills come in bursts, and a player already running would
    // otherwise ignore the second one.
    killPlayer.seekTo(0);
    killPlayer.play();
  } catch {
    /* never let a sound take the game down */
  }
}

/** Drop the player when the game screen goes away. */
export function releaseSfx(): void {
  try {
    killPlayer?.remove();
  } catch {
    /* already gone */
  }
  killPlayer = null;
}
