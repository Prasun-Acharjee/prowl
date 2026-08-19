// Self-check for the map/list filters. No framework — run it with:
//   npx tsx src/lib/petFilters.test.ts
import assert from 'node:assert/strict';
import { applyFilters, toggleSpecies, NO_FILTERS } from './petFilters';
import { Pet } from '../types';

const ME = 'user-me';
const THEM = 'user-them';

const cat = (
  id: string, status: Pet['status'], createdBy: string | null, species: Pet['species'] = 'cat',
): Pet => ({
  id, status, createdBy, species,
  name: id, latitude: 0, longitude: 0,
  firstSeenAt: '', lastSeenAt: '', sightingCount: 1,
  thumbnailUrl: null, thumbnailSmallUrl: null, adoptionContact: null,
  color: '#000', initial: id[0].toUpperCase(),
});

const mineAdoptable  = cat('a', 'adoptable', ME);
const mineStray      = cat('b', 'stray', ME);
const theirsAdoptable = cat('c', 'adoptable', THEM);
const orphan         = cat('d', 'stray', null);
const myDog          = cat('e', 'adoptable', ME, 'dog');
const all = [mineAdoptable, mineStray, theirsAdoptable, orphan, myDog];

const ids = (ps: Pet[]) => ps.map(p => p.id);

// No filters is a pass-through, and returns the same array reference so the
// common case does no work.
assert.equal(applyFilters(all, NO_FILTERS, ME), all);

const f = (over: Partial<typeof NO_FILTERS>) => ({ ...NO_FILTERS, ...over });

// Each chip alone.
assert.deepEqual(ids(applyFilters(all, f({ adoptable: true }), ME)), ['a', 'c', 'e']);
assert.deepEqual(ids(applyFilters(all, f({ mine: true }), ME)), ['a', 'b', 'e']);
assert.deepEqual(ids(applyFilters(all, f({ species: ['dog'] }), ME)), ['e']);
assert.deepEqual(ids(applyFilters(all, f({ species: ['cat'] }), ME)), ['a', 'b', 'c', 'd']);

// Chips AND together, not OR...
assert.deepEqual(ids(applyFilters(all, f({ adoptable: true, mine: true }), ME)), ['a', 'e']);
assert.deepEqual(ids(applyFilters(all, f({ adoptable: true, species: ['dog'] }), ME)), ['e']);

// ...but species OR among themselves: both selected is the same set as neither.
assert.deepEqual(
  ids(applyFilters(all, f({ species: ['cat', 'dog'] }), ME)),
  ids(applyFilters(all, NO_FILTERS, ME)),
);

// "Mine" with no signed-in user matches nothing, rather than silently everything.
assert.deepEqual(ids(applyFilters(all, f({ mine: true }), null)), []);

// Pets predating migration 00006 have no creator and are nobody's.
assert.ok(!ids(applyFilters(all, f({ mine: true }), ME)).includes('d'));

// ─── toggleSpecies ────────────────────────────────────────────────────────────

// On, then off again, returns to the resting state — so "every chip off" and
// "never touched" cannot end up meaning different things.
const oneOn = toggleSpecies(NO_FILTERS, 'dog');
assert.deepEqual(oneOn.species, ['dog']);
assert.deepEqual(toggleSpecies(oneOn, 'dog').species, []);

// Toggling one species leaves the other, and the unrelated chips, alone.
const both = toggleSpecies(toggleSpecies(f({ adoptable: true }), 'dog'), 'cat');
assert.deepEqual(both.species, ['dog', 'cat']);
assert.equal(both.adoptable, true);
assert.deepEqual(toggleSpecies(both, 'dog').species, ['cat']);

// Toggling never mutates the filters it is given.
assert.deepEqual(NO_FILTERS.species, []);

// Filtering never mutates the input.
assert.equal(all.length, 5);

console.log('petFilters: all assertions passed');
