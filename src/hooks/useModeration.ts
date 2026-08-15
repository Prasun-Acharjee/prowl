import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type ReportReason = 'inappropriate' | 'not_a_cat' | 'spam' | 'other';
export type ReportTarget = 'pet' | 'sighting';

export const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: 'inappropriate', label: 'Inappropriate or offensive' },
  { key: 'not_a_cat',     label: 'Not a cat / wrong animal' },
  { key: 'spam',          label: 'Spam or duplicate' },
];

const hiddenKey = ['moderation', 'hidden'] as const;

interface Hidden {
  pets: Set<string>;
  sightings: Set<string>;
}

const EMPTY: Hidden = { pets: new Set(), sightings: new Set() };

/**
 * Ids the current user should not be shown — anything they reported, plus
 * everything posted by anyone they blocked.
 *
 * Filtering happens client-side, which is fine here: pets and sightings are
 * world-readable by design (pets_read is `using (true)`), so hiding is a
 * presentation choice rather than a security boundary. Enforcing it in SQL
 * would mean reshaping the viewport query for no gain.
 */
export function useHiddenContent(): Hidden {
  const { data } = useQuery({
    queryKey: hiddenKey,
    queryFn: async (): Promise<Hidden> => {
      const { data, error } = await supabase.rpc('my_hidden_content').maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as { hidden_pet_ids: string[]; hidden_sighting_ids: string[] } | null;
      return {
        pets: new Set(row?.hidden_pet_ids ?? []),
        sightings: new Set(row?.hidden_sighting_ids ?? []),
      };
    },
    staleTime: 5 * 60_000,
  });

  return data ?? EMPTY;
}

export async function reportContent(
  targetType: ReportTarget,
  targetId: string,
  reason: ReportReason,
): Promise<void> {
  const { error } = await supabase
    .from('reports')
    .insert({ target_type: targetType, target_id: targetId, reason });

  // 23505 = already reported by this user. Re-reporting is a no-op, not an error
  // worth showing — the outcome the user wanted (it's flagged, and hidden from
  // them) is already true.
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.from('user_blocks').insert({ blocked_id: userId });
  if (error && error.code !== '23505') throw new Error(error.message);
}

/** Call after reporting or blocking so hidden content disappears immediately. */
export function useRefreshHidden() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: hiddenKey });
}
