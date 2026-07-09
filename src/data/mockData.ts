import { Pet, Sighting } from '../types';

// Clustered around Midtown Manhattan for a realistic urban density.
// lastSeenAt values are relative to mock "now" = 2026-07-03T12:00:00Z to
// demonstrate all three pin states: amber (<24h), rose (<7d), muted (older).
export const mockPets: Pet[] = [
  {
    id: 'pet_001',
    name: 'Miso',
    species: 'cat',
    color: '#C9883A',
    initial: 'M',
    latitude: 40.7580,
    longitude: -73.9855,
    firstSeenAt: '2025-03-15T10:00:00Z',
    lastSeenAt: '2026-07-03T06:30:00Z', // 5.5h ago → amber + pulse
    sightingCount: 47,
    thumbnailUrl: null,
    thumbnailSmallUrl: null,
    status: 'stray',
    adoptionContact: null,
    description:
      'Orange tabby with a white chin patch. Extremely sociable — will follow anyone carrying a coffee cup. Usually stationed near the south plaza entrance.',
  },
  {
    id: 'pet_002',
    name: 'Luna',
    species: 'cat',
    color: '#5C6FA0',
    initial: 'L',
    latitude: 40.7614,
    longitude: -73.9776,
    firstSeenAt: '2025-11-02T14:00:00Z',
    lastSeenAt: '2026-06-30T14:00:00Z', // 3 days ago → rose
    sightingCount: 12,
    thumbnailUrl: null,
    thumbnailSmallUrl: null,
    status: 'stray',
    adoptionContact: null,
    description:
      'Grey and white, cautious but curious. Appears at dusk near the parking structure. Never takes food from hands, but will eat if you leave the dish and step back.',
  },
  {
    id: 'pet_003',
    name: 'Ginger',
    species: 'cat',
    color: '#B85C3A',
    initial: 'G',
    latitude: 40.7549,
    longitude: -73.9840,
    firstSeenAt: '2024-08-20T09:00:00Z',
    lastSeenAt: '2026-07-03T11:00:00Z', // 1h ago → amber + pulse
    sightingCount: 103,
    thumbnailUrl: null,
    thumbnailSmallUrl: null,
    status: 'stray',
    adoptionContact: null,
    description:
      'Deep orange, stocky build — the undisputed elder of the block. Notched left ear from an old TNR procedure. Ignores strangers, tolerates regulars.',
  },
  {
    id: 'pet_004',
    name: 'Shadow',
    species: 'cat',
    color: '#3A3C50',
    initial: 'S',
    latitude: 40.7527,
    longitude: -73.9772,
    firstSeenAt: '2024-01-08T07:00:00Z',
    lastSeenAt: '2026-06-10T09:00:00Z', // 23 days ago → muted
    sightingCount: 8,
    thumbnailUrl: null,
    thumbnailSmallUrl: null,
    status: 'stray',
    adoptionContact: null,
    description:
      'All black, very elusive. Rarely spotted twice in the same location. Best logged from a distance.',
  },
  {
    id: 'pet_005',
    name: 'Biscuit',
    species: 'cat',
    color: '#9E7E48',
    initial: 'B',
    latitude: 40.7631,
    longitude: -73.9929,
    firstSeenAt: '2025-06-01T12:00:00Z',
    lastSeenAt: '2026-07-02T18:45:00Z', // 17h ago → amber + pulse
    sightingCount: 29,
    thumbnailUrl: null,
    thumbnailSmallUrl: null,
    status: 'stray',
    adoptionContact: null,
    description:
      'Cream and tan, perpetually looks faintly alarmed. Frequents the deli loading dock around mealtimes.',
  },
];

export const mockSightings: Sighting[] = [
  {
    id: 'sight_001',
    petId: 'pet_001',
    userId: 'anon_user',
    latitude: 40.7580,
    longitude: -73.9855,
    timestamp: '2026-07-03T06:30:00Z',
  },
  {
    id: 'sight_002',
    petId: 'pet_001',
    userId: 'anon_user',
    latitude: 40.7582,
    longitude: -73.9857,
    timestamp: '2026-06-28T14:00:00Z',
  },
  {
    id: 'sight_003',
    petId: 'pet_003',
    userId: 'anon_user',
    latitude: 40.7549,
    longitude: -73.9840,
    timestamp: '2026-07-03T11:00:00Z',
  },
  {
    id: 'sight_004',
    petId: 'pet_003',
    userId: 'anon_user',
    latitude: 40.7547,
    longitude: -73.9838,
    timestamp: '2026-06-29T09:15:00Z',
  },
  {
    id: 'sight_005',
    petId: 'pet_005',
    userId: 'anon_user',
    latitude: 40.7631,
    longitude: -73.9929,
    timestamp: '2026-07-02T18:45:00Z',
  },
];
