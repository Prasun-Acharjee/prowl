import React, { useEffect, useState } from 'react';
import {
  Pressable, PressableProps, StyleProp, ViewStyle, TextStyle, View, StyleSheet, Text,
  GestureResponderEvent,
} from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, LinearTransition, cancelAnimation, interpolate,
  interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay,
  withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '../context/ThemeContext';
import { type as t } from '../constants/typography';

// ─── Shared motion vocabulary ─────────────────────────────────────────────────
//
// One set of springs for the whole app, so a sheet, a button and a chip all
// "feel" like the same material. Everything here runs on the UI thread via
// Reanimated; the JS thread is free to fetch and render while things move.
//
// Reduced motion: Reanimated's springs/timings and layout animations default to
// ReduceMotion.System, so they jump straight to their end state when the OS
// setting is on. Infinite loops (shimmer) check useReducedMotion() themselves.

export const springs = {
  // Button squash — quick in, never wobbly.
  press: { damping: 15, stiffness: 340, mass: 0.6 },
  // Button release / stamps — a small, friendly overshoot.
  pop:   { damping: 11, stiffness: 260, mass: 0.7 },
  // Bottom sheets — soft settle with a hint of overshoot.
  sheet: { damping: 20, stiffness: 190, mass: 0.9 },
} as const;

/** Rows/cards rising into place one after another. Caps the delay so a long list
 *  never makes the last row wait. */
export function staggerIn(index: number, baseDelay = 0) {
  return FadeInDown.delay(baseDelay + Math.min(index, 8) * 45)
    .springify().damping(18).stiffness(180);
}

/** Siblings sliding to fill a gap when a row is added or filtered out. */
export const reflow = LinearTransition.springify().damping(20).stiffness(180);

export const fadeIn = FadeIn.duration(220);

/** A freshly taken photo settling into its frame: fades up from a slight zoom. */
export function photoSettle() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 1.08 }] },
    animations: {
      opacity:   withTiming(1, { duration: 260 }),
      transform: [{ scale: withSpring(1, springs.sheet) }],
    },
  };
}

/**
 * Camera-shutter flash: a white sheet that blinks on and fades out once, on
 * mount. Key it on the photo so each new capture flashes.
 */
export function ShutterFlash() {
  const o = useSharedValue(0.9);
  useEffect(() => { o.value = withTiming(0, { duration: 380, easing: Easing.out(Easing.quad) }); }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }, anim]} />;
}

// ─── Haptics ──────────────────────────────────────────────────────────────────

// Fire-and-forget: a device without a haptic engine must never turn a tap into
// an error.
export function hapticTap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
export function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

// ─── PressableScale ───────────────────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?:   StyleProp<ViewStyle>;
  /** How far the element squashes while held. */
  scaleTo?: number;
  /** Light haptic tick on press — reserve for primary actions. */
  haptic?:  boolean;
};

/**
 * Drop-in for TouchableOpacity on anything that reads as a button: squashes
 * slightly while held and springs back on release.
 */
export function PressableScale({
  style, scaleTo = 0.96, haptic, onPress, onPressIn, onPressOut, children, ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const anim  = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        scale.value = withSpring(scaleTo, springs.press);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        scale.value = withSpring(1, springs.pop);
        onPressOut?.(e);
      }}
      onPress={(e: GestureResponderEvent) => {
        if (haptic) hapticTap();
        onPress?.(e);
      }}
      style={[style, anim] as any}
    >
      {children}
    </AnimatedPressable>
  );
}

// ─── ToggleChip ───────────────────────────────────────────────────────────────

type ToggleChipProps = {
  on:        boolean;
  label:     string;
  onPress:   () => void;
  /** Colour of the label and border when on. Defaults to the accent. */
  tint?:     string;
  tintFaint?: string;
  tintBorder?: string;
  leading?:  React.ReactNode;
  /** Outer (pressable) box — put flex / margins here. */
  style?:    StyleProp<ViewStyle>;
  /** The chip's own box — padding, radius. */
  chipStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

/**
 * A filter/choice chip whose colours cross-fade between off and on instead of
 * snapping, with a small pop on press.
 */
export function ToggleChip({
  on, label, onPress, tint, tintFaint, tintBorder, leading, style, chipStyle, textStyle,
}: ToggleChipProps) {
  const colors = useColors();
  const onFg     = tint       ?? colors.accent;
  const onBg     = tintFaint  ?? colors.accentFaint;
  const onBorder = tintBorder ?? colors.accentBorder;

  const progress = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(on ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [on, progress]);

  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.elevated, onBg]),
    borderColor:     interpolateColor(progress.value, [0, 1], [colors.border, onBorder]),
  }), [colors, onBg, onBorder]);
  const text = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.textSecondary, onFg]),
  }), [colors, onFg]);

  return (
    <PressableScale onPress={onPress} scaleTo={0.93} style={style}>
      <Animated.View style={[chipStyles.chip, chipStyle, box]}>
        {leading}
        <Animated.Text style={[t.caption, textStyle, text]}>{label}</Animated.Text>
      </Animated.View>
    </PressableScale>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
});

