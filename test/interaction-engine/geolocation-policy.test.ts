import assert from 'node:assert/strict';

import {
  distanceMeters,
  evaluateLocationPolicy,
  isValidGeoPoint,
} from '../../src/api/services/geolocation-policy';

assert.equal(isValidGeoPoint({ latitude: -12.97, longitude: -38.5 }), true);
assert.equal(isValidGeoPoint({ latitude: 91, longitude: -38.5 }), false);

const same = distanceMeters(
  { latitude: -12.9714, longitude: -38.5014 },
  { latitude: -12.9714, longitude: -38.5014 },
);
assert.ok(same < 0.1);

const inside = evaluateLocationPolicy(
  {
    source: 'MICRO_APP_GPS',
    latitude: -12.9714,
    longitude: -38.5014,
    accuracy: 12,
  },
  {
    enabled: true,
    required: true,
    allowedSources: ['MICRO_APP_GPS'],
    maxAccuracyMeters: 100,
    geofences: [
      { id: 'salvador', name: 'Operação Salvador', latitude: -12.9714, longitude: -38.5014, radiusMeters: 500 },
    ],
    outsideGeofence: 'BLOCK',
  },
);
assert.equal(inside.accepted, true);
assert.equal(inside.insideGeofence, true);
assert.equal(inside.matches[0]?.id, 'salvador');

const outside = evaluateLocationPolicy(
  {
    source: 'MICRO_APP_GPS',
    latitude: -13.5,
    longitude: -38.5,
    accuracy: 15,
  },
  {
    enabled: true,
    geofences: [{ id: 'salvador', latitude: -12.9714, longitude: -38.5014, radiusMeters: 500 }],
    outsideGeofence: 'BLOCK',
  },
);
assert.equal(outside.accepted, false);
assert.equal(outside.insideGeofence, false);
assert.match(outside.reason, /OUTSIDE_GEOFENCE/);

const needsApproval = evaluateLocationPolicy(
  { source: 'WHATSAPP', latitude: -13.5, longitude: -38.5 },
  {
    enabled: true,
    geofences: [{ id: 'salvador', latitude: -12.9714, longitude: -38.5014, radiusMeters: 500 }],
    outsideGeofence: 'APPROVAL',
  },
);
assert.equal(needsApproval.accepted, true);
assert.equal(needsApproval.insideGeofence, false);
assert.equal(needsApproval.outsidePolicy, 'APPROVAL');

const inaccurate = evaluateLocationPolicy(
  { source: 'MICRO_APP_GPS', latitude: -12.9714, longitude: -38.5014, accuracy: 500 },
  { enabled: true, maxAccuracyMeters: 100 },
);
assert.equal(inaccurate.accepted, false);
assert.match(inaccurate.reason, /ACCURACY/);

console.log('geolocation policy: ok');
