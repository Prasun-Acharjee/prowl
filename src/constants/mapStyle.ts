// Dark map style tuned to the Prowl night-city palette.
// Only applied when using PROVIDER_GOOGLE (Android, or iOS with API key).
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0D0E18' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9B9AAD' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0D0E18' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2A2C3D' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#9B9AAD' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0F1020' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#555670' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1E2030' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2A2C3D' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#555670' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#252840' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1E2030' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#9B9AAD' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1E2030' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#555670' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0A0B14' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#2A2C3D' }] },
];
