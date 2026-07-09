import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Pet, Sighting } from '../types';

// ─── Avatar colours ───────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#C9883A', '#5C6FA0', '#B85C3A', '#3A3C50', '#9E7E48', '#8FA889', '#C4728A'];
function idColor(id: string): string {
  const hash = id.split('').reduce((n, c) => n + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

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
    color: idColor(row.id),
    initial: row.name.charAt(0).toUpperCase(),
  };
}

// ─── Query key factories ──────────────────────────────────────────────────────

export const petKeys = {
  nearby: (lat: number, lng: number, radius: number) =>
    ['pets', 'nearby', lat, lng, radius] as const,
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
    .order('last_seen_at', { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as PetGeoRow[]).map(toPet);
}

export async function fetchNearbyPets(lat: number, lng: number, radiusMeters: number): Promise<Pet[]> {
  const { data, error } = await supabase
    .rpc('nearby_pets', { lat, lng, radius_meters: radiusMeters });

  if (error) throw new Error(error.message);
  return ((data ?? []) as PetGeoRow[]).map(toPet);
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

export function useNearbyPets(lat: number | null, lng: number | null, radiusMeters = 500) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: lat != null && lng != null ? petKeys.nearby(lat, lng, radiusMeters) : ['pets', 'nearby', 'disabled'],
    queryFn: () => fetchNearbyPets(lat!, lng!, radiusMeters),
    enabled: lat != null && lng != null,
  });

  useFocusEffect(
    useCallback(() => {
      if (lat != null && lng != null) {
        qc.invalidateQueries({ queryKey: petKeys.nearby(lat, lng, radiusMeters) });
      }
    }, [lat, lng, radiusMeters, qc]),
  );

  return {
    pets: query.data ?? [],
    loading: query.isPending,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

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
  const rounded = bounds ? roundBounds(bounds) : null;

  const query = useQuery({
    queryKey: rounded ? petKeys.inBounds(...rounded) : ['pets', 'bounds', 'disabled'],
    queryFn: () => fetchPetsInBounds(...rounded!),
    enabled: rounded !== null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  useFocusEffect(
    useCallback(() => {
      if (rounded) {
        qc.invalidateQueries({ queryKey: ['pets', 'bounds'] });
      }
    }, [rounded?.[0], rounded?.[1], rounded?.[2], rounded?.[3], qc]),
  );

  return {
    pets: query.data ?? [],
    loading: query.isPending,
    error: query.error?.message ?? null,
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
  return useQuery({
    queryKey: petKeys.sightings(petId),
    queryFn: () => fetchSightings(petId, limit),
    enabled: !!petId,
  });
}
