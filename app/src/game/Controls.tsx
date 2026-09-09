import React, { useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * The ring itself is thumb-sized, not hand-sized — anything wider starts
 * eating the arena the player is trying to steer through. The knob keeps its
 * share of the ring so the throw still reads the same.
 */
const STICK_SIZE = 104;
const HALF_STICK = STICK_SIZE / 2;
const KNOB_SIZE = 42;
const MAX_OFFSET = (STICK_SIZE - KNOB_SIZE) / 2;

/**
 * The boost pad. Deliberately smaller than the stick — it is a hold, not a
 * drag, so it only needs to be found, not aimed. `BOOST_SLOP` keeps the
 * touch target comfortably past the 44dp minimum without the pad itself
 * taking a quarter of a landscape screen.
 */
const BOOST_W = 72;
const BOOST_H = 80;
const BOOST_SLOP = 12;

type JoystickProps = {
  /** Fired with a heading in radians whenever the stick moves. */
  onAngle: (angle: number) => void;
};

/** Don't wake the JS thread unless the heading actually changed. */
const ANGLE_EPSILON = 0.025;

/**
 * Snake.io-style floating joystick: touch down anywhere in the zone and the
 * translucent ring spawns right under the thumb — it doesn't sit parked at a
 * fixed spot. Drag from there to steer, same as before; lift off and it fades
 * out, ready to reappear wherever the next touch lands. Reports an absolute
 * heading rather than a delta, which is what the server wants — it decides
 * how fast the snake may turn toward it.
 *
 * The ring/knob are driven by Reanimated shared values so dragging never
 * re-renders React. Touch events arrive at up to 120Hz; calling setState on
 * each one was competing with the render loop for the JS thread. The zone's
 * own size (needed to clamp the ring so it never spawns half off-screen) is
 * measured once via onLayout and handed to the worklets as a shared value.
 */
export function Joystick({ onAngle }: JoystickProps) {
  const zoneSize = useSharedValue({ width: STICK_SIZE, height: STICK_SIZE });
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const opacity = useSharedValue(0);
  const lastSent = useSharedValue(999);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      zoneSize.value = { width, height };
    },
    [zoneSize]
  );

  const ringStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: baseX.value - HALF_STICK },
      { translateY: baseY.value - HALF_STICK },
    ],
  }));

  const knobStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: baseX.value - KNOB_SIZE / 2 + tx.value },
      { translateY: baseY.value - KNOB_SIZE / 2 + ty.value },
    ],
  }));

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          'worklet';
          // The ring spawns centred on the touch, clamped so it never spills
          // past the zone's own edge.
          const { width, height } = zoneSize.value;
          baseX.value = clamp(e.x, HALF_STICK, width - HALF_STICK);
          baseY.value = clamp(e.y, HALF_STICK, height - HALF_STICK);
          tx.value = 0;
          ty.value = 0;
          opacity.value = 1;
        })
        .onUpdate((e) => {
          'worklet';
          moveKnob(e.x - baseX.value, e.y - baseY.value, tx, ty, lastSent, onAngle);
        })
        .onFinalize(() => {
          'worklet';
          // Heading is intentionally left where it was: releasing the stick
          // means "keep going", not "stop". The ring itself fades out —
          // the next touch anywhere in the zone respawns it there.
          opacity.value = withTiming(0, { duration: 150 });
          tx.value = 0;
          ty.value = 0;
        }),
    [zoneSize, baseX, baseY, tx, ty, opacity, lastSent, onAngle]
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.zone} onLayout={onLayout}>
        <Animated.View pointerEvents="none" style={[styles.stickRingFloating, ringStyle]} />
        <Animated.View pointerEvents="none" style={[styles.knob, knobStyle]} />
      </View>
    </GestureDetector>
  );
}

/** Keeps the spawned ring's centre inside [min, max] on one axis. */
function clamp(v: number, min: number, max: number) {
  'worklet';
  if (max < min) return (min + max) / 2; // zone smaller than the ring itself
  return Math.min(Math.max(v, min), max);
}

/** Runs on the UI thread. Only crosses to JS when the heading really moved. */
function moveKnob(
  dx: number,
  dy: number,
  tx: { value: number },
  ty: { value: number },
  lastSent: { value: number },
  onAngle: (a: number) => void
) {
  'worklet';
  const dist = Math.hypot(dx, dy);
  const k = dist > MAX_OFFSET ? MAX_OFFSET / dist : 1;
  tx.value = dx * k;
  ty.value = dy * k;

  if (dist <= 6) return; // a tiny nudge shouldn't whip the snake around
  const angle = Math.atan2(dy, dx);
  let delta = angle - lastSent.value;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) < ANGLE_EPSILON) return;
  lastSent.value = angle;
  runOnJS(onAngle)(angle);
}

type BoostProps = {
  onChange: (boosting: boolean) => void;
  disabled?: boolean;
};

/** Hexagonal hold-to-boost pad, bottom-right, matching snake.io's layout. */
export function BoostButton({ onChange, disabled }: BoostProps) {
  const [held, setHeld] = useState(false);

  const press = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(0)
        .maxDistance(9999)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          if (disabled) return;
          setHeld(true);
          onChange(true);
        })
        .onFinalize(() => {
          setHeld(false);
          onChange(false);
        })
        .runOnJS(true),
    [onChange, disabled]
  );

  return (
    <GestureDetector gesture={press}>
      <View style={[styles.boostWrap, disabled && styles.boostDisabled]}>
        <View style={[styles.boostHex, held && styles.boostHexActive]}>
          <Text style={styles.boostArrow}>▲</Text>
          <View style={styles.boostDots}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.boostDot} />
            ))}
          </View>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // The touch zone itself: sized by the parent (see GameScreen), invisible,
  // and generous — the ring can spawn anywhere inside it.
  zone: { flex: 1 },
  stickRingFloating: {
    position: 'absolute',
    width: STICK_SIZE,
    height: STICK_SIZE,
    borderRadius: STICK_SIZE / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  knob: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0B3A4A',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 5,
    elevation: 4,
  },
  boostWrap: {
    width: BOOST_W + BOOST_SLOP * 2,
    height: BOOST_H + BOOST_SLOP * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boostDisabled: { opacity: 0.35 },
  boostHex: {
    width: BOOST_W,
    height: BOOST_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.72)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    // A rounded hex reads the same at this size and avoids a clip path.
    borderRadius: 19,
  },
  boostHexActive: {
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderColor: '#FFFFFF',
  },
  boostArrow: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '900',
    marginBottom: 1,
  },
  boostDots: { alignItems: 'center' },
  boostDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.85)',
    marginTop: 3,
  },
});
