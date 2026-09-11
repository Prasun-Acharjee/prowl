// Self-check for the animal-photo verdict. No framework — run it with:
//   npx tsx src/lib/animalCheck.test.ts
import assert from 'node:assert/strict';
import { verdictFor, uncertaintyPrompt, CONFIDENT_AT, Label } from './animalCheck';

const l = (text: string, confidence: number): Label => ({ text, confidence });

// ─── Confident animals pass silently ──────────────────────────────────────────

const cat = verdictFor([l('Cat', 0.94), l('Whiskers', 0.81)]);
assert.equal(cat.decision, 'confident');
assert.equal(cat.species, 'cat');
assert.equal(cat.topLabel, 'Cat');

const dog = verdictFor([l('Dog', 0.88)]);
assert.equal(dog.decision, 'confident');
assert.equal(dog.species, 'dog');

// Young animals count as their species, so the picker still pre-selects.
assert.equal(verdictFor([l('Kitten', 0.9)]).species, 'cat');
assert.equal(verdictFor([l('Puppy', 0.9)]).species, 'dog');

// Matching ignores case and stray whitespace, but reports the label as given.
const spaced = verdictFor([l('  cAt  ', 0.93)]);
assert.equal(spaced.species, 'cat');
assert.equal(spaced.topLabel, 'cAt');

// ─── Species outranks a higher-scoring generic label ──────────────────────────

// "pet" scoring higher than "dog" must not cost us the species pre-selection.
const petDog = verdictFor([l('Pet', 0.91), l('Dog', 0.78)]);
assert.equal(petDog.species, 'dog');
assert.equal(petDog.topLabel, 'Dog');
assert.equal(petDog.decision, 'confident');

// Between two species labels, confidence decides.
assert.equal(verdictFor([l('Cat', 0.71), l('Dog', 0.88)]).species, 'dog');

// ─── Uncertain cases go to the user ───────────────────────────────────────────

// An animal, but not confidently one.
const weak = verdictFor([l('Cat', 0.55)]);
assert.equal(weak.decision, 'uncertain');
assert.equal(weak.species, 'cat');

// The boundary is inclusive: exactly at the threshold is confident.
assert.equal(verdictFor([l('Cat', CONFIDENT_AT)]).decision, 'confident');
assert.equal(verdictFor([l('Cat', CONFIDENT_AT - 0.01)]).decision, 'uncertain');

// Nothing animal at all — a bicycle, a receipt, a screenshot.
const notAnimal = verdictFor([l('Bicycle', 0.97), l('Wheel', 0.88)]);
assert.equal(notAnimal.decision, 'uncertain');
assert.equal(notAnimal.species, null);
assert.equal(notAnimal.topLabel, null);

// Part-labels keep a close-up out of the prompt when they score well. A cat's
// face filling the frame often labels as "Snout", never as "Cat".
const closeUp = verdictFor([l('Snout', 0.86), l('Sofa', 0.55)]);
assert.equal(closeUp.decision, 'confident');
assert.equal(closeUp.species, null); // known animal, unknown species — don't guess the picker

// A non-cat animal is still an animal; the species picker stays unset.
const bird = verdictFor([l('Bird', 0.92)]);
assert.equal(bird.decision, 'confident');
assert.equal(bird.species, null);

// ─── Fail-open and junk input ─────────────────────────────────────────────────

// No labels above ML Kit's own 0.5 floor: dark or blurred, which is exactly how
// strays get photographed. Ask, never silently drop.
assert.equal(verdictFor([]).decision, 'uncertain');
assert.equal(verdictFor(null).decision, 'uncertain');
assert.equal(verdictFor(undefined).decision, 'uncertain');

// Malformed entries from the bridge are skipped rather than throwing.
const junk = verdictFor([
  { text: 'Cat', confidence: NaN } as Label,
  { text: undefined as any, confidence: 0.9 },
  l('Dog', 0.85),
]);
assert.equal(junk.species, 'dog');
assert.equal(junk.decision, 'confident');

// A list of only malformed entries is uncertain, not a crash.
assert.equal(verdictFor([{ text: 'Cat', confidence: NaN } as Label]).decision, 'uncertain');

// ─── Prompt wording ───────────────────────────────────────────────────────────

// Names what it saw when it saw something...
assert.ok(uncertaintyPrompt(verdictFor([l('Bicycle', 0.9), l('Rabbit', 0.6)])).includes('rabbit'));
// ...and stays vague when it didn't.
assert.ok(uncertaintyPrompt(notAnimal).startsWith("We couldn't tell"));

// Every prompt offers the way through, and none of them blames the user.
for (const v of [weak, notAnimal, verdictFor([])]) {
  assert.ok(uncertaintyPrompt(v).includes('anyway?'));
}

console.log('animalCheck: all assertions passed');
