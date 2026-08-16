// Self-check for the map/list filters. No framework — run it with:
//   npx tsx src/lib/petFilters.test.ts
import assert from 'node:assert/strict';
import { applyFilters, NO_FILTERS } from './petFilters';
import { Pet } from '../types';

const ME = 'user-me';
const THEM = 'user-them';

const cat = (id: string, status: Pet['status'], createdBy: string | null): Pet => ({
  id, status, createdBy,
  name: id, species: 'cat', latitude: 0, longitude: 0,
  firstSeenAt: '', lastSeenAt: '', sightingCount: 1,
  thumbnailUrl: null, thumbnailSmallUrl: null, adoptionContact: null,
  color: '#000', initial: id[0].toUpperCase(),
});

const mineAdoptable  = cat('a', 'adoptable', ME);
const mineStray      = cat('b', 'stray', ME);
const theirsAdoptable = cat('c', 'adoptable', THEM);
const orphan         = cat('d', 'stray', null);
const all = [mineAdoptable, mineStray, theirsAdoptable, orphan];

const ids = (ps: Pet[]) => ps.map(p => p.id);

// No filters is a pass-through, and returns the same array reference so the
// common case does no work.
assert.equal(applyFilters(all, NO_FILTERS, ME), all);

// Each chip alone.
assert.deepEqual(ids(applyFilters(all, { adoptable: true, mine: false }, ME)), ['a', 'c']);
assert.deepEqual(ids(applyFilters(all, { adoptable: false, mine: true }, ME)), ['a', 'b']);

// Both chips AND together, not OR.
assert.deepEqual(ids(applyFilters(all, { adoptable: true, mine: true }, ME)), ['a']);

// "Mine" with no signed-in user matches nothing, rather than silently everything.
assert.deepEqual(ids(applyFilters(all, { adoptable: false, mine: true }, null)), []);

// Cats predating migration 00006 have no creator and are nobody's.
assert.ok(!ids(applyFilters(all, { adoptable: false, mine: true }, ME)).includes('d'));

// Filtering never mutates the input.
assert.equal(all.length, 4);

console.log('petFilters: all assertions passed');
