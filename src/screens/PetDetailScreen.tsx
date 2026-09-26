import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Linking, TextInput, Platform, Share,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Extrapolation, FadeIn, FadeInDown, interpolate, useAnimatedScrollHandler,
  useAnimatedStyle, useSharedValue,
} from 'react-native-reanimated';
import ImageViewing from 'react-native-image-viewing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useTheme } from '../context/ThemeContext';
import { type as t, fonts } from '../constants/typography';
import { supabase, getUserId } from '../lib/supabase';
import { deletePhoto } from '../lib/storage';
import { logSightingHere } from '../lib/sightings';
import { directionsUrl, mapsSearchUrl } from '../lib/geo';
import { freshnessLabel } from '../lib/freshness';
import { usePet, useSightings, petKeys } from '../hooks/usePets';
import {
  REPORT_REASONS, ReportTarget, reportContent, blockUser, useRefreshHidden,
} from '../hooks/useModeration';
import { Sighting } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';
import {
  PressableScale, Skeleton, SkeletonRow, SuccessStamp, staggerIn, photoSettle, hapticSuccess,
} from '../components/motion';

const HERO_MIN = 320;

type Route = RouteProp<RootStackParamList, 'PetDetail'>;
type Nav   = StackNavigationProp<RootStackParamList, 'PetDetail'>;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function timeAgo(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return 'Just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}
function monthsKnown(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30));
}

