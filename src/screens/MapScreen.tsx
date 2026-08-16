import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder,
  Platform, ActivityIndicator, ScrollView, TextInput,
  Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Supercluster from 'supercluster';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useTheme, useColors } from '../context/ThemeContext';
import { type as t } from '../constants/typography';
import { DARK_MAP_STYLE } from '../constants/mapStyle';
import { PetPin } from '../components/PetPin';
import { Pet } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';
import { usePetsInViewport, usePetSearch } from '../hooks/usePets';
import { applyFilters, PetFilters, NO_FILTERS } from '../lib/petFilters';
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
        backgroundColor: colors.amberFaint, borderWidth: 1, borderColor: colors.amberBorder,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <View
        collapsable={false}
        style={{
          width: CLUSTER_PHOTO, height: CLUSTER_PHOTO, borderRadius: photoRadius,
          backgroundColor: colors.amber,
          overflow: 'hidden',
          borderWidth: 2, borderColor: colors.amber,
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
        backgroundColor: colors.elevated,
        borderRadius: CLUSTER_BADGE / 2, minWidth: CLUSTER_BADGE, height: CLUSTER_BADGE,
        paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: colors.amber,
      }}>
        <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: colors.amber }}>
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

const LIST_PEEK = 80;
// Raised from 340 when the search field and filter chips were added: the header
// grew by ~90px, and at the old height the list itself was down to three rows.
// Peek is unchanged, so collapsed the sheet still shows just the summary row.
const LIST_FULL = 430;
const PIN_SHEET = 210;

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

  const [selected, setSelected]   = useState<Pet | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [listOpen, setListOpen]   = useState(false);
  const [region, setRegion]       = useState<Region>(FALLBACK_REGION);
  const [queryBounds, setQueryBounds] = useState<[number, number, number, number] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const pinSheetY = useRef(new Animated.Value(0)).current;
  const listY     = useRef(new Animated.Value(LIST_FULL - LIST_PEEK)).current;
  const mapRef    = useRef<MapView>(null);

  const [filters, setFilters] = useState<PetFilters>(NO_FILTERS);
  const [search, setSearch]   = useState('');

  const { pets: viewportPets, loading } = usePetsInViewport(queryBounds);
  const { data: searchHits = [], isFetching: searching } = usePetSearch(search);
  const searchMode = search.trim().length >= 2;

  // Chips narrow both the pins and the list, so the map always reflects what
  // the list is showing.
  const pets = useMemo(
    () => applyFilters(viewportPets, filters, getUserId()),
    [viewportPets, filters],
  );
  const listPets = useMemo(
    () => (searchMode ? applyFilters(searchHits, filters, getUserId()) : pets),
    [searchMode, searchHits, filters, pets],
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

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setQueryBounds(regionToBounds(FALLBACK_REGION));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setUserCoords(coords);
      const r: Region = { latitude: coords.lat, longitude: coords.lng, latitudeDelta: 0.018, longitudeDelta: 0.018 };
      setRegion(r);
      setQueryBounds(regionToBounds(r));
      mapRef.current?.animateToRegion(r, 800);
    })();
    return () => clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    const peekY = Math.max(LIST_FULL - LIST_PEEK - insets.bottom, 0);
    if (!listOpen) listY.setValue(peekY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets.bottom]);

  // ── Sheet animation ─────────────────────────────────────────────────────────

  function peekY() {
    return Math.max(LIST_FULL - LIST_PEEK - insetsRef.current.bottom, 0);
  }

  function snapToOpen() {
    setListOpen(true);
    Animated.spring(listY, { toValue: 0, useNativeDriver: false, tension: 55, friction: 10 }).start();
  }

  function snapToPeek() {
    setListOpen(false);
    Animated.spring(listY, { toValue: peekY(), useNativeDriver: false, tension: 55, friction: 10 }).start();
  }

  function toggleList() { if (listOpen) snapToPeek(); else snapToOpen(); }

  function openPinSheet(pet: Pet) {
    setListOpen(false);
    listY.stopAnimation();
    Animated.spring(listY, { toValue: peekY(), useNativeDriver: false, tension: 55, friction: 10 }).start();
    setSelected(pet);
    Animated.spring(pinSheetY, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }).start();
  }

  function closePinSheet() {
    Animated.spring(pinSheetY, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 })
      .start(() => setSelected(null));
  }

  function handleMapPress() {
    if (selected) closePinSheet();
    else if (listOpen) snapToPeek();
  }

  // ── Pan gesture ─────────────────────────────────────────────────────────────

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dy) > 6 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5,
      onPanResponderGrant: () => { listY.stopAnimation(); listY.extractOffset(); },
      onPanResponderMove: Animated.event([null, { dy: listY }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gs) => {
        listY.flattenOffset();
        const py = Math.max(LIST_FULL - LIST_PEEK - insetsRef.current.bottom, 0);
        const snapDown = gs.vy > 0.3 || (gs.vy >= -0.1 && gs.dy > py * 0.35);
        if (snapDown) {
          setListOpen(false);
          Animated.spring(listY, { toValue: py, useNativeDriver: false, tension: 55, friction: 10 }).start();
        } else {
          setListOpen(true);
          Animated.spring(listY, { toValue: 0, useNativeDriver: false, tension: 55, friction: 10 }).start();
        }
      },
      onPanResponderTerminate: () => {
        listY.flattenOffset();
        const py = Math.max(LIST_FULL - LIST_PEEK - insetsRef.current.bottom, 0);
        setListOpen(false);
        Animated.spring(listY, { toValue: py, useNativeDriver: false, tension: 55, friction: 10 }).start();
      },
    })
  ).current;

  const pinTranslateY = pinSheetY.interpolate({ inputRange: [0, 1], outputRange: [PIN_SHEET + 60, 0] });

  // ── Themed styles ───────────────────────────────────────────────────────────

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },

    topBar:      { position: 'absolute', left: 0, right: 0, zIndex: 10, paddingHorizontal: 16 },
    topBarInner: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 10,
      backgroundColor: isDark ? 'rgba(13, 14, 24, 0.88)' : 'rgba(248, 247, 252, 0.92)',
      borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    },
    wordmark: { color: colors.textPrimary, letterSpacing: 2 },
    badge: {
      paddingHorizontal: 10, paddingVertical: 4,
      backgroundColor: colors.amberFaint, borderRadius: 20,
      borderWidth: 1, borderColor: colors.amberBorder,
      minWidth: 70, alignItems: 'center' as const,
    },

    pinSheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
      backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 20, paddingTop: 12,
    },
    handle: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center' as const },
    sheetRow:   { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
    sheetThumb: { width: 52, height: 52, borderRadius: 26 },
    sheetAvatar:   { width: 52, height: 52, borderRadius: 26, alignItems: 'center' as const, justifyContent: 'center' as const },
    avatarInitial: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.onAmber },
    actions:   { flexDirection: 'row', gap: 10 },
    btnOutline: {
      flex: 1, paddingVertical: 14, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border, alignItems: 'center' as const,
    },
    btnAmber: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.amber, alignItems: 'center' as const },

    listSheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 15,
      backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopWidth: 1, borderTopColor: colors.border, overflow: 'hidden' as const,
    },
    listHeader:    { paddingHorizontal: 20, paddingBottom: 10 },
    handleArea:    { alignItems: 'center' as const, paddingVertical: 10 },
    listHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10,
    },
    searchInput: {
      flex: 1, height: 38, borderRadius: 10,
      backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12,
      color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14,
    },
    chipRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated,
    },
    chipOn: { backgroundColor: colors.amberFaint, borderColor: colors.amberBorder },
    logBtn:     { backgroundColor: colors.amber, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
    logBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: colors.onAmber },
    catRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 20, paddingVertical: 13,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    catThumb:    { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' as const },
    catInitial:  { fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.onAmber },
    emptyState:  { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  }), [colors, isDark]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        customMapStyle={Platform.OS === 'android' && isDark ? DARK_MAP_STYLE : undefined}
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
      <View style={[styles.topBar, { top: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.topBarInner}>
          <Text style={[t.h3, styles.wordmark]}>prowl</Text>
          <View style={styles.badge}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.amber} />
            ) : (
              <Text style={[t.caption, { color: colors.amber, fontWeight: '700' }]}>
                {queryBounds ? `${pets.length} in view` : 'locating…'}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Per-pin quick-action card */}
      {selected && (
        <>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closePinSheet} />
          <Animated.View
            style={[styles.pinSheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY: pinTranslateY }] }]}
          >
            <View style={[styles.handle, { marginBottom: 16 }]} />
            <View style={styles.sheetRow}>
              {(selected.thumbnailSmallUrl ?? selected.thumbnailUrl) ? (
                <Image
                  source={{ uri: selected.thumbnailSmallUrl ?? selected.thumbnailUrl! }}
                  style={styles.sheetThumb}
                  contentFit="cover" cachePolicy="memory-disk" transition={150}
                />
              ) : (
                <View style={[styles.sheetAvatar, { backgroundColor: selected.color }]}>
                  <Text style={styles.avatarInitial}>{selected.initial}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[t.h2, { color: colors.textPrimary }]}>{selected.name}</Text>
                  {selected.status === 'adoptable' && (
                    <View style={{
                      backgroundColor: colors.roseFaint, paddingHorizontal: 8,
                      paddingVertical: 3, borderRadius: 10,
                    }}>
                      <Text style={[t.label, { color: colors.rose }]}>adoptable</Text>
                    </View>
                  )}
                </View>
                <Text style={[t.caption, { color: colors.textSecondary, marginTop: 3 }]}>
                  {selected.sightingCount} sightings · last seen {timeAgo(selected.lastSeenAt)}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.btnOutline}
                onPress={() => { closePinSheet(); nav.navigate('PetDetail', { petId: selected.id }); }}
              >
                <Text style={[t.bodyMed, { color: colors.textPrimary }]}>View profile</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnAmber} onPress={closePinSheet}>
                <Text style={[t.bodyMed, { color: colors.onAmber }]}>I see this cat</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </>
      )}

      {/* Cat list bottom sheet */}
      {!selected && (
        <Animated.View
          style={[
            styles.listSheet,
            { height: LIST_FULL + insets.bottom, paddingBottom: insets.bottom, transform: [{ translateY: listY }] },
          ]}
        >
          <View style={styles.listHeader} {...panResponder.panHandlers}>
            <TouchableOpacity onPress={toggleList} activeOpacity={0.6} style={styles.handleArea}>
              <View style={styles.handle} />
            </TouchableOpacity>
            <View style={styles.listHeaderRow}>
              <TouchableOpacity onPress={toggleList} activeOpacity={0.7} style={{ flex: 1 }}>
                <Text style={[t.bodyMed, { color: colors.textPrimary }]}>
                  {searchMode
                    ? (searching ? 'Searching…' : `${listPets.length} match${listPets.length !== 1 ? 'es' : ''}`)
                    : loading
                      ? 'Finding cats…'
                      : listPets.length === 0
                        ? 'No cats in this area'
                        : `${listPets.length} cat${listPets.length !== 1 ? 's' : ''} in view`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.logBtn} onPress={() => nav.navigate('Camera')} activeOpacity={0.8}>
                <Text style={styles.logBtnText}>📷  Log sighting</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search cats by name…"
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
                onFocus={snapToOpen}
                autoCorrect={false}
                returnKeyType="search"
              />
              {!!search && (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={[t.caption, { color: colors.textMuted }]}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* "Mine" is parked, not removed. Identity today is the anonymous
                session in SecureStore, so it belongs to the install rather than
                the person: reinstall and your cats stop being yours. The filter
                itself is fine and stays covered by petFilters.test.ts — restore
                the chip once signing in links a durable identity. */}
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, filters.adoptable && styles.chipOn]}
                onPress={() => toggleFilter('adoptable')}
                activeOpacity={0.7}
              >
                <Text style={[t.caption, { color: filters.adoptable ? colors.rose : colors.textSecondary }]}>
                  ♥  Adoptable
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView scrollEnabled={listOpen} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {listPets.map((pet, i) => (
              <TouchableOpacity
                key={pet.id}
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
                    contentFit="cover" cachePolicy="memory-disk" recyclingKey={pet.id} transition={150}
                  />
                ) : (
                  <View style={[styles.catThumb, { backgroundColor: pet.color, alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={styles.catInitial}>{pet.initial}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[t.bodyMed, { color: colors.textPrimary }]}>{pet.name}</Text>
                  <Text style={[t.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                    Last seen {timeAgo(pet.lastSeenAt)} · {pet.sightingCount} sightings
                  </Text>
                </View>
                <Text style={[t.caption, { color: colors.textMuted, fontSize: 18 }]}>›</Text>
              </TouchableOpacity>
            ))}
            {listPets.length === 0 && !loading && !searching && (
              <View style={styles.emptyState}>
                <Text style={[t.body, { color: colors.textMuted, textAlign: 'center' }]}>
                  {searchMode
                    ? `No cats named “${search.trim()}”.`
                    : filters.adoptable || filters.mine
                      ? 'No cats here match those filters.'
                      : `No cats spotted nearby yet.\nUse the button above to add one.`}
                </Text>
              </View>
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
