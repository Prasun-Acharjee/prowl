import * as Location from 'expo-location';
import { supabase } from './supabase';

/**
 * Log "I'm looking at this cat right now" at the device's current position.
 *
 * Two screens offer this one-tap path — the map's pin sheet and the profile's
 * sticky CTA — and both need the same permission prompt, the same fix, and the
 * same failure text, so it lives here rather than being written twice.
 *
 * Photo-carrying sightings do NOT come through here: Camera and AddSighting
 * have a location of their own (EXIF or a dragged pin) that is more accurate
 * than wherever the phone happens to be at submit time.
 *
 * Throws with a message fit to show the user; callers surface it in an Alert.
 */
export async function logSightingHere(petId: string, note?: string): Promise<void> {
  // Sequential, not Promise.all: reading the position before the permission
  // prompt resolves throws on a fresh install.
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    // Previously a silent return, which looked to the user like a button that
    // simply did nothing.
    throw new Error('Location permission is needed to log where you saw this cat.');
  }

  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

  const { error } = await supabase.rpc('log_sighting', {
    p_pet_id: petId,
    p_lat:    loc.coords.latitude,
    p_lng:    loc.coords.longitude,
    p_note:   note?.trim() || null,
  });
  if (error) throw new Error(error.message);
}
