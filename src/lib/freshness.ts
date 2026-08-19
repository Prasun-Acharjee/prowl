/**
 * How long it has been since anyone saw a pet.
 *
 * A stray tracker's value decays: a cat last seen four months ago is a very
 * different thing from one seen this morning, and the map draws both as the
 * same pin. This turns the gap into something the UI can badge and sort on.
 *
 * Pure, and free of react-native imports, so freshness.test.ts runs under node.
 */

export type Freshness = 'fresh' | 'quiet' | 'missing';

/** Seen within a week — the ordinary case, and deliberately not badged. */
export const QUIET_AFTER_DAYS   = 7;
/** A month of silence. Long enough to mean something on a community animal. */
export const MISSING_AFTER_DAYS = 30;

const DAY_MS = 86_400_000;

export function daysSince(iso: string, now: number = Date.now()): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  // Clamp: a clock skew between device and server can put last_seen_at slightly
  // in the future, and "seen in -1 days" is not a thing worth rendering.
  return Math.max(0, (now - then) / DAY_MS);
}

export function freshnessOf(iso: string, now: number = Date.now()): Freshness {
  const days = daysSince(iso, now);
  if (days >= MISSING_AFTER_DAYS) return 'missing';
  if (days >= QUIET_AFTER_DAYS)   return 'quiet';
  return 'fresh';
}

/**
 * Badge text, or null when there is nothing worth saying. Fresh pets get no
 * label at all — a badge on every row is wallpaper, and stops being read.
 *
 * The wording is about the gap ("Not seen in 3 weeks"), not about the pet
 * ("missing"): the app knows only that nobody has logged it, which is not the
 * same as the animal being gone, and saying so would be a claim we cannot make.
 */
export function freshnessLabel(iso: string, now: number = Date.now()): string | null {
  const days = Math.floor(daysSince(iso, now));
  if (days < QUIET_AFTER_DAYS) return null;

  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `Not seen in ${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `Not seen in ${months} month${months === 1 ? '' : 's'}`;
  }
  const years = Math.floor(days / 365);
  return `Not seen in ${years} year${years === 1 ? '' : 's'}`;
}
