import { Pet, Species } from '../types';

export interface PetFilters {
  adoptable: boolean;
  mine: boolean;
  /**
   * Which species to show. Empty means "no species filter" rather than "show
   * nothing" — that is the resting state, and it is also what you get by
   * toggling every chip back off, so the two cannot disagree.
   */
  species: Species[];
}

export const NO_FILTERS: PetFilters = { adoptable: false, mine: false, species: [] };

/** Toggles one species in or out of the filter, preserving the others. */
export function toggleSpecies(filters: PetFilters, species: Species): PetFilters {
  const on = filters.species.includes(species);
  return {
    ...filters,
    species: on ? filters.species.filter(s => s !== species) : [...filters.species, species],
  };
}

/**
 * Narrows the pets shown on the map and in the list.
 *
 * Filters are AND-ed: adoptable + dog means adoptable dogs. `mine` with no
 * signed-in user matches nothing rather than everything — a filter that
 * silently does nothing is worse than one that visibly returns empty.
 */
export function applyFilters(pets: Pet[], filters: PetFilters, uid: string | null): Pet[] {
  const bySpecies = filters.species.length > 0;
  if (!filters.adoptable && !filters.mine && !bySpecies) return pets;

  return pets.filter(p => {
    if (filters.adoptable && p.status !== 'adoptable') return false;
    if (filters.mine && (!uid || p.createdBy !== uid)) return false;
    if (bySpecies && !filters.species.includes(p.species)) return false;
    return true;
  });
}
