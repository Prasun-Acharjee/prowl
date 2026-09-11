import { Species } from '../types';

/**
 * Decides whether a photo looks like a cat or a dog, from ML Kit's labels.
 *
 * Pure, and free of react-native imports, so animalCheck.test.ts runs under
 * node. The native call lives in imageLabels.ts — this module only reasons
 * about the labels that come back.
 *
 * Why this exists: `pets` is a public map and anyone can put a photo on it.
 * Migration 00008 gave us a `not_a_cat` report reason, which means wrong-subject
 * uploads already happen and are currently only caught after the fact, by a
 * person. Catching them at capture time is cheaper for everyone.
 */

export interface Label {
  text: string;
  confidence: number;
}

/**
 * ML Kit's base model emits ~400 generic labels. These sets are the ones that
 * matter to us, lower-cased for comparison.
 *
 * Treat them as tunable, not as gospel: the exact strings come from Google's
 * label map and are worth confirming against real photos — imageLabels.ts logs
 * everything it gets back under __DEV__ for exactly that purpose. A label that
 * turns out not to exist simply never matches, which costs a prompt, not a
 * crash.
 */
const CAT_LABELS = new Set(['cat', 'kitten']);
const DOG_LABELS = new Set(['dog', 'puppy']);

/**
 * Animal evidence that doesn't name a species. Two kinds: other creatures
 * (someone photographing a bird is not photographing a stray, but they are
 * photographing an animal), and the part-labels the base model tends to emit on
 * a close-up — a cat's face fills the frame and you get "whiskers" and "snout"
 * rather than "cat".
 */
const ANIMAL_LABELS = new Set([
  'animal', 'pet', 'mammal', 'carnivore', 'wildlife',
  'snout', 'fur', 'whiskers', 'tail', 'paw', 'claw',
  'bird', 'rabbit', 'horse', 'cattle', 'sheep', 'goat', 'pig',
  'fish', 'turtle', 'squirrel', 'fox', 'deer', 'bear', 'monkey',
]);

/**
 * Above this, we don't interrupt. Below it — including when no animal label
 * comes back at all — the user is asked to approve the upload.
 *
 * Note the floor: the native module builds its labeler with
 * setConfidenceThreshold(0.5), so nothing weaker than 0.5 ever reaches us. Any
 * confidence here is therefore in [0.5, 1].
 */
export const CONFIDENT_AT = 0.7;

export type Decision = 'confident' | 'uncertain';

export interface AnimalVerdict {
  /** 'confident' passes silently; 'uncertain' asks the user to approve. */
  decision: Decision;
  /** Set only when a cat or dog label won outright — pre-selects the picker. */
  species: Species | null;
  /** The winning animal label, for the prompt text. Null when nothing matched. */
  topLabel: string | null;
  confidence: number;
}

const ALLOW: AnimalVerdict = {
  decision: 'confident', species: null, topLabel: null, confidence: 0,
};

/**
 * Fail open. An empty label list means ML Kit found nothing above its own
 * threshold, which happens on dark and motion-blurred photos — precisely the
 * conditions a stray gets photographed in. Blocking those would lose real
 * sightings to a limitation of the classifier.
 */
export function verdictFor(labels: Label[] | null | undefined): AnimalVerdict {
  if (!labels || labels.length === 0) return { ...ALLOW, decision: 'uncertain' };

  let best: { label: string; confidence: number; species: Species | null } | null = null;

  for (const { text, confidence } of labels) {
    if (typeof text !== 'string' || !Number.isFinite(confidence)) continue;
    const key = text.trim().toLowerCase();

    const species: Species | null =
      CAT_LABELS.has(key) ? 'cat' :
      DOG_LABELS.has(key) ? 'dog' :
      null;

    if (!species && !ANIMAL_LABELS.has(key)) continue;

    // A species label outranks a generic one even when the generic one scored
    // higher: "pet 0.91 / dog 0.78" should still pre-select Dog.
    const better =
      !best ||
      (!!species && !best.species) ||
      (!!species === !!best.species && confidence > best.confidence);

    if (better) best = { label: text.trim(), confidence, species };
  }

  if (!best) return { ...ALLOW, decision: 'uncertain' };

  return {
    decision: best.confidence >= CONFIDENT_AT ? 'confident' : 'uncertain',
    species: best.species,
    topLabel: best.label,
    confidence: best.confidence,
  };
}

/**
 * The question put to the user when a photo doesn't clearly show an animal.
 * Phrased as the app's uncertainty rather than the user's mistake — the
 * classifier is wrong often enough that blaming the photographer is unfair.
 */
export function uncertaintyPrompt(verdict: AnimalVerdict): string {
  if (verdict.topLabel) {
    return `This might not be a cat or dog — it looks like it could be a ${verdict.topLabel.toLowerCase()}. Add it anyway?`;
  }
  return "We couldn't tell whether this photo shows a cat or dog. Add it anyway?";
}
