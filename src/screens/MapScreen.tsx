import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Platform, ActivityIndicator, ScrollView, TextInput, Alert, RefreshControl,
  Image as RNImage,
} from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, LayoutAnimationConfig, cancelAnimation, interpolate,
  runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Supercluster from 'supercluster';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useTheme, useColors } from '../context/ThemeContext';
import { type as t } from '../constants/typography';
import { DARK_MAP_STYLE, LIGHT_MAP_STYLE } from '../constants/mapStyle';
import { PetPin } from '../components/PetPin';
import {
  PressableScale, ToggleChip, SkeletonRow, SuccessStamp,
  springs, staggerIn, reflow, hapticSuccess,
} from '../components/motion';
import { Pet, Species } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';
import { usePetsInViewport, usePetSearch } from '../hooks/usePets';
import { applyFilters, toggleSpecies, PetFilters, NO_FILTERS } from '../lib/petFilters';
import { freshnessLabel } from '../lib/freshness';
import { Coords, distanceMeters, formatDistance, sortByDistance } from '../lib/geo';
import { logSightingHere } from '../lib/sightings';
import { getUserId } from '../lib/supabase';

type Nav = StackNavigationProp<RootStackParamList, 'Map'>;

// ─── Zoom / clustering helpers ────────────────────────────────────────────────

type PinTier = 'sm' | 'md' | 'lg';
const PIN_SIZES: Record<PinTier, number> = { sm: 26, md: 42, lg: 66 };

function latDeltaToZoom(latDelta: number): number {
  return Math.round(Math.log2(360 / Math.max(latDelta, 0.0001)));
}

function latDeltaToTier(latDelta: number): PinTier {
  if (latDelta < 0.02) return 'lg';
  if (latDelta < 0.09) return 'md';
  return 'sm';
}

function regionToBounds(r: Region): [number, number, number, number] {
  return [
    r.longitude - r.longitudeDelta / 2,
    r.latitude  - r.latitudeDelta  / 2,
    r.longitude + r.longitudeDelta / 2,
    r.latitude  + r.latitudeDelta  / 2,
  ];
}

// ─── Marker bitmap tracking ───────────────────────────────────────────────────

// react-native-maps rasterizes each marker's React view into a bitmap. While
// tracksViewChanges is true it re-rasterizes on every frame — fine for the moment
// or two before the content settles, ruinous if left on: with a screenful of pins
// it stutters and the markers visibly lag behind the map during a pan.
//
// So: track until the content is actually in, then stop. The image's onLoad is the
// signal, plus one compositing beat — Android's Maps SDK snapshots too early
// otherwise and you get blank pins. Anything that never resolves gives up on a
// timer rather than tracking forever.
const SETTLE_MS  = 120;
const GIVE_UP_MS = 3000;