function ViewerHeader({
  imageIndex, sighting, onClose, onDelete, onReport, deleting,
}: {
  imageIndex: number;
  sighting: Sighting | undefined;
  onClose: () => void;
  onDelete: (s: Sighting) => void;
  onReport: (s: Sighting) => void;
  deleting: boolean;
}) {
  const insets = useSafeAreaInsets();
  const isMine = !!sighting && sighting.userId === getUserId();
  return (
    <View style={[viewerStyles.header, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={onClose} style={viewerStyles.btn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={viewerStyles.icon}>✕</Text>
      </TouchableOpacity>
      {sighting && (isMine ? (
        // Only whoever logged the sighting can remove its photo (migration 00006).
        <TouchableOpacity
          onPress={() => onDelete(sighting)}
          style={viewerStyles.btn}
          disabled={deleting}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {deleting
            ? <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
            : <Text style={viewerStyles.icon}>🗑</Text>}
        </TouchableOpacity>
      ) : (
        // Everyone else gets to report it — you can't report your own photo.
        <TouchableOpacity
          onPress={() => onReport(sighting)}
          style={viewerStyles.btn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={viewerStyles.icon}>⚑</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ViewerFooter({ imageIndex, imagesCount }: { imageIndex: number; imagesCount: number }) {
  return (
    <View style={viewerStyles.footer}>
      <Text style={viewerStyles.footerText}>{imageIndex + 1} / {imagesCount}</Text>
    </View>
  );
}

// Viewer is always fullscreen black — no theming needed
const viewerStyles = StyleSheet.create({
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  btn:        { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  icon:       { fontSize: 17, color: 'rgba(255,255,255,0.9)' },
  footer:     { alignItems: 'center', paddingBottom: 32 },
  footerText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontFamily: 'Inter_400Regular' },
});

export function PetDetailScreen() {
  const nav    = useNavigation<Nav>();
  const route  = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const qc     = useQueryClient();
  const { petId } = route.params;

  const { colors } = useTheme();

  const { data: pet, isPending: petLoading }         = usePet(petId);
  const { data: sightings = [], isPending: sightingsLoading } = useSightings(petId);

  const [deleting, setDeleting]           = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  const [saving, setSaving]               = useState(false);
  const [viewerIndex, setViewerIndex]     = useState<number | null>(null);
  const [editing, setEditing]             = useState(false);
  const [editName, setEditName]           = useState('');
  const [editDesc, setEditDesc]           = useState('');
  const [savingEdit, setSavingEdit]       = useState(false);
  const [placeName, setPlaceName]         = useState<string | null>(null);
  // Brief "Logged" stamp on the CTA after a one-tap sighting.
  const [justLogged, setJustLogged]       = useState(false);
  const loggedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(loggedTimer.current), []);

  // ── Scroll-linked hero ──────────────────────────────────────────────────────
  // The photo drifts at half speed as the page scrolls (and stretches on iOS
  // overscroll); the floating nav bar fades to a solid surface with the pet's
  // name once the hero has scrolled away, so its buttons never lose contrast.
  const scrollY = useSharedValue(0);
  const heroH   = useSharedValue(HERO_MIN);
  const onScroll = useAnimatedScrollHandler(e => { scrollY.value = e.contentOffset.y; });

  const parallax = useAnimatedStyle(() => {
    const y = scrollY.value;
    return y >= 0
      ? { transform: [{ translateY: y * 0.45 }] }
      : { transform: [{ translateY: y / 2 }, { scale: 1 + -y / heroH.value }] };
  });
  const barSolid = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [heroH.value - 140, heroH.value - 80], [0, 1], Extrapolation.CLAMP),
  }));
  const barTitle = useAnimatedStyle(() => {
    const p = interpolate(scrollY.value, [heroH.value - 110, heroH.value - 60], [0, 1], Extrapolation.CLAMP);
    return { opacity: p, transform: [{ translateY: (1 - p) * 8 }] };
  });

  // "Last seen here" says nothing a map pin does not. A street or neighbourhood
  // name is what someone would actually repeat to a friend, so resolve one —
  // best-effort, and the row reads fine without it if the lookup fails or the
  // point is somewhere with no address at all.
  const lat = pet?.latitude;
  const lng = pet?.longitude;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        // Don't prompt from here: the user came to read a profile, and a
        // permission dialog for a cosmetic label would be an ambush.
        if (status !== 'granted') return;
        const [r] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (cancelled || !r) return;
        setPlaceName(r.street ?? r.district ?? r.subregion ?? r.city ?? null);
      } catch {
        // Offline, or no geocoder on the platform. The row keeps its plain copy.
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng]);

  // Ownership drives what's deletable (migration 00006). Hide the buttons rather
  // than letting RLS turn them into errors.
  const uid = getUserId();
  const ownsPet = !!pet && !!uid && pet.createdBy === uid;
  const refreshHidden = useRefreshHidden();

  const allPhotos = useMemo(() =>
    sightings.filter(s => s.photoUri).map(s => ({ uri: s.photoUri! })),
  [sightings]);

  const indexToSighting = useMemo(() => {
    const map = new Map<number, Sighting>();
    let idx = 0;
    sightings.forEach(s => { if (s.photoUri) map.set(idx++, s); });
    return map;
  }, [sightings]);

  const sightingIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    sightings.forEach(s => { if (s.photoUri) map.set(s.id, idx++); });
    return map;
  }, [sightings]);

  // ── Themed styles ────────────────────────────────────────────────────────────

  const styles = useMemo(() => StyleSheet.create({
    root:     { flex: 1, backgroundColor: colors.bg },
    hero:     {
      minHeight: HERO_MIN, paddingHorizontal: 20, paddingBottom: 26,
      justifyContent: 'flex-end' as const, overflow: 'hidden' as const,
    },
    navBar:   { position: 'absolute' as const, top: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: 16, paddingBottom: 10 },
    navSolid: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    navRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
    navTitle: { flex: 1 },
    // Dark glass reads on a photo, a flat colour, and either theme's surface.
    heroPill: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: 'rgba(22, 15, 31, 0.46)',
      paddingHorizontal: 12, height: 38, borderRadius: 19,
      minWidth: 38, justifyContent: 'center' as const,
    },
    pillText:  { fontSize: 13, color: '#FFFFFF', fontFamily: 'Inter_500Medium' },
    pillIcon:  { fontSize: 15, color: '#FFFFFF' },
    heroMeta:  { marginTop: 12 },
    heroName:  { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 46, lineHeight: 52 },
    heroGlyph: { position: 'absolute' as const, right: -10, bottom: -20, fontFamily: 'DMSerifDisplay_400Regular', fontSize: 200, color: 'rgba(22, 15, 31, 0.12)', lineHeight: 220 },
    sheet:     {
      marginTop: -22, borderTopLeftRadius: 26, borderTopRightRadius: 26,
      backgroundColor: colors.bg, paddingTop: 6,
    },
    statsRow:  {
      flexDirection: 'row', marginHorizontal: 16, marginTop: 10,
      backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    },
    stat:      { flex: 1, alignItems: 'center' as const, paddingVertical: 18, gap: 4 },
    statBorder:{ borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
    section:   { paddingHorizontal: 20, paddingTop: 24 },
    staleStrip: {
      marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: 16,
      backgroundColor: colors.violetFaint,
    },
    directionsRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginHorizontal: 16, marginTop: 12, paddingHorizontal: 16, paddingVertical: 16,
      backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    },
    timelineRow:      { flexDirection: 'row', gap: 14 },
    timelineLine:     { alignItems: 'center' as const, width: 12 },
    timelineDot:      { width: 12, height: 12, borderRadius: 6, marginTop: 4, borderWidth: 2, borderColor: colors.bg },
    timelineConnector:{ flex: 1, width: 2, borderRadius: 1, backgroundColor: colors.border, marginTop: 4 },
    sightingPhoto:    { width: '100%' as any, height: 190, borderRadius: 16, marginBottom: 10, backgroundColor: colors.elevated },
    adoptBanner: {
      marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: 20,
      backgroundColor: colors.violetFaint, borderWidth: 1, borderColor: colors.violetFaint,
    },
    adoptBtn: {
      marginTop: 14, backgroundColor: colors.violet, paddingVertical: 14,
      borderRadius: 14, alignItems: 'center' as const,
    },
    adoptedStrip: {
      marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: 20,
      backgroundColor: colors.accentFaint, alignItems: 'center' as const,
    },
    cta:     { paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
    editInput: {
      backgroundColor: colors.elevated, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, paddingVertical: 12,
      color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 15,
    },
    modRow: {
      flexDirection: 'row', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 24, paddingBottom: 4,
      borderTopWidth: 1, borderTopColor: colors.border, marginTop: 24,
    },
    ctaRow:  { flexDirection: 'row', gap: 10 },
    ctaBtnOutline: {
      flex: 1, paddingVertical: 16, borderRadius: 16, alignItems: 'center' as const,
      backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border,
    },
    ctaBtn: {
      flex: 1, backgroundColor: colors.accent, paddingVertical: 16, borderRadius: 16,
      alignItems: 'center' as const, justifyContent: 'center' as const,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35, shadowRadius: 14, elevation: 6,
    },
    loggedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    loadingPad: { paddingHorizontal: 20, paddingTop: 28, gap: 22 },
  }), [colors]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleDelete() {
    Alert.alert(
      `Remove ${pet?.name}?`,
      `This deletes all sightings and photos for this ${pet?.species ?? 'pet'}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (!pet) return;
            setDeleting(true);
            try {
              const { error } = await supabase.from('pets').delete().eq('id', pet.id);
              if (error) throw error;
              await qc.invalidateQueries({ queryKey: ['pets'] });
              nav.goBack();
            } catch (err: any) {
              Alert.alert('Error', err.message);
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }

  function handleDeletePhoto(sighting: Sighting) {
    Alert.alert(
      'Delete photo?',
      'The sighting log is kept but the photo is permanently removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setDeletingPhoto(true);
            try {
              // One RPC: nulls photo_url and repairs the pet's thumbnails if it
              // was showing this photo. Repairing pets from the client is no
              // longer permitted for non-creators, and this also removes the
              // race between the two writes.
              //
              // Runs before the storage delete because it is the authorization
              // check: deleting the file first would leave a dangling reference
              // if the RPC then rejected. An orphaned file is the safer failure.
              const { error: rpcErr } = await supabase
                .rpc('clear_sighting_photo', { p_sighting_id: sighting.id });
              if (rpcErr) throw new Error(rpcErr.message);

              await deletePhoto(sighting.photoUri!);

              setViewerIndex(null);
              await Promise.all([
                qc.invalidateQueries({ queryKey: petKeys.detail(petId) }),
                qc.invalidateQueries({ queryKey: petKeys.sightings(petId) }),
                qc.invalidateQueries({ queryKey: ['pets', 'bounds'] }),
              ]);
            } catch (err: any) {
              Alert.alert('Error', err.message);
            } finally {
              setDeletingPhoto(false);
            }
          },
        },
      ],
    );
  }

  // ── Editing ──────────────────────────────────────────────────────────────────

  function startEdit() {
    if (!pet) return;
    setEditName(pet.name);
    setEditDesc(pet.description ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    if (!pet) return;
    const name = editName.trim();
    if (!name) {
      Alert.alert('Name required', `Give this ${pet.species} a name before saving.`);
      return;
    }
    setSavingEdit(true);
    try {
      // pets_update (migration 00006) already scopes this to the creator, so no
      // ownership check is needed here beyond hiding the button.
      const { error } = await supabase
        .from('pets')
        .update({ name, description: editDesc.trim() || null })
        .eq('id', pet.id);
      if (error) throw new Error(error.message);

      setEditing(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: petKeys.detail(petId) }),
        qc.invalidateQueries({ queryKey: ['pets', 'bounds'] }),
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Moderation ───────────────────────────────────────────────────────────────

  // Reporting hides the item for this user only. Nothing is removed for anyone
  // else until the admin acts on it — otherwise a single report would be enough
  // to wipe any cat off the map.
  function handleReport(targetType: ReportTarget, targetId: string, what: string) {
    Alert.alert(
      `Report this ${what}?`,
      "Tell us what's wrong. It'll be hidden from you straight away and reviewed by us.",
      [
        ...REPORT_REASONS.map(r => ({
          text: r.label,
          onPress: async () => {
            try {
              await reportContent(targetType, targetId, r.key);
              setViewerIndex(null);
              await refreshHidden();
              Alert.alert('Thanks', "Reported. You won't see this again.");
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }

  function handleBlock() {
    const uploader = pet?.createdBy;
    if (!uploader) {
      Alert.alert('Not available', 'We do not know who added this pet, so there is nobody to block.');
      return;
    }
    Alert.alert(
      'Block this contributor?',
      "You'll stop seeing every pet and photo they've added. This only affects what you see.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block', style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(uploader);
              await refreshHidden();
              nav.goBack();
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ],
    );
  }

  function handleLogSighting() {
    if (!pet) return;
    Alert.alert(
      `You see ${pet.name}?`,
      'Would you like to add a photo?',
      [
        { text: 'Add photo',    onPress: () => nav.navigate('Camera') },
        { text: 'No, just log it', onPress: logSightingNow },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  async function logSightingNow() {
    if (!pet) return;
    setSaving(true);
    try {
      await logSightingHere(pet.id);
      await qc.invalidateQueries({ queryKey: ['pets'] });
      hapticSuccess();
      setJustLogged(true);
      clearTimeout(loggedTimer.current);
      loggedTimer.current = setTimeout(() => setJustLogged(false), 1400);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Sharing / directions ─────────────────────────────────────────────────────

  /**
   * Opens the platform's own maps app at the last-seen point. This is the whole
   * reason someone opens a profile on the street: knowing a cat is 300 m away is
   * only useful if you can be told which way to walk.
   */
  async function handleDirections() {
    if (!pet) return;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const url = directionsUrl(pet.latitude, pet.longitude, pet.name, platform);
    try {
      await Linking.openURL(url);
    } catch {
      // No maps app (simulators, stripped Android images) — fall back to the web
      // link, which every device can open.
      await Linking.openURL(mapsSearchUrl(pet.latitude, pet.longitude)).catch(() => {
        Alert.alert('Location', `${pet.latitude.toFixed(5)}, ${pet.longitude.toFixed(5)}`);
      });
    }
  }

  /**
   * Shares a cat as text plus a maps link. Prowl has no web presence to link to,
   * so the link points at the spot rather than at a profile — that opens for
   * whoever receives it whether or not they have the app.
   */
  async function handleShare() {
    if (!pet) return;
    const lines = [
      `${pet.name} — a community ${pet.species} on Prowl.`,
      `Last seen ${timeAgo(pet.lastSeenAt).toLowerCase()} · ${pet.sightingCount} sighting${pet.sightingCount === 1 ? '' : 's'}.`,
      pet.status === 'adoptable' ? `${pet.name} is looking for a home.` : null,
      mapsSearchUrl(pet.latitude, pet.longitude),
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // User dismissed the sheet, or no share targets exist. Nothing to say.
    }
  }

  function handleAddPhoto() {
    if (!pet) return;
    nav.navigate('AddSighting', { petId: pet.id, defaultLat: pet.latitude, defaultLng: pet.longitude });
  }

  async function handleAdoptInterest() {
    const contact = pet?.adoptionContact?.trim();
    if (!pet || !contact) return;
    try {
      if (contact.includes('@')) {
        const subject = encodeURIComponent(`Interested in adopting ${pet.name} (Prowl)`);
        await Linking.openURL(`mailto:${contact}?subject=${subject}`);
        return;
      }
      const digits = contact.replace(/[^\d]/g, '');
      const text   = encodeURIComponent(`Hi! I saw ${pet.name} on Prowl and I'm interested in adopting.`);
      const waUrl  = `whatsapp://send?phone=${digits}&text=${text}`;
      if (await Linking.canOpenURL(waUrl)) {
        await Linking.openURL(waUrl);
      } else {
        await Linking.openURL(`tel:${contact}`);
      }
    } catch {
      // Simulators often have no Mail/Phone handler — at least show the contact.
      Alert.alert('Contact', contact);
    }
  }

  // ── Loading / empty states ───────────────────────────────────────────────────

  if (petLoading || sightingsLoading) {
    return (
      <View style={styles.root}>
        <Skeleton height={HERO_MIN + insets.top} radius={0} />
        <View style={styles.loadingPad}>
          <Skeleton height={76} radius={20} />
          <SkeletonRow avatar={12} />
          <Skeleton height={160} radius={16} />
          <SkeletonRow avatar={12} />
        </View>
      </View>
    );
  }

  if (!pet) return null;

  const staleLabel = freshnessLabel(pet.lastSeenAt);

  return (
    <View style={styles.root}>
      {/* Floating nav — outside the scroll so back / share / edit / delete stay
          on screen at every scroll position, as they did with the fixed hero. */}
      <View style={[styles.navBar, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <Animated.View style={[styles.navSolid, barSolid]} pointerEvents="none" />
        <View style={styles.navRow} pointerEvents="box-none">
          <PressableScale onPress={() => nav.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} scaleTo={0.9}>
            <View style={styles.heroPill}>
              <Text style={[styles.pillText, { fontFamily: 'Inter_700Bold' }]}>←</Text>
              <Text style={styles.pillText}>Back</Text>
            </View>
          </PressableScale>

          <Animated.View style={[styles.navTitle, barTitle]} pointerEvents="none">
            <Text style={[t.bodyMed, { color: colors.textPrimary }]} numberOfLines={1}>{pet.name}</Text>
          </Animated.View>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {/* Sharing is for everyone; edit and delete are the creator's (00006). */}
            <PressableScale onPress={handleShare} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} scaleTo={0.88}>
              <View style={styles.heroPill}><Text style={styles.pillIcon}>↗</Text></View>
            </PressableScale>
            {ownsPet && (
              <>
                <PressableScale onPress={startEdit} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} scaleTo={0.88}>
                  <View style={styles.heroPill}><Text style={styles.pillIcon}>✎</Text></View>
                </PressableScale>
                <PressableScale onPress={handleDelete} disabled={deleting} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} scaleTo={0.88}>
                  <View style={styles.heroPill}>
                    {deleting
                      ? <ActivityIndicator size="small" color="#FFFFFF" />
                      : <Text style={{ fontSize: 15 }}>🗑</Text>}
                  </View>
                </PressableScale>
              </>
            )}
          </View>
        </View>
      </View>

      <Animated.ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {/* Hero */}
        <View
          style={[styles.hero, { backgroundColor: pet.color, paddingTop: insets.top + 64 }]}
          onLayout={e => { heroH.value = e.nativeEvent.layout.height; }}
        >
          {pet.thumbnailUrl ? (
            <Animated.View style={[StyleSheet.absoluteFill, parallax]}>
              <Animated.View entering={photoSettle} style={StyleSheet.absoluteFill}>
                <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={0.92} onPress={() => setViewerIndex(0)}>
                  <Image
                    source={{ uri: pet.thumbnailUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover" cachePolicy="memory-disk" priority="high" transition={200}
                  />
                  <LinearGradient
                    colors={['rgba(22,15,31,0.35)', 'transparent', 'rgba(22,15,31,0.8)']}
                    locations={[0, 0.35, 1]}
                    style={StyleSheet.absoluteFill}
                  />
                </TouchableOpacity>
              </Animated.View>
            </Animated.View>
          ) : (
            <Animated.Text entering={FadeIn.duration(400)} style={styles.heroGlyph}>{pet.initial}</Animated.Text>
          )}

          <Animated.View entering={FadeInDown.delay(120).springify().damping(18)} style={styles.heroMeta} pointerEvents="none">
            <Text style={[t.label, { color: 'rgba(255,255,255,0.7)', marginBottom: 6 }]}>
              community {pet.species}
            </Text>
            <Text style={[styles.heroName, { color: '#FFFFFF' }]}>{pet.name}</Text>
            <Text style={[t.caption, { color: 'rgba(255,255,255,0.75)', marginTop: 4 }]}>
              First spotted {fmtDate(pet.firstSeenAt)}
            </Text>
          </Animated.View>
        </View>

        <View style={styles.sheet}>
          {/* Stats */}
          <Animated.View entering={staggerIn(0, 160)} style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[t.count, { color: colors.accent }]}>{pet.sightingCount}</Text>
              <Text style={[t.label, { color: colors.textMuted }]}>sightings</Text>
            </View>
            <View style={[styles.stat, styles.statBorder]}>
              <Text style={[t.count, { color: colors.textPrimary }]}>{monthsKnown(pet.firstSeenAt)}</Text>
              <Text style={[t.label, { color: colors.textMuted }]}>months known</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[t.body, { color: colors.violet, fontFamily: fonts.bodyMedium }]}>
                {timeAgo(pet.lastSeenAt)}
              </Text>
              <Text style={[t.label, { color: colors.textMuted }]}>last sighting</Text>
            </View>
          </Animated.View>

          {/* Nobody has logged this pet in a while. Phrased as a gap in reporting,
              and paired with the action that closes it — the CTA below. */}
          {!!staleLabel && (
            <Animated.View entering={staggerIn(1, 160)} style={styles.staleStrip}>
              <Text style={[t.bodyMed, { color: colors.textPrimary }]}>
                👀  {staleLabel}
              </Text>
              <Text style={[t.caption, { color: colors.textSecondary, marginTop: 4 }]}>
                If you spot {pet.name}, logging it keeps the map honest.
              </Text>
            </Animated.View>
          )}

          {/* Walk-there row. Sits directly under the stats because "last seen 2h ago"
              is the line that makes someone want to go and look. */}
          <Animated.View entering={staggerIn(2, 160)}>
            <PressableScale style={styles.directionsRow} onPress={handleDirections} scaleTo={0.98}>
              <Text style={[t.bodyMed, { color: colors.textPrimary, flexShrink: 1 }]} numberOfLines={1}>
                📍  {placeName ? `Last seen near ${placeName}` : 'Last seen here'}
              </Text>
              <Text style={[t.caption, { color: colors.accent, fontFamily: fonts.bodyMedium }]}>Directions  ›</Text>
            </PressableScale>
          </Animated.View>

          {pet.status === 'adoptable' && (
            <Animated.View entering={staggerIn(3, 160)} style={styles.adoptBanner}>
              <Text style={[t.bodyMed, { color: colors.violet }]}>♥  Looking for a home</Text>
              <Text style={[t.caption, { color: colors.textSecondary, marginTop: 6 }]}>
                {pet.name} is ready to be adopted. Reach out to the caretaker to learn more.
              </Text>
              {!!pet.adoptionContact?.trim() && (
                <PressableScale style={styles.adoptBtn} onPress={handleAdoptInterest} haptic>
                  <Text style={[t.bodyMed, { color: '#FFFFFF' }]}>I'm interested</Text>
                </PressableScale>
              )}
            </Animated.View>
          )}

          {pet.status === 'adopted' && (
            <Animated.View entering={staggerIn(3, 160)} style={styles.adoptedStrip}>
              <Text style={[t.bodyMed, { color: colors.textPrimary }]}>🎉  {pet.name} found a home!</Text>
            </Animated.View>
          )}

          {editing && (
            <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.section}>
              <Text style={[t.label, { color: colors.textMuted, marginBottom: 8 }]}>Name</Text>
              <TextInput
                style={styles.editInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="e.g. Miso"
                placeholderTextColor={colors.textMuted}
                maxLength={60}
              />
              <Text style={[t.label, { color: colors.textMuted, marginTop: 16, marginBottom: 8 }]}>Description</Text>
              <TextInput
                style={[styles.editInput, { minHeight: 88, textAlignVertical: 'top' }]}
                value={editDesc}
                onChangeText={setEditDesc}
                placeholder="Markings, temperament, where they usually sit…"
                placeholderTextColor={colors.textMuted}
                maxLength={500}
                multiline
              />
              <View style={[styles.ctaRow, { marginTop: 14 }]}>
                <PressableScale
                  style={styles.ctaBtnOutline}
                  onPress={() => setEditing(false)}
                  disabled={savingEdit}
                >
                  <Text style={[t.bodyMed, { color: colors.textPrimary }]}>Cancel</Text>
                </PressableScale>
                <PressableScale
                  style={[styles.adoptBtn, { flex: 1, marginTop: 0, opacity: savingEdit ? 0.5 : 1 }]}
                  onPress={saveEdit}
                  disabled={savingEdit}
                >
                  {savingEdit
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <Text style={[t.bodyMed, { color: '#FFFFFF' }]}>Save</Text>}
                </PressableScale>
              </View>
            </Animated.View>
          )}

          {!editing && pet.description && (
            <Animated.View entering={FadeIn.delay(200).duration(260)} style={styles.section}>
              <Text style={[t.body, { color: colors.textSecondary, lineHeight: 24 }]}>{pet.description}</Text>
            </Animated.View>
          )}

          {/* Sightings timeline */}
          <View style={styles.section}>
            <Text style={[t.label, { color: colors.textMuted, marginBottom: 16 }]}>Recent sightings</Text>
            {sightings.length === 0 ? (
              <Text style={[t.body, { color: colors.textMuted }]}>No sightings logged yet.</Text>
            ) : (
              sightings.map((s, i) => (
                <Animated.View key={s.id} entering={staggerIn(i, 240)} style={styles.timelineRow}>
                  <View style={styles.timelineLine}>
                    <View style={[styles.timelineDot, { backgroundColor: i === 0 ? colors.accent : colors.border }]} />
                    {i < sightings.length - 1 && <View style={styles.timelineConnector} />}
                  </View>
                  <View style={{ flex: 1, paddingBottom: 20 }}>
                    {s.photoUri ? (
                      <TouchableOpacity
                        activeOpacity={0.88}
                        onPress={() => setViewerIndex(sightingIndexMap.get(s.id) ?? null)}
                      >
                        <Image
                          source={{ uri: s.photoUri }}
                          style={styles.sightingPhoto}
                          contentFit="cover" cachePolicy="memory-disk"
                          recyclingKey={s.id} transition={200}
                        />
                      </TouchableOpacity>
                    ) : null}
                    <Text style={[t.bodyMed, { color: colors.textPrimary }]}>{fmtDate(s.timestamp)}</Text>
                    <Text style={[t.caption, { color: colors.textSecondary, marginTop: 2 }]}>{fmtTime(s.timestamp)}</Text>
                    {!!s.note && (
                      <Text style={[t.caption, { color: colors.textPrimary, marginTop: 6, lineHeight: 18 }]}>
                        “{s.note}”
                      </Text>
                    )}
                  </View>
                </Animated.View>
              ))
            )}
          </View>

          {/* Moderation. Hidden on your own pet — you can delete it instead. */}
          {!ownsPet && (
            <View style={styles.modRow}>
              <TouchableOpacity onPress={() => handleReport('pet', pet.id, pet.species)} activeOpacity={0.6}>
                <Text style={[t.caption, { color: colors.textMuted }]}>⚑  Report this {pet.species}</Text>
              </TouchableOpacity>
              {!!pet.createdBy && pet.createdBy !== uid && (
                <TouchableOpacity onPress={handleBlock} activeOpacity={0.6}>
                  <Text style={[t.caption, { color: colors.textMuted }]}>Block contributor</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={{ height: 100 }} />
        </View>
      </Animated.ScrollView>

      {/* Sticky CTA */}
      <Animated.View
        entering={FadeInDown.delay(200).springify().damping(20)}
        style={[styles.cta, { paddingBottom: insets.bottom + 12 }]}
      >
        <View style={styles.ctaRow}>
          <PressableScale style={styles.ctaBtnOutline} onPress={handleAddPhoto}>
            <Text style={[t.bodyMed, { color: colors.textPrimary }]}>📷  Add photo</Text>
          </PressableScale>
          <PressableScale
            style={[styles.ctaBtn, saving && { opacity: 0.7 }]}
            onPress={handleLogSighting}
            disabled={saving}
            haptic
          >
            {saving
              ? <ActivityIndicator color={colors.onAccent} />
              : justLogged
                ? (
                  <View style={styles.loggedRow}>
                    <SuccessStamp size={20} color={colors.onAccent} checkColor={colors.accent} />
                    <Text style={[t.bodyMed, { color: colors.onAccent }]}>Logged</Text>
                  </View>
                )
                : <Text style={[t.bodyMed, { color: colors.onAccent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                    I see {pet.name}
                  </Text>}
          </PressableScale>
        </View>
      </Animated.View>

      <ImageViewing
        images={allPhotos}
        imageIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onRequestClose={() => setViewerIndex(null)}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
        HeaderComponent={({ imageIndex }) => (
          <ViewerHeader
            imageIndex={imageIndex}
            sighting={indexToSighting.get(imageIndex)}
            onClose={() => setViewerIndex(null)}
            onDelete={handleDeletePhoto}
            onReport={s => handleReport('sighting', s.id, 'photo')}
            deleting={deletingPhoto}
          />
        )}
        FooterComponent={({ imageIndex }) => (
          <ViewerFooter imageIndex={imageIndex} imagesCount={allPhotos.length} />
        )}
      />
    </View>
  );
}
