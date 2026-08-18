/**
 * Distance maths and map-app URLs.
 *
 * Deliberately free of react-native imports so it stays runnable under plain
 * node for geo.test.ts — anything platform-specific is passed in as an argument
 * rather than read from `Platform`.
 */

export interface Coords {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in metres. Haversine rather than an equirectangular
 * approximation: the cost is a few trig calls on a list of at most 500 pets,
 * and it stays correct at any latitude, which the cheap version does not.
 */
export function distanceMeters(a: Coords, b: Coords): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Human-readable distance. Precision drops as the number grows because nobody
 * walking to a cat cares about the last 4 metres of a 12 km trip, and a
 * "1,340 m away" label reads as noise where "1.3 km" reads as a decision.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  // Round first, then pick the unit: 999 m rounds to 1000, which should read
  // "1.0 km" rather than a four-digit metre count.
  const rounded = Math.round(meters / 10) * 10;
  if (rounded < 1000) return `${Math.max(rounded, 10)} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * Nearest first. Returns a new array — the caller's list is React Query cache
 * data and must not be reordered in place. With no origin the input is handed
 * back untouched (and by reference, so an unsorted render does no work).
 */
export function sortByDistance<T extends Coords>(items: T[], origin: Coords | null): T[] {
  if (!origin) return items;
  return [...items].sort(
    (a, b) => distanceMeters(origin, a) - distanceMeters(origin, b),
  );
}

/**
 * A directions link for the platform's own maps app.
 *
 * Apple Maps on iOS, `geo:` on Android — the OS default in both cases, so the
 * user lands in whatever they already use rather than whatever we picked. The
 * Android form repeats the coordinates inside `q=` because the leading pair
 * only centres the map; the pin and its label come from the query.
 */
export function directionsUrl(
  lat: number, lng: number, label: string, platform: 'ios' | 'android',
): string {
  if (platform === 'ios') {
    return `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`;
  }
  return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
}

/**
 * A plain https maps link, for text that leaves the app. Prowl has no web
 * presence to link a cat to, so a shared sighting points at the spot on a map —
 * that opens for whoever receives it, on any device, with no app installed.
 */
export function mapsSearchUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
