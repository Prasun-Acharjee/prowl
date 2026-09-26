import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useHiddenContent } from './useModeration';
import { Pet, Sighting } from '../types';
import { avatarColor } from '../constants/colors';

// ─── Row shapes ───────────────────────────────────────────────────────────────

interface PetGeoRow {
  id: string;
  name: string;
  species: string;
  description: string | null;
  latitude: number;
  longitude: number;
  first_seen_at: string;
  last_seen_at: string;
  sighting_count: number;
  thumbnail_url: string | null;
  thumbnail_small_url: string | null;
  status: string;
  adoption_contact: string | null;
  created_by: string | null;
}

function toPet(row: PetGeoRow): Pet {
  return {
    id: row.id,
    name: row.name,
    species: row.species as Pet['species'],
    description: row.description ?? undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    sightingCount: row.sighting_count,
    thumbnailUrl: row.thumbnail_url,
    thumbnailSmallUrl: row.thumbnail_small_url,
    // Fallback tolerates a client built before migration 00004 has run.
    status: (row.status as Pet['status']) ?? 'stray',
    adoptionContact: row.adoption_contact ?? null,
    createdBy: row.created_by ?? null,
    color: avatarColor(row.id),
    initial: row.name.charAt(0).toUpperCase(),
  };
}

// ─── Query key factories ──────────────────────────────────────────────────────

export const petKeys = {
  inBounds: (west: number, south: number, east: number, north: number) =>
    ['pets', 'bounds', west, south, east, north] as const,
  detail: (id: string) => ['pets', 'detail', id] as const,
  sightings: (petId: string) => ['pets', 'sightings', petId] as const,
};

// ─── Fetchers ─────────────────────────────────────────────────────────────────

export async function fetchPetsInBounds(
  west: number, south: number, east: number, north: number,
): Promise<Pet[]> {
  const { data, error } = await supabase
    .from('pets_geo')
    .select('*')
    .gte('longitude', west)
    .lte('longitude', east)
    .gte('latitude', south)
    .lte('latitude', north)
    .order('last_seen_at', { ascending: false })
    // Without a cap, a zoomed-all-the-way-out viewport pulls every row in the table.
    .limit(500);

  if (error) throw new Error(error.message);
  return ((data ?? []) as PetGeoRow[]).map(toPet);
}

/**
 * Name search across the whole table, not just the viewport — the point is to
 * find a cat you cannot currently see. Escapes LIKE wildcards so a name
 * containing % or _ is searched literally.
 */
export async function searchPetsByName(query: string): Promise<Pet[]> {
  const q = query.trim().replace(/[%_\\]/g, m => `\\${m}`);
  if (!q) return [];

  const { data, error } = await supabase
    .from('pets_geo')
    .select('*')
    .ilike('name', `%${q}%`)
    .order('last_seen_at', { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  return ((data ?? []) as PetGeoRow[]).map(toPet);
}

export function usePetSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['pets', 'search', trimmed],
    queryFn: () => searchPetsByName(trimmed),
    // Two characters minimum: single letters match most of the table and would
    // fire a query on every keystroke for no useful result.
    enabled: trimmed.length >= 2,
    staleTime: 60_000,
  });
}

export async function fetchPet(id: string): Promise<Pet | null> {
  const { data, error } = await supabase
    .from('pets_geo')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return toPet(data as PetGeoRow);
}

export async function fetchSightings(petId: string, limit = 10): Promise<Sighting[]> {
  const { data, error } = await supabase
    .from('sightings_geo')
    .select('*')
    .eq('pet_id', petId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as any[]).map(row => ({
    id: row.id,
    petId: row.pet_id,
    userId: row.user_id,
    latitude: row.latitude,
    longitude: row.longitude,
    timestamp: row.created_at,
    photoUri: row.photo_url ?? undefined,
    note: row.note ?? undefined,
  }));
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

type Bounds = [west: number, south: number, east: number, north: number];

function roundBounds(b: Bounds): Bounds {
  // Expand by the rounding granularity (0.001°) before snapping so that at high
  // zoom the west/east (or south/north) values never round to the same number,
  // which would make the Supabase query return zero rows.
  const EXPAND = 0.001;
  return [
    Math.round((b[0] - EXPAND) * 1000) / 1000,
    Math.round((b[1] - EXPAND) * 1000) / 1000,
    Math.round((b[2] + EXPAND) * 1000) / 1000,
    Math.round((b[3] + EXPAND) * 1000) / 1000,
  ];
}

export function usePetsInViewport(bounds: Bounds | null) {
  const qc = useQueryClient();
  const hidden = useHiddenContent();
  const rounded = bounds ? roundBounds(bounds) : null;

  const query = useQuery({
    queryKey: rounded ? petKeys.inBounds(...rounded) : ['pets', 'bounds', 'disabled'],
    queryFn: () => fetchPetsInBounds(...rounded!),
    enabled: rounded !== null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  // Refresh when the user returns to the map — e.g. after logging a sighting.
  // Deliberately keyed on nothing but qc: keying it on the bounds re-fired the
  // effect on every pan, invalidating the whole cache and defeating staleTime.
  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['pets', 'bounds'] });
    }, [qc]),
  );

  // Reported and blocked content is filtered out here rather than in the query,
  // so it disappears from the map and the list the moment the user acts, with no
  // refetch. See useHiddenContent for why this is client-side.
  const pets = useMemo(
    () => (query.data ?? []).filter(p => !hidden.pets.has(p.id)),
    [query.data, hidden.pets],
  );

  return {
    pets,
    loading: query.isPending,
    error: query.error?.message ?? null,
    // Exposed for pull-to-refresh. `isRefetching` rather than `isFetching` so the
    // spinner does not appear for the background refetch that fires whenever the
    // user pans the map.
    refetch: query.refetch,
    refreshing: query.isRefetching,
  };
}

export function usePet(id: string) {
  return useQuery({
    queryKey: petKeys.detail(id),
    queryFn: () => fetchPet(id),
    enabled: !!id,
  });
}

export function useSightings(petId: string, limit = 10) {
  const hidden = useHiddenContent();
  const query = useQuery({
    queryKey: petKeys.sightings(petId),
    queryFn: () => fetchSightings(petId, limit),
    enabled: !!petId,
  });

  const data = useMemo(
    () => (query.data ?? []).filter(s => !hidden.sightings.has(s.id)),
    [query.data, hidden.sightings],
  );

  return { ...query, data };
}
