// Self-check for the sighting-gap helpers. No framework — run it with:
//   npx tsx src/lib/freshness.test.ts
import assert from 'node:assert/strict';
import { daysSince, freshnessOf, freshnessLabel } from './freshness';

const NOW = Date.parse('2026-08-19T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

// ─── daysSince ────────────────────────────────────────────────────────────────

assert.equal(daysSince(daysAgo(0), NOW), 0);
assert.equal(daysSince(daysAgo(5), NOW), 5);

// A device clock ahead of the server can date a sighting in the future. That
// clamps to zero rather than going negative.
assert.equal(daysSince(new Date(NOW + 86_400_000).toISOString(), NOW), 0);

// An unparseable timestamp is treated as "just now" — the pet still renders,
// simply without a stale badge, which beats NaN reaching the UI.
assert.equal(daysSince('not a date', NOW), 0);

// ─── freshnessOf ──────────────────────────────────────────────────────────────

assert.equal(freshnessOf(daysAgo(0), NOW),  'fresh');
assert.equal(freshnessOf(daysAgo(6), NOW),  'fresh');
// Boundaries are inclusive: day 7 is quiet, day 30 is missing.
assert.equal(freshnessOf(daysAgo(7), NOW),  'quiet');
assert.equal(freshnessOf(daysAgo(29), NOW), 'quiet');
assert.equal(freshnessOf(daysAgo(30), NOW), 'missing');
assert.equal(freshnessOf(daysAgo(400), NOW), 'missing');

// ─── freshnessLabel ───────────────────────────────────────────────────────────

// Nothing to say about a pet seen this week — a badge on every row is wallpaper.
assert.equal(freshnessLabel(daysAgo(0), NOW), null);
assert.equal(freshnessLabel(daysAgo(6), NOW), null);

// Weeks, then months, then years, each singular at 1.
assert.equal(freshnessLabel(daysAgo(7),   NOW), 'Not seen in 1 week');
assert.equal(freshnessLabel(daysAgo(13),  NOW), 'Not seen in 1 week');
assert.equal(freshnessLabel(daysAgo(14),  NOW), 'Not seen in 2 weeks');
assert.equal(freshnessLabel(daysAgo(29),  NOW), 'Not seen in 4 weeks');
assert.equal(freshnessLabel(daysAgo(30),  NOW), 'Not seen in 1 month');
assert.equal(freshnessLabel(daysAgo(90),  NOW), 'Not seen in 3 months');
assert.equal(freshnessLabel(daysAgo(364), NOW), 'Not seen in 12 months');
assert.equal(freshnessLabel(daysAgo(365), NOW), 'Not seen in 1 year');
assert.equal(freshnessLabel(daysAgo(800), NOW), 'Not seen in 2 years');

// Every label the function can produce reads as a gap in reporting, never as a
// claim about the animal — the app only knows that nobody logged it.
for (const d of [7, 30, 200, 900]) {
  assert.ok(freshnessLabel(daysAgo(d), NOW)!.startsWith('Not seen in'));
}

console.log('freshness: all assertions passed');
