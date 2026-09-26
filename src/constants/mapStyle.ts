// Google map styles tuned to the Coral Dusk palette.
// Only applied when using PROVIDER_GOOGLE (Android, or iOS with API key); Apple
// Maps has no style API and follows `userInterfaceStyle` instead.
//
// Roads and labels are kept quiet on purpose: the map is the ground the pins
// stand on, and coral/violet pins must stay the loudest thing on it.

export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1A1225' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#B4A6BF' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1A1225' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#3A2D4A' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#B4A6BF' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1C2A2A' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2C2139' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#241A30' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6C5E7A' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3A2D4A' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2A1F38' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#B4A6BF' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2A1F38' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#6C5E7A' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#111833' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3A2D4A' }] },
];

export const LIGHT_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#F0E9F2' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6A5A78' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F7F2F7' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#E6DCE8' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#DDEEE5' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E6DCE8' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#A395AE' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#FBE4E1' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#F3CFCA' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#E6DCE8' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D8DDF5' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#8E86B8' }] },
];
