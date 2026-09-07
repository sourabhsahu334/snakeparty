import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clampSettings,
  DEFAULT_SOLO_SETTINGS,
  type SoloSettings,
} from '../game/soloSettings';

const COLOR_KEY = 'snake.colorIndex';
const SKIN_KEY = 'snake.skinIndex';

export type Look = { colorIndex: number; skinIndex: number };

/** Remembered appearance, so you don't re-pick every launch. */
export async function loadLook(): Promise<Look> {
  try {
    const [c, k] = await Promise.all([
      AsyncStorage.getItem(COLOR_KEY),
      AsyncStorage.getItem(SKIN_KEY),
    ]);
    return { colorIndex: toIndex(c), skinIndex: toIndex(k) };
  } catch {
    return { colorIndex: 0, skinIndex: 0 };
  }
}

export async function saveLook({ colorIndex, skinIndex }: Look): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(COLOR_KEY, String(colorIndex)),
      AsyncStorage.setItem(SKIN_KEY, String(skinIndex)),
    ]);
  } catch {
    /* non-fatal — the choice just won't survive a restart */
  }
}

function toIndex(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

const SOLO_KEY = 'snake.soloSettings';

/** Remembered single-player rules. Bad or missing JSON falls back to defaults. */
export async function loadSoloSettings(): Promise<SoloSettings> {
  try {
    const raw = await AsyncStorage.getItem(SOLO_KEY);
    return clampSettings(raw ? (JSON.parse(raw) as Partial<SoloSettings>) : null);
  } catch {
    return DEFAULT_SOLO_SETTINGS;
  }
}

export async function saveSoloSettings(s: SoloSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SOLO_KEY, JSON.stringify(s));
  } catch {
    /* non-fatal — the choice just won't survive a restart */
  }
}

const CONTROL_SIDE_KEY = 'snake.controlSide';

/** Which side of the screen the joystick sits on. Boost takes the other one. */
export type ControlSide = 'left' | 'right';

export const DEFAULT_CONTROL_SIDE: ControlSide = 'left';

/**
 * Handedness. Deliberately not part of SoloSettings: it is how you hold the
 * phone, not a rule of the run, so "Reset" must not flip it back and it has to
 * apply in multiplayer too.
 */
export async function loadControlSide(): Promise<ControlSide> {
  try {
    const raw = await AsyncStorage.getItem(CONTROL_SIDE_KEY);
    return raw === 'right' || raw === 'left' ? raw : DEFAULT_CONTROL_SIDE;
  } catch {
    return DEFAULT_CONTROL_SIDE;
  }
}

export async function saveControlSide(side: ControlSide): Promise<void> {
  try {
    await AsyncStorage.setItem(CONTROL_SIDE_KEY, side);
  } catch {
    /* non-fatal — the choice just won't survive a restart */
  }
}
