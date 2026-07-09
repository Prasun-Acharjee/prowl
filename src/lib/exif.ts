function dmsToDecimal([d, m, s]: number[]): number {
  return d + m / 60 + s / 3600;
}

export function extractExifLocation(
  exif: Record<string, any>,
): { lat: number; lng: number } | null {
  console.log('[EXIF] raw dump:', JSON.stringify(exif, null, 2));

  // Android: top-level decimal values
  if (typeof exif.GPSLatitude === 'number' && typeof exif.GPSLongitude === 'number') {
    console.log('[EXIF] matched Android decimal');
    const lat = exif.GPSLatitudeRef === 'S' ? -Math.abs(exif.GPSLatitude) : Math.abs(exif.GPSLatitude);
    const lng = exif.GPSLongitudeRef === 'W' ? -Math.abs(exif.GPSLongitude) : Math.abs(exif.GPSLongitude);
    if (lat !== 0 || lng !== 0) return { lat, lng };
  }

  // Android: DMS array [deg, min, sec]
  if (Array.isArray(exif.GPSLatitude) && Array.isArray(exif.GPSLongitude)) {
    console.log('[EXIF] matched Android DMS array');
    const lat = dmsToDecimal(exif.GPSLatitude) * (exif.GPSLatitudeRef === 'S' ? -1 : 1);
    const lng = dmsToDecimal(exif.GPSLongitude) * (exif.GPSLongitudeRef === 'W' ? -1 : 1);
    if (lat !== 0 || lng !== 0) return { lat, lng };
  }

  // iOS: nested {GPS} dictionary
  const gps = exif['{GPS}'];
  console.log('[EXIF] {GPS} block:', gps);
  if (gps && typeof gps.Latitude === 'number' && typeof gps.Longitude === 'number') {
    console.log('[EXIF] matched iOS {GPS}');
    const lat = gps.LatitudeRef === 'S' ? -Math.abs(gps.Latitude) : Math.abs(gps.Latitude);
    const lng = gps.LongitudeRef === 'W' ? -Math.abs(gps.Longitude) : Math.abs(gps.Longitude);
    if (lat !== 0 || lng !== 0) return { lat, lng };
  }

  console.log('[EXIF] no GPS coords found in metadata');
  return null;
}
