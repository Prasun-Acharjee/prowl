import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Linking, TextInput, Platform, Share,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
    hero:     { minHeight: 220, paddingHorizontal: 20, paddingBottom: 24, overflow: 'hidden' as const },
    heroNav:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    heroPill: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: 'rgba(255,255,255,0.22)',
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
      minWidth: 44, justifyContent: 'center' as const,
    },
    heroMeta:  { marginTop: 12 },
    heroName:  { fontFamily: 'DMSerifDisplay_400Regular', fontSize: 44, lineHeight: 50 },
    heroGlyph: { position: 'absolute' as const, right: -10, bottom: -20, fontFamily: 'DMSerifDisplay_400Regular', fontSize: 180, color: 'rgba(13, 14, 24, 0.1)', lineHeight: 200 },
    scroll:    { flex: 1 },
    statsRow:  { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
    stat:      { flex: 1, alignItems: 'center' as const, paddingVertical: 20, gap: 4 },
    statBorder:{ borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
    section:   { paddingHorizontal: 20, paddingTop: 24 },
    staleStrip: {
      marginHorizontal: 20, marginTop: 20, padding: 14, borderRadius: 14,
      backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border,
    },
    directionsRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 16,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    timelineRow:      { flexDirection: 'row', gap: 14 },
    timelineLine:     { alignItems: 'center' as const, width: 12 },
    timelineDot:      { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
    timelineConnector:{ flex: 1, width: 1, backgroundColor: colors.border, marginTop: 4 },
    sightingPhoto:    { width: '100%' as any, height: 180, borderRadius: 12, marginBottom: 10, backgroundColor: colors.elevated },
    adoptBanner: {
      marginHorizontal: 20, marginTop: 24, padding: 16, borderRadius: 16,
      backgroundColor: colors.roseFaint,
    },
    adoptBtn: {
      marginTop: 14, backgroundColor: colors.rose, paddingVertical: 14,
      borderRadius: 12, alignItems: 'center' as const,
    },
    adoptedStrip: {
      marginHorizontal: 20, marginTop: 24, padding: 14, borderRadius: 16,
      backgroundColor: colors.amberFaint, alignItems: 'center' as const,
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
      borderWidth: 1, borderColor: colors.border,
    },
    ctaBtn: {
      flex: 1, backgroundColor: colors.amber, paddingVertical: 16, borderRadius: 16, alignItems: 'center' as const,
      shadowColor: colors.amber, shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
    },
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
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.amber} />
      </View>
    );
  }

  if (!pet) return null;

  const staleLabel = freshnessLabel(pet.lastSeenAt);

  return (
    <View style={styles.root}>
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: pet.color, paddingTop: insets.top + 10 }]}>
        {pet.thumbnailUrl ? (
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={0.92} onPress={() => setViewerIndex(0)}>
            <Image
              source={{ uri: pet.thumbnailUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover" cachePolicy="memory-disk" priority="high" transition={200}
            />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.72)']} style={StyleSheet.absoluteFill} />
          </TouchableOpacity>
        ) : (
          <Text style={styles.heroGlyph}>{pet.initial}</Text>
        )}

        <View style={styles.heroNav}>
          <TouchableOpacity onPress={() => nav.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <View style={styles.heroPill}>
              <Text style={{ fontSize: 14, color: 'rgba(13,14,24,0.85)', fontFamily: 'Inter_700Bold' }}>←</Text>
              <Text style={{ fontSize: 13, color: 'rgba(13,14,24,0.85)', fontFamily: 'Inter_600SemiBold' }}>Back</Text>
            </View>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {/* Sharing is for everyone; edit and delete are the creator's (00006). */}
            <TouchableOpacity onPress={handleShare} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
              <View style={styles.heroPill}><Text style={{ fontSize: 15 }}>↗</Text></View>
            </TouchableOpacity>
            {ownsPet && (
              <>
                <TouchableOpacity onPress={startEdit} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
                  <View style={styles.heroPill}><Text style={{ fontSize: 15 }}>✎</Text></View>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDelete} disabled={deleting} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
                  <View style={styles.heroPill}>
                    {deleting
                      ? <ActivityIndicator size="small" color="rgba(13,14,24,0.7)" />
                      : <Text style={{ fontSize: 15 }}>🗑</Text>}
                  </View>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        <View style={styles.heroMeta}>
          <Text style={[t.label, { color: 'rgba(255,255,255,0.65)', marginBottom: 6 }]}>
            community {pet.species}
          </Text>
          <Text style={[styles.heroName, { color: '#FFFFFF' }]}>{pet.name}</Text>
          <Text style={[t.caption, { color: 'rgba(255,255,255,0.7)', marginTop: 4 }]}>
            First spotted {fmtDate(pet.firstSeenAt)}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={[t.count, { color: colors.amber }]}>{pet.sightingCount}</Text>
            <Text style={[t.label, { color: colors.textMuted }]}>sightings</Text>
          </View>
          <View style={[styles.stat, styles.statBorder]}>
            <Text style={[t.count, { color: colors.textPrimary }]}>{monthsKnown(pet.firstSeenAt)}</Text>
            <Text style={[t.label, { color: colors.textMuted }]}>months known</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[t.body, { color: colors.rose, fontFamily: fonts.bodyMedium }]}>
              {timeAgo(pet.lastSeenAt)}
            </Text>
            <Text style={[t.label, { color: colors.textMuted }]}>last sighting</Text>
          </View>
        </View>

        {/* Nobody has logged this pet in a while. Phrased as a gap in reporting,
            and paired with the action that closes it — the CTA below. */}
        {!!staleLabel && (
          <View style={styles.staleStrip}>
            <Text style={[t.bodyMed, { color: colors.textPrimary }]}>
              👀  {staleLabel}
            </Text>
            <Text style={[t.caption, { color: colors.textSecondary, marginTop: 4 }]}>
              If you spot {pet.name}, logging it keeps the map honest.
            </Text>
          </View>
        )}

        {/* Walk-there row. Sits directly under the stats because "last seen 2h ago"
            is the line that makes someone want to go and look. */}
        <TouchableOpacity style={styles.directionsRow} onPress={handleDirections} activeOpacity={0.7}>
          <Text style={[t.bodyMed, { color: colors.textPrimary }]} numberOfLines={1}>
            📍  {placeName ? `Last seen near ${placeName}` : 'Last seen here'}
          </Text>
          <Text style={[t.caption, { color: colors.amber }]}>Directions  ›</Text>
        </TouchableOpacity>

        {pet.status === 'adoptable' && (
          <View style={styles.adoptBanner}>
            <Text style={[t.bodyMed, { color: colors.rose }]}>♥  Looking for a home</Text>
            <Text style={[t.caption, { color: colors.textSecondary, marginTop: 6 }]}>
              {pet.name} is ready to be adopted. Reach out to the caretaker to learn more.
            </Text>
            {!!pet.adoptionContact?.trim() && (
              <TouchableOpacity style={styles.adoptBtn} onPress={handleAdoptInterest} activeOpacity={0.85}>
                <Text style={[t.bodyMed, { color: '#FFFFFF' }]}>I'm interested</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {pet.status === 'adopted' && (
          <View style={styles.adoptedStrip}>
            <Text style={[t.bodyMed, { color: colors.textPrimary }]}>🎉  {pet.name} found a home!</Text>
          </View>
        )}

        {editing && (
          <View style={styles.section}>
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
              <TouchableOpacity
                style={styles.ctaBtnOutline}
                onPress={() => setEditing(false)}
                disabled={savingEdit}
                activeOpacity={0.8}
              >
                <Text style={[t.bodyMed, { color: colors.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adoptBtn, { flex: 1, opacity: savingEdit ? 0.5 : 1 }]}
                onPress={saveEdit}
                disabled={savingEdit}
                activeOpacity={0.85}
              >
                {savingEdit
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={[t.bodyMed, { color: '#FFFFFF' }]}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!editing && pet.description && (
          <View style={styles.section}>
            <Text style={[t.body, { color: colors.textSecondary, lineHeight: 24 }]}>{pet.description}</Text>
          </View>
        )}

        {/* Sightings timeline */}
        <View style={styles.section}>
          <Text style={[t.label, { color: colors.textMuted, marginBottom: 16 }]}>Recent sightings</Text>
          {sightings.length === 0 ? (
            <Text style={[t.body, { color: colors.textMuted }]}>No sightings logged yet.</Text>
          ) : (
            sightings.map((s, i) => (
              <View key={s.id} style={styles.timelineRow}>
                <View style={styles.timelineLine}>
                  <View style={[styles.timelineDot, { backgroundColor: i === 0 ? colors.amber : colors.border }]} />
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
                        recyclingKey={s.id} transition={150}
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
              </View>
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
      </ScrollView>

      {/* Sticky CTA */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.ctaRow}>
          <TouchableOpacity style={styles.ctaBtnOutline} onPress={handleAddPhoto} activeOpacity={0.8}>
            <Text style={[t.bodyMed, { color: colors.textPrimary }]}>📷  Add photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctaBtn, saving && { opacity: 0.7 }]}
            onPress={handleLogSighting}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={colors.onAmber} />
              : <Text style={[t.bodyMed, { color: colors.onAmber }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  I see {pet.name}
                </Text>}
          </TouchableOpacity>
        </View>
      </View>

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
