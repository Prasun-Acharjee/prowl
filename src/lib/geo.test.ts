// Self-check for the distance helpers. No framework — run it with:
//   npx tsx src/lib/geo.test.ts
import assert from 'node:assert/strict';
import {
  distanceMeters, formatDistance, sortByDistance, directionsUrl, mapsSearchUrl,
} from './geo';

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ~${expected} (±${tolerance}), got ${actual}`,
  );

// ─── distanceMeters ───────────────────────────────────────────────────────────

const timesSquare = { latitude: 40.758, longitude: -73.9855 };
const empireState = { latitude: 40.7484, longitude: -73.9857 };

// Same point is zero, and the function is symmetric.
assert.equal(distanceMeters(timesSquare, timesSquare), 0);
assert.equal(
  distanceMeters(timesSquare, empireState),
  distanceMeters(empireState, timesSquare),
);

// Times Square to the Empire State Building is a little over a kilometre.
near(distanceMeters(timesSquare, empireState), 1065, 30);

// One degree of latitude is ~111 km anywhere on the globe...
near(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }), 111_195, 200);

// ...but a degree of longitude shrinks towards the poles. This is the case an
// equirectangular approximation with a fixed scale gets wrong.
near(distanceMeters({ latitude: 60, longitude: 0 }, { latitude: 60, longitude: 1 }), 55_597, 200);

// Antipodes: the sqrt argument can exceed 1 through floating-point error, which
// would make asin return NaN without the clamp.
assert.ok(Number.isFinite(distanceMeters({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 })));

// ─── formatDistance ───────────────────────────────────────────────────────────

// Under 100 m rounds to 10 m, with a floor so a cat underfoot never reads "0 m".
assert.equal(formatDistance(3),   '10 m');
assert.equal(formatDistance(42),  '40 m');
assert.equal(formatDistance(96),  '100 m');
// Metres up to a kilometre, then one decimal, then whole kilometres.
assert.equal(formatDistance(340),   '340 m');
// 999 rounds up to 1000 m, which belongs in the kilometre branch.
assert.equal(formatDistance(999),   '1.0 km');
assert.equal(formatDistance(1000),  '1.0 km');
assert.equal(formatDistance(1340),  '1.3 km');
assert.equal(formatDistance(9949),  '9.9 km');
assert.equal(formatDistance(18_400), '18 km');
// Garbage in, empty label out — the caller renders nothing rather than "NaN m".
assert.equal(formatDistance(NaN), '');
assert.equal(formatDistance(-5),  '');

// ─── sortByDistance ───────────────────────────────────────────────────────────

const far    = { id: 'far',    latitude: 40.80, longitude: -73.9855 };
const mid    = { id: 'mid',    latitude: 40.77, longitude: -73.9855 };
const close  = { id: 'close',  latitude: 40.759, longitude: -73.9855 };
const pets   = [far, mid, close];

assert.deepEqual(
  sortByDistance(pets, timesSquare).map(p => p.id),
  ['close', 'mid', 'far'],
);

// No origin is a pass-through, by reference, so an unsorted render does no work.
assert.equal(sortByDistance(pets, null), pets);

// Sorting never reorders the caller's array.
assert.deepEqual(pets.map(p => p.id), ['far', 'mid', 'close']);

// ─── URLs ─────────────────────────────────────────────────────────────────────

assert.equal(
  directionsUrl(40.758, -73.9855, 'Miso', 'ios'),
  'http://maps.apple.com/?daddr=40.758,-73.9855&q=Miso',
);
assert.equal(
  directionsUrl(40.758, -73.9855, 'Miso', 'android'),
  'geo:40.758,-73.9855?q=40.758,-73.9855(Miso)',
);

// Names are user input: a cat called "Tom & Jerry" must not break the query.
assert.ok(!directionsUrl(1, 2, 'Tom & Jerry', 'ios').includes('& Jerry'));
assert.ok(directionsUrl(1, 2, 'Tom & Jerry', 'android').includes('Tom%20%26%20Jerry'));

assert.equal(
  mapsSearchUrl(40.758, -73.9855),
  'https://www.google.com/maps/search/?api=1&query=40.758,-73.9855',
);

console.log('geo: all assertions passed');
