import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, Text, Image, Platform } from 'react-native';
import { useColors } from '../context/ThemeContext';
import { ColorTheme } from '../constants/colors';
import { fonts } from '../constants/typography';
import { Pet } from '../types';

// Read the clock per call — a module-level constant freezes at import time and
// leaves pin colours stale for the whole session.
function pinColor(lastSeenAt: string, c: ColorTheme): string {
  const hours = (Date.now() - new Date(lastSeenAt).getTime()) / 3_600_000;
  if (hours < 24)  return c.amber;
  if (hours < 168) return c.rose;
  return c.textMuted;
}

function isRecent(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < 86_400_000;
}

// Android clips a marker's children to the view bounds when it rasterizes the
// view into a bitmap; iOS does not. The adoptable badge overhangs the circle, so
// the wrapper is padded to bring it back inside the bounds that get captured.
const OVERHANG = 8;

interface PetPinProps {
  pet:          Pet;
  size?:        number;
  onImageLoad?: () => void;
  showBorder?:  boolean;
}

export function PetPin({ pet, size = 44, onImageLoad, showBorder = false }: PetPinProps) {
  const colors   = useColors();
  const color    = pinColor(pet.lastSeenAt, colors);
  const recent   = isRecent(pet.lastSeenAt);
  const photoSrc  = pet.thumbnailSmallUrl ?? pet.thumbnailUrl;
  const adoptable = pet.status === 'adoptable';

  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [pet.id]);

  const showInitial = !photoSrc || imgError;

  const tipW      = Math.round(size * 0.2);
  const tipH      = Math.round(size * 0.28);
  const fontSize  = Math.round(size * 0.38);
  const radius    = size / 2;
  const badgeSize = Math.max(14, Math.round(size * 0.36));

  const ring = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!recent || Platform.OS === 'android') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 2.6, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(ring, { toValue: 1, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const ringOpacity = ring.interpolate({ inputRange: [1, 2.6], outputRange: [0.55, 0] });

  return (
    <View
      collapsable={false}
      style={{
        alignItems: 'center',
        // border-box sizing: content width stays exactly `size`.
        width: size + OVERHANG * 2,
        paddingHorizontal: OVERHANG,
        paddingTop: OVERHANG,
        // No bottom padding — the marker's y:1 anchor must land on the tip.
      }}
    >
      {recent && Platform.OS !== 'android' && (
        <Animated.View style={{
          position: 'absolute', top: 0,
          width: size, height: size, borderRadius: radius,
          backgroundColor: color,
          transform: [{ scale: ring }],
          opacity: ringOpacity,
        }} />
      )}

      <View
        collapsable={false}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: color,
          overflow: 'hidden',
          borderWidth: showBorder ? 2 : 0,
          borderColor: 'rgba(255,255,255,0.85)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {showInitial ? (
          <Text style={{ fontFamily: fonts.bodyBold, fontSize, color: colors.onAmber }}>
            {pet.initial}
          </Text>
        ) : (
          <Image
            source={{ uri: photoSrc! }}
            style={{ width: size, height: size, borderRadius: radius }}
            resizeMode="cover"
            onLoad={onImageLoad}
            onError={() => { setImgError(true); onImageLoad?.(); }}
          />
        )}
      </View>

      {/* Sibling of the circle — inside it, overflow:'hidden' would clip the badge.
          The -3 overhang is absorbed by the wrapper's OVERHANG padding so Android
          still captures it in the marker bitmap. */}
      {adoptable && (
        <View style={{
          position: 'absolute', top: -3, right: -3,
          width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2,
          backgroundColor: colors.rose,
          borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: badgeSize * 0.55, color: '#FFFFFF', lineHeight: badgeSize * 0.7 }}>♥</Text>
        </View>
      )}

      <View style={{
        width: 0, height: 0,
        borderLeftWidth: tipW, borderRightWidth: tipW, borderTopWidth: tipH,
        borderLeftColor: 'transparent', borderRightColor: 'transparent',
        borderTopColor: color,
        marginTop: -1,
      }} />
    </View>
  );
}