// ─── Skeleton ─────────────────────────────────────────────────────────────────

type SkeletonProps = {
  width?:  number | `${number}%`;
  height:  number;
  radius?: number;
  style?:  StyleProp<ViewStyle>;
};

/** Placeholder block with a highlight sweeping across it while content loads. */
export function Skeleton({ width = '100%', height, radius = 8, style }: SkeletonProps) {
  const colors = useColors();
  const reduce = useReducedMotion();
  const sweep  = useSharedValue(0);
  const [w, setW] = useState(0);

  useEffect(() => {
    if (reduce) return;
    sweep.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.ease) }), -1, false);
    return () => cancelAnimation(sweep);
  }, [reduce, sweep]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(sweep.value, [0, 1], [-w, w]) }],
  }), [w]);

  return (
    <View
      onLayout={e => setW(e.nativeEvent.layout.width)}
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.border, overflow: 'hidden', opacity: 0.7 }, style]}
    >
      {!reduce && w > 0 && (
        <Animated.View style={[StyleSheet.absoluteFill, anim]}>
          <LinearGradient
            colors={['transparent', colors.shimmer, 'transparent']}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/** A list row's worth of skeleton: avatar plus two lines. */
export function SkeletonRow({ avatar = 44, style }: { avatar?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, style]}>
      <Skeleton width={avatar} height={avatar} radius={avatar / 2} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="55%" height={12} />
        <Skeleton width="80%" height={10} />
      </View>
    </View>
  );
}

// ─── Success stamp ────────────────────────────────────────────────────────────

/** A check mark that stamps in with a spring — "that worked". */
export function SuccessStamp({ size = 20, color, checkColor }: {
  size?: number; color?: string; checkColor?: string;
}) {
  const colors = useColors();
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withSequence(withTiming(0, { duration: 0 }), withSpring(1, springs.pop));
  }, [s]);
  const anim = useAnimatedStyle(() => ({
    opacity:   Math.min(1, s.value * 2),
    transform: [{ scale: s.value }, { rotate: `${(1 - s.value) * -30}deg` }],
  }));
  const tickW = size * 0.26;
  const tickH = size * 0.48;
  const line  = Math.max(2, Math.round(size / 9));
  return (
    <Animated.View style={[{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color ?? colors.mint,
      alignItems: 'center', justifyContent: 'center',
    }, anim]}>
      <View style={{
        width: tickW, height: tickH, marginTop: -size * 0.08,
        borderRightWidth: line, borderBottomWidth: line,
        borderColor: checkColor ?? colors.onAccent,
        transform: [{ rotate: '45deg' }],
      }} />
    </Animated.View>
  );
}

/**
 * Full-screen confirmation shown for a beat after a sighting saves, before the
 * screen moves on. Purely presentational — callers decide when to navigate.
 */
export function SuccessOverlay({ label }: { label: string }) {
  const colors = useColors();
  const lift = useSharedValue(0);
  useEffect(() => { lift.value = withDelay(120, withSpring(1, springs.sheet)); }, [lift]);
  const labelStyle = useAnimatedStyle(() => ({
    opacity:   lift.value,
    transform: [{ translateY: (1 - lift.value) * 10 }],
  }));
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, {
        backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }]}
    >
      <View style={{
        alignItems: 'center', gap: 14, paddingHorizontal: 28, paddingVertical: 24,
        borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      }}>
        <SuccessStamp size={64} />
        <Animated.View style={labelStyle}>
          <Text style={[t.bodyMed, { color: colors.textPrimary }]}>{label}</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** How long SuccessOverlay stays up before the caller should navigate on. */
export const SUCCESS_HOLD_MS = 750;
