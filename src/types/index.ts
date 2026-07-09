export type Species = 'cat' | 'dog';

export type PetStatus = 'stray' | 'adoptable' | 'adopted';

// Matches the `pets` table row, with the PostGIS geography
// column decoded to flat lat/lng by our RPC functions.
export interface Pet {
  id: string;
  name: string;
  species: Species;
  description?: string;
  latitude: number;
  longitude: number;
  firstSeenAt: string;   // ISO 8601
  lastSeenAt: string;    // ISO 8601
  sightingCount: number;
  thumbnailUrl: string | null;       // 1080 px — hero / detail view
  thumbnailSmallUrl: string | null;  // 300 px  — map pins / list rows
  // Adoption status is set only via the Supabase dashboard (owner/shelters).
  status: PetStatus;
  adoptionContact: string | null;    // email or E.164 phone, publicly visible
  // UI-only: deterministic avatar colour derived from the pet ID.
  // Replaced by thumbnailUrl once the pet has a real photo.
  color: string;
  initial: string;
}

export interface Sighting {
  id: string;
  petId: string;
  userId: string | null;
  latitude: number;
  longitude: number;
  timestamp: string;     // ISO 8601
  photoUri?: string;
  note?: string;
}

// Result shape from the match_pets() RPC (Phase 5 — embedding search)
export interface PetMatch {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  similarity: number;
  distanceMeters: number;
}
