import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  /** How many beats to count down from. One beat = one second. */
  seconds?: number;
  /** Fired the instant the count reaches zero, so the caller can unpause. */
  onDone: () => void;
};

/**
 * Full-screen "3, 2, 1" beat before a run actually starts or resumes. Sits on
 * top of everything else on the arena screen and swallows touches itself, so
 * a trigger-happy thumb can't reach the joystick or the gear icon a beat
 * early — the snake is already sitting there (paused by the caller), this is
 * just the countdown to letting go of it.
 */
export function Countdown({ seconds = 3, onDone }: Props) {
  const [n, setN] = useState(seconds);
  const scale = useSharedValue(1.4);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (n <= 0) {
      onDone();
      return;
    }
    scale.value = 1.4;
    opacity.value = 0;
    scale.value = withTiming(1, { duration: 220 });
    opacity.value = withTiming(1, { duration: 220 });
    const t = setTimeout(() => setN((v) => v - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  const numberStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (n <= 0) return null;

  return (
    <View style={styles.scrim} pointerEvents="auto">
      <Animated.Text style={[styles.number, numberStyle]}>{n}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,44,60,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  number: {
    color: '#FFFFFF',
    fontSize: 108,
    fontWeight: '900',
    textShadowColor: 'rgba(6,44,60,0.95)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
});
