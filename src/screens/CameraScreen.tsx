import React, { useEffect, useRef, useState } from 'react';
import { extractExifLocation } from '../lib/exif';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Alert, TextInput, ActivityIndicator, Image as RNImage,
} from 'react-native';
import Animated, { FadeIn, FadeInRight, SlideInDown } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, StackActions } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useTheme } from '../context/ThemeContext';
import { type as t } from '../constants/typography';
import { supabase } from '../lib/supabase';
import { uploadPhoto } from '../lib/storage';
import { RootStackParamList } from '../navigation/RootNavigator';
import { Species } from '../types';
import { avatarColor } from '../constants/colors';
import {
  PressableScale, ToggleChip, SkeletonRow, SuccessOverlay, ShutterFlash,
  staggerIn, photoSettle, hapticSuccess, SUCCESS_HOLD_MS,
} from '../components/motion';

type Nav = StackNavigationProp<RootStackParamList, 'Camera'>;

type Screen = 'capture' | 'uploading' | 'candidates' | 'new-pet';

// The species a new pet can be. `pets.species` is constrained to exactly this
// set by migration 00009, so adding to one without the other will be rejected
// by the insert rather than silently stored.
const SPECIES: { value: Species; label: string; glyph: string }[] = [
  { value: 'cat', label: 'Cat', glyph: '🐱' },
  { value: 'dog', label: 'Dog', glyph: '🐶' },
];

const SEARCH_RADIUS_M = 300;

interface Candidate {
  id:             string;
  name:           string;
  thumbnailUrl:   string | null;
  color:          string;
  initial:        string;
  sightingCount:  number;
  distanceMeters: number;
}

