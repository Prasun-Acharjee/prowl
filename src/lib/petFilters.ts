import { Pet } from '../types';

export interface PetFilters {
  adoptable: boolean;
  mine: boolean;
}

export const NO_FILTERS: PetFilters = { adoptable: false, mine: false };

/**
 * Narrows the cats shown on the map and in the list.
 *
 * Filters are AND-ed: both chips on means adoptable cats you added. `mine` with
 * no signed-in user matches nothing rather than everything — a filter that
 * silently does nothing is worse than one that visibly returns empty.
 */
export function applyFilters(pets: Pet[], filters: PetFilters, uid: string | null): Pet[] {
  if (!filters.adoptable && !filters.mine) return pets;
  return pets.filter(p => {
    if (filters.adoptable && p.status !== 'adoptable') return false;
    if (filters.mine && (!uid || p.createdBy !== uid)) return false;
    return true;
  });
}
