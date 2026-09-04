import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const KEY = 'snake.clientId';

let cached: string | null = null;

/**
 * A stable per-install id. The server uses it to hand your snake back after a
 * dropped connection, so it has to survive an app restart and must not be
 * guessable by another player.
 */
export async function getClientId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {
    // Storage unavailable (e.g. first run on a fresh simulator) — fall through
    // and use an in-memory id for this session.
  }
  const id = Crypto.randomUUID();
  cached = id;
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    /* non-fatal */
  }
  return id;
}