function useMarkerSettle(photoKey: string | null, layoutKey: string | number) {
  const [ready, setReady] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Whether this marker's content has rendered at least once.
  const loaded = useRef(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const settle = useCallback(() => {
    clearTimers();
    timers.current.push(setTimeout(() => setReady(true), SETTLE_MS));
  }, [clearTimers]);

  // New photo (or none): wait for the image, with a give-up timer so a broken or
  // hanging load can't leave the marker tracking forever.
  useEffect(() => {
    setReady(false);
    clearTimers();
    if (photoKey) {
      loaded.current = false;
      timers.current.push(setTimeout(() => setReady(true), GIVE_UP_MS));
    } else {
      loaded.current = true;
      settle();
    }
    return clearTimers;
  }, [photoKey, settle, clearTimers]);

  // Same photo, new geometry (zoom tier, cluster count). The content is already
  // on screen, so this just needs a re-snapshot — waiting on an onLoad that will
  // never fire again would keep every pin tracking for the full give-up window.
  useEffect(() => {
    if (!loaded.current) return; // still on the initial-load path above
    setReady(false);
    settle();
  }, [layoutKey, settle]);

  // Handed to the image's onLoad/onError.
  const onContentReady = useCallback(() => {
    loaded.current = true;
    settle();
  }, [settle]);

  return { ready, settle: onContentReady };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const CLUSTER_RING  = 72;
const CLUSTER_PHOTO = 56;
const CLUSTER_BADGE = 26;

function ClusterPin({ count, photoUri, onImageSettled }: {
  count: number; photoUri: string | null; onImageSettled?: () => void;
}) {
  const colors = useColors();
  const photoRadius = CLUSTER_PHOTO / 2;
  return (
    <View
      collapsable={false}
      style={{
        width: CLUSTER_RING, height: CLUSTER_RING, borderRadius: CLUSTER_RING / 2,
        backgroundColor: colors.accentFaint, borderWidth: 1, borderColor: colors.accentBorder,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <View
        collapsable={false}
        style={{
          width: CLUSTER_PHOTO, height: CLUSTER_PHOTO, borderRadius: photoRadius,
          backgroundColor: colors.accent,
          overflow: 'hidden',
          borderWidth: 2, borderColor: colors.accent,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {photoUri ? (
          <RNImage
            source={{ uri: photoUri }}
            style={{ width: CLUSTER_PHOTO, height: CLUSTER_PHOTO, borderRadius: photoRadius }}
            resizeMode="cover"
            onLoad={onImageSettled}
            // Without onError a broken photo leaves the marker tracking forever.
            onError={onImageSettled}
          />
        ) : (
          <Text style={{ fontSize: 22 }}>🐱</Text>
        )}
      </View>

      {/* Count badge */}
      <View style={{
        position: 'absolute', top: 2, right: 2,
        backgroundColor: colors.accent,
        borderRadius: CLUSTER_BADGE / 2, minWidth: CLUSTER_BADGE, height: CLUSTER_BADGE,
        paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: colors.surface,
      }}>
        <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: colors.onAccent }}>
          {count}
        </Text>
      </View>
    </View>
  );
}

function ClusterMarker({ latitude, longitude, count, photoUri, onPress }: {
  latitude: number; longitude: number;
  count: number; photoUri: string | null;
  onPress: () => void;
}) {
  // count is the layout key: the same cluster id can absorb more pins as the
  // viewport shifts, which changes the badge and needs a fresh snapshot.
  const { ready, settle } = useMarkerSettle(photoUri, count);
  const handlePress = useCallback((e: any) => { e.stopPropagation(); onPress(); }, [onPress]);
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      onPress={handlePress}
      tracksViewChanges={!ready}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <ClusterPin count={count} photoUri={photoUri} onImageSettled={settle} />
    </Marker>
  );
}

function PetMarker({ pet, size, tier, onPress }: {
  pet: Pet; size: number; tier: PinTier; onPress: () => void;
}) {
  const photoSrc = pet.thumbnailSmallUrl ?? pet.thumbnailUrl;
  // size is the layout key: crossing a zoom tier resizes the pin, so the bitmap
  // has to be re-snapshotted. Cheaper than remounting the marker, which is what
  // key={id-tier} used to do to every pin on the map at once.
  const { ready, settle } = useMarkerSettle(photoSrc, size);
  const handlePress = useCallback((e: any) => { e.stopPropagation(); onPress(); }, [onPress]);
  return (
    <Marker
      coordinate={{ latitude: pet.latitude, longitude: pet.longitude }}
      onPress={handlePress}
      tracksViewChanges={!ready}
      anchor={{ x: 0.5, y: 1 }}
    >
      <PetPin pet={pet} size={size} showBorder={tier === 'lg'} onImageLoad={settle} />
    </Marker>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_REGION: Region = {
  latitude: 40.758, longitude: -73.9855,
  latitudeDelta: 0.018, longitudeDelta: 0.018,
};

// Mirrors the CHECK constraint on pets.species (migration 00009). A species the
// table cannot hold must not be offered as a filter.
const SPECIES_CHIPS: { value: Species; label: string }[] = [
  { value: 'cat', label: '🐱  Cats' },
  { value: 'dog', label: '🐶  Dogs' },
];

const LIST_PEEK = 80;
// Raised from 340 when the search field and filter chips were added: the header
// grew by ~90px, and at the old height the list itself was down to three rows.
// Peek is unchanged, so collapsed the sheet still shows just the summary row.
const LIST_FULL = 430;
// How far the pin sheet travels to get off screen. Must exceed the sheet's real
// height or a sliver stays visible when it is "closed"; raised from 210 when the
// freshness line was added.
const PIN_SHEET = 240;

function timeAgo(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return 'Just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : `${d}d ago`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function MapScreen() {
  const nav    = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const insetsRef = useRef(insets);
  useEffect(() => { insetsRef.current = insets; }, [insets]);

  const { colors, isDark } = useTheme();

  const qc = useQueryClient();

  const [selected, setSelected]   = useState<Pet | null>(null);
  const selectedRef = useRef<Pet | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const [userCoords, setUserCoords] = useState<Coords | null>(null);
  const [listOpen, setListOpen]   = useState(false);
  const [region, setRegion]       = useState<Region>(FALLBACK_REGION);
  const [queryBounds, setQueryBounds] = useState<[number, number, number, number] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Both sheets are driven on the UI thread. pinProgress runs 0 (hidden) → 1
  // (shown); listY is the list sheet's translateY, 0 fully open → peek.
  const pinProgress = useSharedValue(0);
  const listY       = useSharedValue(LIST_FULL - LIST_PEEK);
  // The peek offset, mirrored into a shared value so the drag worklet can read it.
  const peekSV      = useSharedValue(LIST_FULL - LIST_PEEK);
  const dragStartY  = useSharedValue(0);
  const mapRef      = useRef<MapView>(null);

  const [filters, setFilters]     = useState<PetFilters>(NO_FILTERS);
  const [search, setSearch]       = useState('');
  const [sortNearest, setSortNearest] = useState(false);

  // One-tap sighting from the pin sheet.
  const [logging, setLogging]   = useState(false);
  const [loggedId, setLoggedId] = useState<string | null>(null);
  const loggedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(loggedTimer.current), []);

  const { pets: viewportPets, loading, refetch, refreshing } = usePetsInViewport(queryBounds);
  const { data: searchHits = [], isFetching: searching } = usePetSearch(search);
  const searchMode = search.trim().length >= 2;

  // Chips narrow both the pins and the list, so the map always reflects what
  // the list is showing.
  const pets = useMemo(
    () => applyFilters(viewportPets, filters, getUserId()),
    [viewportPets, filters],
  );
  // Nearest-first is opt-in and needs a fix to sort against; without one the
  // chip is not offered at all, so it can never be on with nothing to do.
  const listPets = useMemo(() => {
    const base = searchMode ? applyFilters(searchHits, filters, getUserId()) : pets;
    return sortNearest ? sortByDistance(base, userCoords) : base;
  }, [searchMode, searchHits, filters, pets, sortNearest, userCoords]);

  const selectedStaleLabel = selected ? freshnessLabel(selected.lastSeenAt) : null;

  // Distance is a label, not a stored field: it changes as the user walks.
  const distanceTo = useCallback(
    (pet: Pet) => (userCoords ? formatDistance(distanceMeters(userCoords, pet)) : ''),
    [userCoords],
  );

  function toggleFilter(key: keyof PetFilters) {
    setFilters(f => ({ ...f, [key]: !f[key] }));
  }

  // A search hit is usually off-screen, so selecting one has to move the map.
  function goToPet(pet: Pet) {
    setSearch('');
    mapRef.current?.animateToRegion({
      latitude: pet.latitude, longitude: pet.longitude,
      latitudeDelta: 0.01, longitudeDelta: 0.01,
    }, 600);
    openPinSheet(pet);
  }

  // ── Clustering ──────────────────────────────────────────────────────────────

  type PetProps = { pet: Pet };

  const supercluster = useMemo(() => {
    const sc = new Supercluster<PetProps>({ radius: 70, maxZoom: 22, minZoom: 1 });
    sc.load(pets.map(pet => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [pet.longitude, pet.latitude] },
      properties: { pet },
    })));
    return sc;
  }, [pets]);

  const tier    = latDeltaToTier(region.latitudeDelta);
  const pinSize = PIN_SIZES[tier];

  const clusters = useMemo(() => {
    const zoom   = latDeltaToZoom(region.latitudeDelta);
    const bounds = regionToBounds(region);
    return supercluster.getClusters(bounds, zoom);
  }, [supercluster, region]);

  function expandCluster(clusterId: number, lat: number, lng: number) {
    const expansionZoom = Math.min(supercluster.getClusterExpansionZoom(clusterId), 18);
    const delta = 360 / Math.pow(2, expansionZoom) * 0.7;
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta }, 500);
  }

  // ── Location ────────────────────────────────────────────────────────────────

  // Reads the device position. Split from the map move below because the two are
  // needed separately: the recentre button has to be able to re-ask for a fix,
  // since the first attempt may have been denied, and even when it wasn't the
  // user has since walked somewhere.
  const locate = useCallback(async (): Promise<Coords | null> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      // Fall back to a region rather than leaving the map with no bounds, but
      // don't overwrite bounds the user has already panned to.
      setQueryBounds(b => b ?? regionToBounds(FALLBACK_REGION));
      return null;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const coords: Coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
    setUserCoords(coords);
    return coords;
  }, []);

  const recenter = useCallback((coords: Coords) => {
    const r: Region = { ...coords, latitudeDelta: 0.018, longitudeDelta: 0.018 };
    setRegion(r);
    setQueryBounds(regionToBounds(r));
    mapRef.current?.animateToRegion(r, 800);
  }, []);

  useEffect(() => {
    // A rejected fix leaves the fallback bounds in place; there is no useful
    // thing to say about it before the user has asked for anything.
    locate().then(c => { if (c) recenter(c); }).catch(() => {});
    return () => clearTimeout(debounceRef.current);
  }, [locate, recenter]);

  const [locating, setLocating] = useState(false);
  async function handleRecenter() {
    setLocating(true);
    try {
      const coords = await locate();
      if (coords) recenter(coords);
      else Alert.alert('Location off', 'Prowl needs location permission to find cats around you.');
    } catch {
      Alert.alert('Location unavailable', "Couldn't get a fix on where you are. Try again in a moment.");
    } finally {
      setLocating(false);
    }
  }

  useEffect(() => {
    const peekY = Math.max(LIST_FULL - LIST_PEEK - insets.bottom, 0);
    peekSV.value = peekY;
    if (!listOpen) listY.value = peekY;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets.bottom]);

  // ── Sheet animation ─────────────────────────────────────────────────────────

  function peekY() {
    return Math.max(LIST_FULL - LIST_PEEK - insetsRef.current.bottom, 0);
  }

  function snapToOpen() {
    setListOpen(true);
    listY.value = withSpring(0, springs.sheet);
  }

  function snapToPeek() {
    setListOpen(false);
    listY.value = withSpring(peekY(), springs.sheet);
  }

  function toggleList() { if (listOpen) snapToPeek(); else snapToOpen(); }

  function openPinSheet(pet: Pet) {
    setListOpen(false);
    cancelAnimation(listY);
    listY.value = withSpring(peekY(), springs.sheet);
    setSelected(pet);
    pinProgress.value = withSpring(1, springs.sheet);
  }

  // Closing is a quick ease-out rather than a spring: a spring's long settling
  // tail would hold the list sheet off screen (it only mounts once `selected`
  // clears) for a beat after the card has visibly gone.
  function closePinSheet() {
    pinProgress.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) }, finished => {
      // Only if nothing re-opened the sheet mid-close.
      if (finished) runOnJS(setSelected)(null);
    });
  }

  /**
   * The sheet's primary action. This used to only close the sheet, which read
   * as a button that did nothing — the sighting it promises is now actually
   * written, at the device's position, without leaving the map.
   */
  async function handleISeeThisPet() {
    if (!selected) return;
    const petId = selected.id;
    setLogging(true);
    try {
      await logSightingHere(petId);
      await qc.invalidateQueries({ queryKey: ['pets'] });
      // Confirm on the button itself, then get out of the way. An Alert for a
      // one-tap action would cost a second tap to dismiss.
      setLoggedId(petId);
      hapticSuccess();
      loggedTimer.current = setTimeout(() => {
        setLoggedId(null);
        // Only dismiss if this is still the cat on screen — the user may have
        // closed the sheet and opened another one inside the delay. Read through
        // a ref rather than a state updater, which must stay side-effect free.
        if (selectedRef.current?.id === petId) closePinSheet();
      }, 1100);
    } catch (err: any) {
      Alert.alert('Could not log sighting', err.message);
    } finally {
      setLogging(false);
    }
  }

  function handleMapPress() {
    if (selected) closePinSheet();
    else if (listOpen) snapToPeek();
  }

  // ── Pan gesture ─────────────────────────────────────────────────────────────

  // Vertical drags on the list header move the sheet; horizontal ones fail the
  // pan so the filter-chip row can still scroll sideways. Same snap rule as the
  // PanResponder this replaced: a downward flick, or a slow drag past 35% of the
  // travel, settles at peek — anything else opens.
  const listPan = useMemo(() => Gesture.Pan()
    .activeOffsetY([-6, 6])
    .failOffsetX([-12, 12])
    .onStart(() => {
      cancelAnimation(listY);
      dragStartY.value = listY.value;
    })
    .onUpdate(e => {
      const py   = peekSV.value;
      const next = dragStartY.value + e.translationY;
      // Rubber-band past either end instead of stopping dead.
      listY.value = next < 0 ? next * 0.25 : next > py ? py + (next - py) * 0.25 : next;
    })
    .onEnd((e, success) => {
      const py = peekSV.value;
      const vy = e.velocityY / 1000; // px/ms, matching the old thresholds
      const snapDown = !success || vy > 0.3 || (vy >= -0.1 && e.translationY > py * 0.35);
      listY.value = withSpring(snapDown ? py : 0, { ...springs.sheet, velocity: e.velocityY });
      runOnJS(setListOpen)(!snapDown);
    }),
  // Shared values and the state setter are stable for the component's life.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const listSheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: listY.value }] }));
  const pinSheetStyle  = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(pinProgress.value, [0, 1], [PIN_SHEET + 60, 0]) }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, pinProgress.value)),
  }));

  // ── Themed styles ───────────────────────────────────────────────────────────

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },

    topBar:      { position: 'absolute', left: 0, right: 0, zIndex: 10, paddingHorizontal: 16 },
    topBarInner: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingLeft: 12, paddingRight: 10, paddingVertical: 8,
      backgroundColor: colors.glass,
      borderRadius: 20, borderWidth: 1, borderColor: colors.border,
      shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
      shadowOpacity: isDark ? 0.35 : 0.08, shadowRadius: 16, elevation: 6,
    },
    brand:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
    logo:     { width: 28, height: 28 },
    wordmark: { color: colors.textPrimary, fontSize: 24, lineHeight: 28 },
    badge: {
      paddingHorizontal: 12, paddingVertical: 6,
      backgroundColor: colors.accentFaint, borderRadius: 20,
      borderWidth: 1, borderColor: colors.accentBorder,
      minWidth: 76, alignItems: 'center' as const,
    },

    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim, zIndex: 19 },
    pinSheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
      backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
      borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 20, paddingTop: 12,
      shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
      shadowOpacity: isDark ? 0.4 : 0.1, shadowRadius: 20, elevation: 16,
    },
    handle: { width: 40, height: 5, backgroundColor: colors.border, borderRadius: 3, alignSelf: 'center' as const },
    sheetRow:   { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
    sheetThumb: { width: 60, height: 60, borderRadius: 18 },
    sheetAvatar:   { width: 60, height: 60, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const },
    avatarInitial: { fontFamily: 'Inter_700Bold', fontSize: 22, color: colors.onAccent },
    adoptTag: {
      backgroundColor: colors.violetFaint, paddingHorizontal: 8,
      paddingVertical: 3, borderRadius: 10,
    },
    actions:   { flexDirection: 'row', gap: 10 },
    btnOutline: {
      flex: 1, paddingVertical: 15, borderRadius: 16, backgroundColor: colors.elevated,
      borderWidth: 1, borderColor: colors.border, alignItems: 'center' as const,
    },
    btnAccent: {
      flex: 1, paddingVertical: 15, borderRadius: 16, backgroundColor: colors.accent,
      alignItems: 'center' as const, justifyContent: 'center' as const,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
    },
    loggedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

    listSheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 15,
      backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
      borderTopWidth: 1, borderTopColor: colors.border, overflow: 'hidden' as const,
    },
    listHeader:    { paddingHorizontal: 20, paddingBottom: 10 },
    handleArea:    { alignItems: 'center' as const, paddingVertical: 10 },
    listHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10,
    },
    searchInput: {
      flex: 1, height: 40, borderRadius: 12,
      backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14,
      color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14,
    },
    chipRow:        { marginTop: 10, flexGrow: 0 },
    chipRowContent: { flexDirection: 'row', gap: 8, paddingRight: 20 },
    logBtn: {
      backgroundColor: colors.accent, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
    },
    logBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: colors.onAccent },
    catRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 20, paddingVertical: 13,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    catThumb:    { width: 46, height: 46, borderRadius: 14, overflow: 'hidden' as const },
    catInitial:  { fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.onAccent },
    emptyState:  { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
    skeletons:   { paddingHorizontal: 20, paddingTop: 14, gap: 18 },
    staleBadge: {
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
      backgroundColor: colors.violetFaint,
    },
    recenterBtn: {
      position: 'absolute' as const, right: 16, zIndex: 12,
      width: 46, height: 46, borderRadius: 23,
      alignItems: 'center' as const, justifyContent: 'center' as const,
      backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.border,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.35 : 0.12, shadowRadius: 10, elevation: 5,
    },
  }), [colors, isDark]);

  const countLabel = queryBounds ? `${pets.length} in view` : 'locating…';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        customMapStyle={Platform.OS === 'android' ? (isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE) : undefined}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        initialRegion={FALLBACK_REGION}
        onPress={handleMapPress}
        onRegionChangeComplete={r => {
          setRegion(r);
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => setQueryBounds(regionToBounds(r)), 500);
        }}
        showsUserLocation
        showsCompass={false}
        showsPointsOfInterest={false}
        showsBuildings={false}
      >
        {clusters.map(cluster => {
          const [lng, lat] = cluster.geometry.coordinates;
          const props = cluster.properties as any;

          if (props.cluster) {
            const leaves  = supercluster.getLeaves(props.cluster_id, 1);
            const leaf    = leaves[0]?.properties.pet;
            const photoUri = leaf?.thumbnailSmallUrl ?? leaf?.thumbnailUrl ?? null;
            return (
              <ClusterMarker
                key={`cluster-${props.cluster_id}`}
                latitude={lat} longitude={lng}
                count={props.point_count}
                photoUri={photoUri}
                onPress={() => expandCluster(props.cluster_id, lat, lng)}
              />
            );
          }

          const pet: Pet = props.pet;
          return (
            <PetMarker
              key={pet.id}
              pet={pet} size={pinSize} tier={tier}
              onPress={() => openPinSheet(pet)}
            />
          );
        })}
      </MapView>

      {/* Top bar */}
      <Animated.View
        entering={FadeInDown.delay(80).springify().damping(18)}
        style={[styles.topBar, { top: insets.top + 12 }]}
        pointerEvents="box-none"
      >
        <View style={styles.topBarInner}>
          <View style={styles.brand}>
            <RNImage source={require('../../assets/logo-mark.png')} style={styles.logo} />
            <Text style={[t.h2, styles.wordmark]}>Prowl</Text>
          </View>
          <View style={styles.badge}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              // Keyed on the text so each new count fades in rather than snapping.
              <Animated.Text
                key={countLabel}
                entering={FadeIn.duration(220)}
                style={[t.caption, { color: colors.accent, fontFamily: 'Inter_700Bold' }]}
              >
                {countLabel}
              </Animated.Text>
            )}
          </View>
        </View>
      </Animated.View>

      {/* Recentre. Sits above the peeking list sheet so it clears the summary row,
          and behind it (lower zIndex) so an open sheet simply covers it. */}
      {!selected && (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={[styles.recenterBtn, { bottom: insets.bottom + LIST_PEEK + 16 }]}
        >
          <PressableScale
            onPress={handleRecenter}
            disabled={locating}
            scaleTo={0.88}
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            {locating
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Text style={{ fontSize: 20, color: colors.accent }}>⌖</Text>}
          </PressableScale>
        </Animated.View>
      )}

      {/* Per-pin quick-action card */}
      {selected && (
        <>
          <Animated.View style={[styles.scrim, scrimStyle]}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closePinSheet} />
          </Animated.View>
          <Animated.View
            style={[styles.pinSheet, { paddingBottom: insets.bottom + 16 }, pinSheetStyle]}
          >
            <View style={[styles.handle, { marginBottom: 16 }]} />
            <View style={styles.sheetRow}>
              {(selected.thumbnailSmallUrl ?? selected.thumbnailUrl) ? (
                <Image
                  source={{ uri: selected.thumbnailSmallUrl ?? selected.thumbnailUrl! }}
                  style={styles.sheetThumb}
                  contentFit="cover" cachePolicy="memory-disk" transition={200}
                />
              ) : (
                <View style={[styles.sheetAvatar, { backgroundColor: selected.color }]}>
                  <Text style={styles.avatarInitial}>{selected.initial}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[t.h2, { color: colors.textPrimary, flexShrink: 1 }]} numberOfLines={1}>{selected.name}</Text>
                  {selected.status === 'adoptable' && (
                    <View style={styles.adoptTag}>
                      <Text style={[t.label, { color: colors.violet }]}>adoptable</Text>
                    </View>
                  )}
                </View>
                <Text style={[t.caption, { color: colors.textSecondary, marginTop: 3 }]}>
                  {selected.sightingCount} sightings · last seen {timeAgo(selected.lastSeenAt)}
                  {!!distanceTo(selected) && ` · ${distanceTo(selected)} away`}
                </Text>
                {!!selectedStaleLabel && (
                  <Text style={[t.caption, { color: colors.violet, marginTop: 3 }]}>
                    {selectedStaleLabel} — a sighting would help
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.actions}>
              <PressableScale
                style={styles.btnOutline}
                onPress={() => { closePinSheet(); nav.navigate('PetDetail', { petId: selected.id }); }}
              >
                <Text style={[t.bodyMed, { color: colors.textPrimary }]}>View profile</Text>
              </PressableScale>
              <PressableScale
                style={[styles.btnAccent, logging && { opacity: 0.75 }]}
                onPress={handleISeeThisPet}
                disabled={logging || !!loggedId}
                haptic
              >
                {logging
                  ? <ActivityIndicator size="small" color={colors.onAccent} />
                  : loggedId === selected.id
                    ? (
                      <View style={styles.loggedRow}>
                        <SuccessStamp size={20} color={colors.onAccent} checkColor={colors.accent} />
                        <Text style={[t.bodyMed, { color: colors.onAccent }]}>Logged</Text>
                      </View>
                    )
                    : <Text style={[t.bodyMed, { color: colors.onAccent }]}>{`I see this ${selected.species}`}</Text>}
              </PressableScale>
            </View>
          </Animated.View>
        </>
      )}

      {/* Pet list bottom sheet */}
      {!selected && (
        <Animated.View
          entering={FadeIn.duration(180)}
          style={[
            styles.listSheet,
            { height: LIST_FULL + insets.bottom, paddingBottom: insets.bottom },
            listSheetStyle,
          ]}
        >
          <GestureDetector gesture={listPan}>
            <View style={styles.listHeader}>
              <TouchableOpacity onPress={toggleList} activeOpacity={0.6} style={styles.handleArea}>
                <View style={styles.handle} />
              </TouchableOpacity>
              <View style={styles.listHeaderRow}>
                <TouchableOpacity onPress={toggleList} activeOpacity={0.7} style={{ flex: 1 }}>
                  <Text style={[t.bodyMed, { color: colors.textPrimary }]}>
                    {searchMode
                      ? (searching ? 'Searching…' : `${listPets.length} match${listPets.length !== 1 ? 'es' : ''}`)
                      : loading
                        ? 'Finding pets…'
                        : listPets.length === 0
                          ? 'Nothing in this area'
                          : `${listPets.length} pet${listPets.length !== 1 ? 's' : ''} in view`}
                  </Text>
                </TouchableOpacity>
                <PressableScale style={styles.logBtn} onPress={() => nav.navigate('Camera')} haptic scaleTo={0.92}>
                  <Text style={styles.logBtnText}>📷  Log sighting</Text>
                </PressableScale>
              </View>

              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by name…"
                  placeholderTextColor={colors.textMuted}
                  value={search}
                  onChangeText={setSearch}
                  onFocus={snapToOpen}
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {!!search && (
                  <Animated.View entering={FadeIn.duration(150)}>
                    <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Text style={[t.caption, { color: colors.textMuted }]}>Clear</Text>
                    </TouchableOpacity>
                  </Animated.View>
                )}
              </View>

              {/* Horizontal scroll rather than wrapping: the row holds enough chips
                  to overflow a narrow phone, and a second line would eat into the
                  list, which is the point of the sheet.

                  "Mine" is parked, not removed. Identity today is the anonymous
                  session in SecureStore, so it belongs to the install rather than
                  the person: reinstall and your pets stop being yours. The filter
                  itself is fine and stays covered by petFilters.test.ts — restore
                  the chip once signing in links a durable identity. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipRow}
                contentContainerStyle={styles.chipRowContent}
                keyboardShouldPersistTaps="handled"
              >
                <ToggleChip
                  on={filters.adoptable}
                  label="♥  Adoptable"
                  onPress={() => toggleFilter('adoptable')}
                  tint={colors.violet} tintFaint={colors.violetFaint} tintBorder={colors.violet}
                />

                {SPECIES_CHIPS.map(sp => (
                  <ToggleChip
                    key={sp.value}
                    on={filters.species.includes(sp.value)}
                    label={sp.label}
                    onPress={() => setFilters(f => toggleSpecies(f, sp.value))}
                  />
                ))}

                {/* Sorting, not filtering — offered only once there is a fix to
                    sort against, so it can never be on with nothing to do. */}
                {!!userCoords && (
                  <Animated.View entering={FadeIn.duration(200)}>
                    <ToggleChip
                      on={sortNearest}
                      label="⌖  Nearest"
                      onPress={() => setSortNearest(v => !v)}
                    />
                  </Animated.View>
                )}
              </ScrollView>
            </View>
          </GestureDetector>

          <ScrollView
            scrollEnabled={listOpen}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              // Search results come from a separate query keyed on the text, so
              // pulling there would refetch the viewport the user cannot see.
              searchMode ? undefined : (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={refetch}
                  tintColor={colors.accent}
                  colors={[colors.accent]}
                />
              )
            }
          >
            {/* The sheet remounts every time the pin card closes; rows already in
                the list at that moment should just be there, not replay their
                entrance. Rows that arrive later (panning, filtering) still animate. */}
            <LayoutAnimationConfig skipEntering>
              {listPets.map((pet, i) => (
                <Animated.View key={pet.id} entering={staggerIn(i)} layout={reflow}>
                  <TouchableOpacity
                    style={[styles.catRow, i === 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                    // A search hit is usually off-screen, so tapping it moves the map
                    // there instead of jumping straight to the profile.
                    onPress={() => (searchMode ? goToPet(pet) : nav.navigate('PetDetail', { petId: pet.id }))}
                    activeOpacity={0.72}
                  >
                    {(pet.thumbnailSmallUrl ?? pet.thumbnailUrl) ? (
                      <Image
                        source={{ uri: pet.thumbnailSmallUrl ?? pet.thumbnailUrl! }}
                        style={styles.catThumb}
                        contentFit="cover" cachePolicy="memory-disk" recyclingKey={pet.id} transition={200}
                      />
                    ) : (
                      <View style={[styles.catThumb, { backgroundColor: pet.color, alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={styles.catInitial}>{pet.initial}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[t.bodyMed, { color: colors.textPrimary, flexShrink: 1 }]} numberOfLines={1}>
                          {pet.name}
                        </Text>
                        {/* Only pets nobody has logged in a week carry this, so it
                            stays a signal rather than decoration on every row. */}
                        {!!freshnessLabel(pet.lastSeenAt) && (
                          <View style={styles.staleBadge}>
                            <Text style={[t.label, { color: colors.violet }]}>needs a check-in</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[t.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                        {!!distanceTo(pet) && `${distanceTo(pet)} · `}
                        Last seen {timeAgo(pet.lastSeenAt)} · {pet.sightingCount} sightings
                      </Text>
                    </View>
                    <Text style={[t.caption, { color: colors.textMuted, fontSize: 18 }]}>›</Text>
                  </TouchableOpacity>
                </Animated.View>
              ))}
            </LayoutAnimationConfig>

            {/* Skeleton rows while the first results for this view are on their way. */}
            {listPets.length === 0 && (searchMode ? searching : loading) && (
              <View style={styles.skeletons}>
                <SkeletonRow avatar={46} />
                <SkeletonRow avatar={46} />
                <SkeletonRow avatar={46} />
              </View>
            )}

            {listPets.length === 0 && !loading && !searching && (
              <Animated.View entering={FadeIn.duration(220)} style={styles.emptyState}>
                <Text style={[t.body, { color: colors.textMuted, textAlign: 'center' }]}>
                  {searchMode
                    ? `Nothing named “${search.trim()}”.`
                    : filters.adoptable || filters.mine || filters.species.length > 0
                      ? 'Nothing here matches those filters.'
                      : `No pets spotted nearby yet.\nUse the button above to add one.`}
                </Text>
              </Animated.View>
            )}
            {/* Legal link — required for app store compliance */}
            <TouchableOpacity
              onPress={() => nav.navigate('Legal')}
              style={{ alignItems: 'center', paddingVertical: 16 }}
              activeOpacity={0.6}
            >
              <Text style={[t.caption, { color: colors.textMuted }]}>Privacy Policy · Terms of Service</Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}
