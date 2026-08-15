import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Linking,
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
import { usePet, useSightings, petKeys } from '../hooks/usePets';
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
  imageIndex, sighting, onClose, onDelete, deleting,
}: {
  imageIndex: number;
  sighting: Sighting | undefined;
  onClose: () => void;
  onDelete: (s: Sighting) => void;
  deleting: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[viewerStyles.header, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={onClose} style={viewerStyles.btn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={viewerStyles.icon}>✕</Text>
      </TouchableOpacity>
      {/* Only whoever logged the sighting can remove its photo (migration 00006). */}
      {sighting && sighting.userId === getUserId() && (
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
      )}
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

  // Ownership drives what's deletable (migration 00006). Hide the buttons rather
  // than letting RLS turn them into errors.
  const uid = getUserId();
  const ownsPet = !!pet && !!uid && pet.createdBy === uid;

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
      'This deletes all sightings and photos for this cat. This cannot be undone.',
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
      // Sequential, not Promise.all: reading the position before the permission
      // prompt resolves throws on a fresh install.
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

      const { error } = await supabase.rpc('log_sighting', {
        p_pet_id:  pet.id,
        p_lat:     loc.coords.latitude,
        p_lng:     loc.coords.longitude,
      });
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ['pets'] });
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
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

          {ownsPet && (
            <TouchableOpacity onPress={handleDelete} disabled={deleting} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <View style={styles.heroPill}>
                {deleting
                  ? <ActivityIndicator size="small" color="rgba(13,14,24,0.7)" />
                  : <Text style={{ fontSize: 15 }}>🗑</Text>}
              </View>
            </TouchableOpacity>
          )}
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

        {pet.description && (
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
                </View>
              </View>
            ))
          )}
        </View>
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
