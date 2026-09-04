import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

/**
 * The stick is thumb-sized, not hand-sized: it sits in the bottom-left corner
 * of a landscape phone, where anything wider starts eating the arena the
 * player is trying to steer through. The knob keeps its share of the ring so
 * the throw still reads the same.
 */
const STICK_SIZE = 104;
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
 * Snake.io-style joystick: translucent white ring with a solid knob, parked
 * bottom-left. Reports an absolute heading rather than a delta, which is what
 * the server wants — it decides how fast the snake may turn toward it.
 *
 * The knob is driven by Reanimated shared values so dragging never re-renders
 * React. Touch events arrive at up to 120Hz; calling setState on each one was
 * competing with the render loop for the JS thread.
 */
export function Joystick({ onAngle }: JoystickProps) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lastSent = useSharedValue(999);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          'worklet';
          moveKnob(e.x, e.y, tx, ty, lastSent, onAngle);
        })
        .onUpdate((e) => {
          'worklet';
          moveKnob(e.x, e.y, tx, ty, lastSent, onAngle);
        })
        .onFinalize(() => {
          'worklet';
          // Heading is intentionally left where it was: releasing the stick
          // means "keep going", not "stop".
          tx.value = 0;
          ty.value = 0;
        }),
    [tx, ty, lastSent, onAngle]
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.stickBase}>
        <View style={styles.stickRing} />
        <Animated.View style={[styles.knob, knobStyle]} />
      </View>
    </GestureDetector>
  );
}

/** Runs on the UI thread. Only crosses to JS when the heading really moved. */
function moveKnob(
  px: number,
  py: number,
  tx: { value: number },
  ty: { value: number },
  lastSent: { value: number },
  onAngle: (a: number) => void
) {
  'worklet';
  const dx = px - STICK_SIZE / 2;
  const dy = py - STICK_SIZE / 2;
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
  stickBase: {
    width: STICK_SIZE,
    height: STICK_SIZE,
    borderRadius: STICK_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  stickRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: STICK_SIZE / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  knob: {
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
