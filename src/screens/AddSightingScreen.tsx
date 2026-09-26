import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Keyboard, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn } from 'react-native-reanimated';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { type as t } from '../constants/typography';
import { DARK_MAP_STYLE, LIGHT_MAP_STYLE } from '../constants/mapStyle';
import { supabase } from '../lib/supabase';
import { uploadPhoto } from '../lib/storage';
import { extractExifLocation } from '../lib/exif';
import { petKeys } from '../hooks/usePets';
import { RootStackParamList } from '../navigation/RootNavigator';
import { PressableScale, SuccessOverlay, photoSettle, hapticSuccess, SUCCESS_HOLD_MS } from '../components/motion';

type Route = RouteProp<RootStackParamList, 'AddSighting'>;

export function AddSightingScreen() {
  const nav    = useNavigation();
  const route  = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const qc     = useQueryClient();
  const { petId, defaultLat, defaultLng } = route.params;

  const { colors, isDark } = useTheme();

  const mapRef = useRef<MapView>(null);
  const [photoUri, setPhotoUri]       = useState<string | null>(null);
  const [pin, setPin]                 = useState({ lat: defaultLat, lng: defaultLng });
  const [address, setAddress]         = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching]     = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [note, setNote]               = useState('');
  // Confirmation shown for a beat after the save, before going back.
  const [saved, setSaved]             = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        reverseGeocode(defaultLat, defaultLng);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (!loc) { reverseGeocode(defaultLat, defaultLng); return; }
      const { latitude, longitude } = loc.coords;
      setPin({ lat: latitude, lng: longitude });
      mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 600);
      reverseGeocode(latitude, longitude);
    })();
  }, []);

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const [result] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (!result) return;
      const parts = [result.name, result.street, result.city, result.region].filter(Boolean);
      setAddress(parts.join(', '));
    } catch {}
  }

  function movePin(lat: number, lng: number) {
    setPin({ lat, lng });
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500);
    reverseGeocode(lat, lng);
  }

  async function applyPhoto(asset: ImagePicker.ImagePickerAsset) {
    setPhotoUri(asset.uri);
    const exifCoords = asset.exif ? extractExifLocation(asset.exif as Record<string, any>) : null;
    if (exifCoords) { movePin(exifCoords.lat, exifCoords.lng); return; }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
    if (loc) movePin(loc.coords.latitude, loc.coords.longitude);
  }

  async function handleSearch() {
    const query = searchQuery.trim();
    if (!query) return;
    Keyboard.dismiss();
    setSearching(true);
    try {
      const results = await Location.geocodeAsync(query);
      if (!results.length) { Alert.alert('Not found', 'Try a more specific address or landmark.'); return; }
      const { latitude, longitude } = results[0];
      setPin({ lat: latitude, lng: longitude });
      setSearchQuery('');
      mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500);
      reverseGeocode(latitude, longitude);
    } catch {
      Alert.alert('Search failed', 'Could not search for that location.');
    } finally {
      setSearching(false);
    }
  }

  function handleMapPress(e: any) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPin({ lat: latitude, lng: longitude });
    reverseGeocode(latitude, longitude);
  }

  function handleMarkerDragEnd(e: any) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPin({ lat: latitude, lng: longitude });
    reverseGeocode(latitude, longitude);
  }

  async function handleUseMyLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Location access required'); return; }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
    if (!loc) return;
    const { latitude, longitude } = loc.coords;
    setPin({ lat: latitude, lng: longitude });
    mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 400);
    reverseGeocode(latitude, longitude);
  }

  function handlePickPhoto() {
    Alert.alert('Add photo', undefined, [
      {
        text: 'Take photo',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Camera access required', 'Enable it in Settings.'); return; }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false, exif: true });
          if (!result.canceled) applyPhoto(result.assets[0]);
        },
      },
      {
        text: 'Choose from library',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Photo access required', 'Enable it in Settings.'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.9, allowsEditing: false, exif: true });
          if (!result.canceled) applyPhoto(result.assets[0]);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleSave() {
    if (!photoUri) return;
    setUploading(true);
    try {
      const upload = await uploadPhoto(photoUri, 'sightings', Date.now().toString());

      // log_sighting takes its identity from auth.uid() as of migration 00006 —
      // passing p_user_id here matched no function and failed the whole flow.
      const { error } = await supabase.rpc('log_sighting', {
        p_pet_id:          petId,
        p_lat:             pin.lat,
        p_lng:             pin.lng,
        p_photo_url:       upload.publicUrl,
        p_photo_thumb_url: upload.thumbPublicUrl,
        p_note:            note.trim() || null,
      });
      if (error) throw new Error(error.message);

      await Promise.all([
        qc.invalidateQueries({ queryKey: petKeys.detail(petId) }),
        qc.invalidateQueries({ queryKey: petKeys.sightings(petId) }),
        qc.invalidateQueries({ queryKey: ['pets', 'bounds'] }),
      ]);

      hapticSuccess();
      setSaved(true);
      savedTimer.current = setTimeout(() => nav.goBack(), SUCCESS_HOLD_MS);
    } catch (err: any) {
      Alert.alert('Failed to save', err.message);
    } finally {
      setUploading(false);
    }
  }

  const canSave = !uploading;

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    photoArea: {
      height: 200, backgroundColor: colors.elevated,
      overflow: 'hidden' as const, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    photoPlaceholder: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
    changeOverlay: {
      position: 'absolute' as const, bottom: 0, left: 0, right: 0,
      backgroundColor: 'rgba(0,0,0,0.45)', paddingVertical: 8, alignItems: 'center' as const,
    },
    changeText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
    noteRow: {
      paddingHorizontal: 14, paddingTop: 10,
      backgroundColor: colors.surface,
    },
    noteInput: {
      minHeight: 40, maxHeight: 88, borderRadius: 10,
      backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12, paddingVertical: 10,
      color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14,
      textAlignVertical: 'top' as const,
    },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    searchInput: {
      flex: 1, height: 40, borderRadius: 10,
      backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14,
    },
    searchBtn: {
      backgroundColor: colors.accent, borderRadius: 12,
      paddingHorizontal: 14, height: 40,
      alignItems: 'center' as const, justifyContent: 'center' as const, minWidth: 64,
    },
    searchBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: colors.onAccent },
    mapContainer: { flex: 1, position: 'relative' as const },
    pinOuter: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: colors.accent, alignItems: 'center' as const, justifyContent: 'center' as const,
      borderWidth: 3, borderColor: '#fff',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 5,
    },
    pinInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onAccent },
    locationFab: {
      position: 'absolute' as const, bottom: 52, right: 14,
      width: 46, height: 46, borderRadius: 23,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      alignItems: 'center' as const, justifyContent: 'center' as const,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
    },
    hint:     { position: 'absolute' as const, bottom: 8, left: 0, right: 0, alignItems: 'center' as const },
    hintText: {
      fontSize: 11,
      color: 'rgba(255,255,255,0.7)',
      backgroundColor: 'rgba(0,0,0,0.48)',
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' as const,
    },
    addressRow: {
      paddingHorizontal: 16, paddingTop: 10,
      backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, minHeight: 40,
    },
  }), [colors, isDark]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()} disabled={uploading} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[t.body, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={[t.bodyMed, { color: colors.textPrimary }]}>Add photo</Text>
        <TouchableOpacity onPress={handleSave} disabled={!canSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          {uploading
            ? <ActivityIndicator size="small" color={colors.accent} />
            : <Text style={[t.bodyMed, { color: canSave ? colors.accent : colors.textMuted }]}>Save</Text>}
        </TouchableOpacity>
      </View>

      {/* Photo picker */}
      <TouchableOpacity style={styles.photoArea} onPress={handlePickPhoto} activeOpacity={0.85}>
        {photoUri ? (
          <>
            <Animated.View key={photoUri} entering={photoSettle} style={StyleSheet.absoluteFill}>
              <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </Animated.View>
            <View style={styles.changeOverlay}>
              <Text style={styles.changeText}>Change photo</Text>
            </View>
          </>
        ) : (
          <Animated.View entering={FadeIn.duration(240)} style={styles.photoPlaceholder}>
            <Text style={{ fontSize: 40 }}>📷</Text>
            <Text style={[t.body, { color: colors.textMuted, marginTop: 10 }]}>Tap to add a photo (optional)</Text>
          </Animated.View>
        )}
      </TouchableOpacity>

      {/* Optional note — what's different about the animal today */}
      <View style={styles.noteRow}>
        <TextInput
          style={styles.noteInput}
          placeholder="Add a note (optional) — e.g. limping, new collar"
          placeholderTextColor={colors.textMuted}
          value={note}
          onChangeText={setNote}
          maxLength={200}
          multiline
        />
      </View>

      {/* Location search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search location…"
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        <PressableScale style={styles.searchBtn} onPress={handleSearch} disabled={searching} scaleTo={0.93}>
          {searching
            ? <ActivityIndicator size="small" color={colors.onAccent} />
            : <Text style={styles.searchBtnText}>Search</Text>}
        </PressableScale>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          customMapStyle={Platform.OS === 'android' ? (isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE) : undefined}
          userInterfaceStyle={isDark ? 'dark' : 'light'}
          initialRegion={{ latitude: defaultLat, longitude: defaultLng, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
          onPress={handleMapPress}
          showsUserLocation
          showsCompass={false}
          showsPointsOfInterest={false}
        >
          <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} draggable onDragEnd={handleMarkerDragEnd}>
            <View style={styles.pinOuter}>
              <View style={styles.pinInner} />
            </View>
          </Marker>
        </MapView>

        <PressableScale style={styles.locationFab} onPress={handleUseMyLocation} scaleTo={0.88}>
          <Text style={{ fontSize: 18 }}>📍</Text>
        </PressableScale>

        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>Tap map or drag pin to set location</Text>
        </View>
      </View>

      {/* Address label */}
      <View style={[styles.addressRow, { paddingBottom: insets.bottom + 10 }]}>
        {address ? (
          <Text style={[t.caption, { color: colors.textSecondary }]} numberOfLines={1}>📍 {address}</Text>
        ) : (
          <Text style={[t.caption, { color: colors.textMuted }]}>Determining location…</Text>
        )}
      </View>

      {saved && <SuccessOverlay label="Photo added" />}
    </View>
  );
}