function fmtDist(m: number) { return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`; }

export function CameraScreen() {
  const nav    = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [screen, setScreen]       = useState<Screen>('capture');
  const [capturedUri, setCapturedUri]     = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl]     = useState<string | null>(null);
  const [uploadedThumbUrl, setUploadedThumbUrl] = useState<string | null>(null);
  const [coords, setCoords]       = useState<{ lat: number; lng: number } | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [newPetName, setNewPetName] = useState('');
  // Cats are the overwhelming majority of what gets logged, so that is the
  // default; the picker exists because the schema and the map have always
  // supported dogs and nothing in the app could create one.
  const [species, setSpecies]     = useState<Species>('cat');
  const [saving, setSaving]       = useState(false);
  const [placePhrase, setPlacePhrase] = useState<string | null>(null);
  // Optional, and shared by every candidate: typing a note then tapping a pet
  // keeps logging a single tap rather than adding a confirm step.
  const [note, setNote]           = useState('');

  const photoCoords = useRef<{ lat: number; lng: number } | null>(null);

  // Confirmation shown for a beat after a save, before the screen moves on.
  const [done, setDone] = useState<string | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(doneTimer.current), []);

  function celebrate(label: string, then: () => void) {
    hapticSuccess();
    setDone(label);
    doneTimer.current = setTimeout(then, SUCCESS_HOLD_MS);
  }

  const noun = species === 'dog' ? 'Dog' : 'Cat';
  // What the pet is called when the user leaves the name blank.
  const fallbackName = placePhrase ? `${noun} ${placePhrase}` : `Community ${noun.toLowerCase()}`;

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then(loc => setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude }));
    });
  }, []);

  async function handleCapture() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera access required', 'Enable camera access in Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false, exif: true });
    if (!result.canceled) await processPhoto(result.assets[0]);
  }

  async function handleLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photo access required', 'Enable photo library access in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.9, allowsEditing: false, exif: true });
    if (!result.canceled) await processPhoto(result.assets[0]);
  }

  async function processPhoto(asset: ImagePicker.ImagePickerAsset) {
    setCapturedUri(asset.uri);
    setScreen('uploading');

    try {
      const exifCoords    = asset.exif ? extractExifLocation(asset.exif as Record<string, any>) : null;
      const effectiveCoords = exifCoords ?? coords;
      photoCoords.current = effectiveCoords;

      const tempId = Date.now().toString();
      const { publicUrl, thumbPublicUrl } = await uploadPhoto(asset.uri, 'sightings', tempId);
      setUploadedUrl(publicUrl);
      setUploadedThumbUrl(thumbPublicUrl);

      let rows: Candidate[] = [];
      if (effectiveCoords) {
        const { lat, lng } = effectiveCoords;

        // Sorted by distance from where the photo was taken — nearby_pets orders
        // by ST_Distance, so the closest cat is already first. effectiveCoords
        // prefers the photo's own EXIF GPS over the device's current position, so
        // a library photo sorts against where it was shot, not where you stand.
        const { data } = await supabase.rpc('nearby_pets', {
          lat, lng, radius_meters: SEARCH_RADIUS_M,
        });

        rows = ((data ?? []) as any[]).map(row => ({
          id:             row.id,
          name:           row.name,
          thumbnailUrl:   row.thumbnail_url,
          color:          avatarColor(row.id),
          initial:        row.name.charAt(0).toUpperCase(),
          sightingCount:  row.sighting_count,
          distanceMeters: row.distance_meters ?? 0,
        }));
      }

      setCandidates(rows);
      setScreen('candidates');
    } catch (err: any) {
      Alert.alert('Upload failed', err.message);
      setScreen('capture');
      setCapturedUri(null);
    }
  }

  async function confirmMatch(petId: string) {
    const c = photoCoords.current ?? coords;
    if (!c) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('log_sighting', {
        p_pet_id:          petId,
        p_lat:             c.lat,
        p_lng:             c.lng,
        p_photo_url:       uploadedUrl,
        p_photo_thumb_url: uploadedThumbUrl,
        p_note:            note.trim() || null,
      });
      if (error) throw new Error(error.message);
      celebrate('Sighting logged', () => nav.dispatch(StackActions.replace('PetDetail', { petId })));
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * The place half of an auto-generated name — "near Church St", "in Bandra".
   * Kept separate from the species noun so that flipping the picker relabels
   * instantly instead of costing another reverse-geocode round trip.
   */
  async function placePhraseFromCoords(lat: number, lng: number): Promise<string | null> {
    try {
      const [result] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (result) {
        if (result.street) return `near ${result.street}`;
        const area = result.district ?? result.subregion ?? result.city;
        if (area) return `in ${area}`;
      }
    } catch {}
    return null;
  }

  async function handleNewPet() {
    const c = photoCoords.current ?? coords;
    if (c) setPlacePhrase(await placePhraseFromCoords(c.lat, c.lng));
    setScreen('new-pet');
  }

  async function createNewPet() {
    const c = photoCoords.current ?? coords;
    if (!c) return;
    setSaving(true);
    try {
      const name = newPetName.trim() || fallbackName;

      const { data: pet, error } = await supabase
        .from('pets')
        .insert({
          name, species,
          location:             `SRID=4326;POINT(${c.lng} ${c.lat})`,
          thumbnail_url:        uploadedUrl,
          thumbnail_small_url:  uploadedThumbUrl,
        })
        .select('id')
        .single();

      if (error || !pet) throw error ?? new Error('Insert failed');

      const { error: logErr } = await supabase.rpc('log_sighting', {
        p_pet_id:          pet.id,
        p_lat:             c.lat,
        p_lng:             c.lng,
        p_photo_url:       uploadedUrl,
        p_photo_thumb_url: uploadedThumbUrl,
        p_note:            note.trim() || null,
      });
      if (logErr) throw new Error(logErr.message);

      celebrate('Added to the map', () => nav.navigate('PetDetail', { petId: pet.id }));
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  const styles = React.useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 14,
    },
    viewfinder: {
      flex: 1, backgroundColor: colors.elevated, overflow: 'hidden' as const,
      marginHorizontal: 12, borderRadius: 28, borderWidth: 1, borderColor: colors.border,
    },
    placeholderLogo: { width: 72, height: 72, opacity: 0.9 },
    viewfinderPlaceholder: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
    uploadOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center' as const, justifyContent: 'center' as const,
    },
    controls: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 32, paddingTop: 24,
    },
    controlBtn: {
      width: 64, alignItems: 'center' as const, paddingVertical: 10, borderRadius: 16,
      backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border,
    },
    shutter: {
      width: 78, height: 78, borderRadius: 39,
      borderWidth: 3, borderColor: colors.accent,
      alignItems: 'center' as const, justifyContent: 'center' as const,
    },
    shutterInner: {
      width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.45, shadowRadius: 12, elevation: 6,
    },
    matchPanel: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: 12,
      paddingHorizontal: 20, paddingTop: 20,
    },
    skeletons: { gap: 18, paddingVertical: 8 },
    matchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    matchAvatar:  { width: 42, height: 42, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const },
    matchInitial: { fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.onAccent },
    matchChip: {
      paddingHorizontal: 10, paddingVertical: 5,
      backgroundColor: colors.accentFaint, borderRadius: 20,
      borderWidth: 1, borderColor: colors.accentBorder,
      maxWidth: 120, flexShrink: 0 as any,
    },
    newPetRow: {
      marginTop: 16, paddingVertical: 14, paddingHorizontal: 16,
      backgroundColor: colors.elevated, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
      borderStyle: 'dashed' as const,
    },
    newPetPanel: { flex: 1, paddingHorizontal: 20, paddingTop: 32, backgroundColor: colors.surface },
    speciesRow:  { flexDirection: 'row', gap: 10 },
    speciesChip: { paddingVertical: 14, borderRadius: 16 },
    noteInput: {
      backgroundColor: colors.elevated, borderRadius: 10,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
      color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14,
    },
    nameInput: {
      backgroundColor: colors.elevated, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8,
      color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 16,
    },
    btnAccent: {
      paddingVertical: 16, borderRadius: 16, backgroundColor: colors.accent,
      alignItems: 'center' as const,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
    },
  }), [colors]);

  const showPanel = screen === 'uploading' || screen === 'candidates';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[t.body, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={[t.bodyMed, { color: colors.textPrimary }]}>
          {screen === 'new-pet' ? `New ${noun.toLowerCase()}` : 'Log a sighting'}
        </Text>
        <View style={{ width: 52 }} />
      </View>

      {/* Viewfinder */}
      {screen !== 'new-pet' && (
        <View style={styles.viewfinder}>
          {capturedUri ? (
            <>
              <Animated.View key={capturedUri} entering={photoSettle} style={StyleSheet.absoluteFill}>
                <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              </Animated.View>
              <ShutterFlash key={`flash-${capturedUri}`} />
            </>
          ) : (
            <Animated.View entering={FadeIn.duration(260)} style={styles.viewfinderPlaceholder}>
              <RNImage source={require('../../assets/logo-mark.png')} style={styles.placeholderLogo} />
              <Text style={[t.body, { color: colors.textMuted, marginTop: 12 }]}>Photograph the stray</Text>
            </Animated.View>
          )}
          {screen === 'uploading' && (
            <Animated.View entering={FadeIn.delay(200).duration(220)} style={styles.uploadOverlay}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={[t.caption, { color: 'rgba(255,255,255,0.8)', marginTop: 8 }]}>Uploading…</Text>
            </Animated.View>
          )}
        </View>
      )}

      {/* Capture controls */}
      {screen === 'capture' && (
        <Animated.View entering={FadeIn.duration(220)} style={[styles.controls, { paddingBottom: insets.bottom + 24 }]}>
          <PressableScale style={styles.controlBtn} onPress={handleLibrary}>
            <Text style={[t.caption, { color: colors.textSecondary }]}>Library</Text>
          </PressableScale>
          <PressableScale style={styles.shutter} onPress={handleCapture} haptic scaleTo={0.9}>
            <View style={styles.shutterInner} />
          </PressableScale>
          <View style={{ width: 64 }} />
        </Animated.View>
      )}

      {/* Candidates. The panel rises in while the photo uploads, holding skeleton
          rows, so the matches land in a panel that is already there. */}
      {showPanel && (
        <Animated.View
          entering={SlideInDown.springify().damping(20).stiffness(170)}
          style={[styles.matchPanel, { paddingBottom: insets.bottom + 16 }]}
        >
          {screen === 'uploading' ? (
            <>
              <Text style={[t.label, { color: colors.textMuted, marginBottom: 14 }]}>Looking for pets nearby…</Text>
              <View style={styles.skeletons}>
                <SkeletonRow avatar={42} />
                <SkeletonRow avatar={42} />
                <SkeletonRow avatar={42} />
              </View>
            </>
          ) : (
            <Animated.View entering={FadeIn.duration(200)}>
              <Text style={[t.label, { color: colors.textMuted, marginBottom: 14 }]}>
                {candidates.length > 0 ? 'Nearest pets first' : 'No known pets in range'}
              </Text>
              <TextInput
                style={styles.noteInput}
                placeholder="Add a note (optional) — e.g. limping, new collar"
                placeholderTextColor={colors.textMuted}
                value={note}
                onChangeText={setNote}
                maxLength={200}
              />
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 240 }}>
                {candidates.map((c, i) => (
                  <Animated.View key={c.id} entering={staggerIn(i, 80)}>
                    <TouchableOpacity style={styles.matchRow} onPress={() => confirmMatch(c.id)} disabled={saving}>
                      <View style={[styles.matchAvatar, { backgroundColor: c.color }]}>
                        <Text style={styles.matchInitial}>{c.initial}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[t.bodyMed, { color: colors.textPrimary }]}>{c.name}</Text>
                        <Text style={[t.caption, { color: colors.textSecondary }]}>
                          {fmtDist(c.distanceMeters)} away · {c.sightingCount} sightings
                        </Text>
                      </View>
                      <View style={styles.matchChip}>
                        <Text style={[t.caption, { color: colors.accent }]} numberOfLines={1}>It's {c.name}</Text>
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                ))}
              </ScrollView>
              <Animated.View entering={staggerIn(candidates.length, 80)}>
                <PressableScale style={styles.newPetRow} onPress={handleNewPet} scaleTo={0.98}>
                  <Text style={[t.bodyMed, { color: colors.textPrimary }]}>+ New pet</Text>
                  <Text style={[t.caption, { color: colors.textMuted, marginTop: 2 }]}>
                    Not in the list? Create a new entry.
                  </Text>
                </PressableScale>
              </Animated.View>
              <TouchableOpacity onPress={() => { setCapturedUri(null); setScreen('capture'); }} style={{ alignItems: 'center', marginTop: 10 }}>
                <Text style={[t.caption, { color: colors.textMuted }]}>Retake photo</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </Animated.View>
      )}

      {/* New pet entry */}
      {screen === 'new-pet' && (
        <Animated.View
          entering={FadeInRight.springify().damping(20)}
          style={[styles.newPetPanel, { paddingBottom: insets.bottom + 24 }]}
        >
          <Text style={[t.label, { color: colors.textMuted, marginBottom: 10 }]}>What is it?</Text>
          <View style={styles.speciesRow}>
            {SPECIES.map(sp => (
              <ToggleChip
                key={sp.value}
                on={species === sp.value}
                label={sp.label}
                onPress={() => setSpecies(sp.value)}
                leading={<Text style={{ fontSize: 18 }}>{sp.glyph}</Text>}
                style={{ flex: 1 }}
                chipStyle={styles.speciesChip}
                textStyle={t.bodyMed}
              />
            ))}
          </View>

          <Text style={[t.label, { color: colors.textMuted, marginTop: 22, marginBottom: 4 }]}>
            Name this {noun.toLowerCase()}
          </Text>
          <Text style={[t.caption, { color: colors.textMuted, marginBottom: 14 }]}>
            Optional — location will be used if left blank
          </Text>
          <TextInput
            style={styles.nameInput}
            placeholder={species === 'dog' ? 'e.g. Bruno' : 'e.g. Miso'}
            placeholderTextColor={colors.textMuted}
            value={newPetName}
            onChangeText={setNewPetName}
            returnKeyType="done"
          />
          {!newPetName.trim() ? (
            <Text style={[t.caption, { color: colors.textSecondary, marginTop: -8, marginBottom: 16 }]}>
              Will be added as "{fallbackName}"
            </Text>
          ) : null}
          <PressableScale
            style={[styles.btnAccent, { opacity: !saving ? 1 : 0.5 }]}
            onPress={createNewPet}
            disabled={saving}
            haptic
          >
            {saving
              ? <ActivityIndicator color={colors.onAccent} />
              : <Text style={[t.bodyMed, { color: colors.onAccent }]}>Add to map</Text>}
          </PressableScale>
          <TouchableOpacity onPress={() => setScreen('candidates')} style={{ alignItems: 'center', marginTop: 12 }}>
            <Text style={[t.caption, { color: colors.textMuted }]}>Back</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {!!done && <SuccessOverlay label={done} />}
    </View>
  );
}
