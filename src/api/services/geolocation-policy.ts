export type LocationSource = 'WHATSAPP' | 'MICRO_APP_GPS' | 'GEOIP';

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type CapturedLocation = GeoPoint & {
  source: LocationSource;
  accuracy?: number;
  address?: string;
  name?: string;
  capturedAt?: string;
};

export type GeofenceDefinition = GeoPoint & {
  id: string;
  name: string;
  radiusMeters: number;
};

export type LocationPolicy = {
  enabled?: boolean;
  required?: boolean;
  allowedSources?: LocationSource[];
  maxAccuracyMeters?: number;
  geofences?: GeofenceDefinition[];
  outsideGeofence?: 'BLOCK' | 'ALLOW' | 'JUSTIFY' | 'APPROVAL';
};

export type GeofenceMatch = {
  id: string;
  name: string;
  distanceMeters: number;
  radiusMeters: number;
  inside: boolean;
};

export type LocationPolicyResult = {
  accepted: boolean;
  reason: string;
  source: LocationSource;
  accuracyAccepted: boolean;
  insideGeofence: boolean | null;
  nearestGeofence?: GeofenceMatch;
  matches: GeofenceMatch[];
};

const EARTH_RADIUS_METERS = 6371008.8;

function radians(value: number) {
  return (value * Math.PI) / 180;
}

export function isValidGeoPoint(value: Partial<GeoPoint> | null | undefined): value is GeoPoint {
  return (
    Number.isFinite(value?.latitude) &&
    Number.isFinite(value?.longitude) &&
    Number(value?.latitude) >= -90 &&
    Number(value?.latitude) <= 90 &&
    Number(value?.longitude) >= -180 &&
    Number(value?.longitude) <= 180
  );
}

export function distanceMeters(origin: GeoPoint, target: GeoPoint): number {
  if (!isValidGeoPoint(origin) || !isValidGeoPoint(target)) return Number.POSITIVE_INFINITY;

  const lat1 = radians(origin.latitude);
  const lat2 = radians(target.latitude);
  const deltaLat = radians(target.latitude - origin.latitude);
  const deltaLon = radians(target.longitude - origin.longitude);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const angularDistance = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return EARTH_RADIUS_METERS * angularDistance;
}

export function evaluateLocationPolicy(location: CapturedLocation, policy: LocationPolicy = {}): LocationPolicyResult {
  if (!isValidGeoPoint({ latitude: location.latitude, longitude: location.longitude })) {
    return {
      accepted: false,
      reason: 'INVALID_LOCATION',
      source: location.source,
      accuracyAccepted: false,
      insideGeofence: null,
      matches: [],
    };
  }

  const allowedSources = policy.allowedSources || ['WHATSAPP', 'MICRO_APP_GPS'];
  if (!allowedSources.includes(location.source)) {
    return {
      accepted: false,
      reason: 'SOURCE_NOT_ALLOWED',
      source: location.source,
      accuracyAccepted: false,
      insideGeofence: null,
      matches: [],
    };
  }

  const maxAccuracy = Number(policy.maxAccuracyMeters || 0);
  const accuracyAccepted =
    !maxAccuracy ||
    location.source !== 'MICRO_APP_GPS' ||
    (Number.isFinite(location.accuracy) && Number(location.accuracy) <= maxAccuracy);

  const geofences = Array.isArray(policy.geofences) ? policy.geofences.filter(isValidGeoPoint) : [];
  const matches = geofences
    .map((geofence) => {
      const distance = distanceMeters(location, geofence);
      return {
        id: geofence.id,
        name: geofence.name,
        distanceMeters: Math.round(distance * 100) / 100,
        radiusMeters: Number(geofence.radiusMeters || 0),
        inside: distance <= Number(geofence.radiusMeters || 0),
      };
    })
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  const nearestGeofence = matches[0];
  const insideGeofence = matches.length ? matches.some((match) => match.inside) : null;
  const outsidePolicy = policy.outsideGeofence || 'BLOCK';
  const geofenceAccepted = insideGeofence !== false || outsidePolicy !== 'BLOCK';
  const accepted = accuracyAccepted && geofenceAccepted;

  return {
    accepted,
    reason: !accuracyAccepted
      ? 'ACCURACY_TOO_LOW'
      : !geofenceAccepted
        ? 'OUTSIDE_GEOFENCE'
        : insideGeofence === false
          ? `OUTSIDE_GEOFENCE_${outsidePolicy}`
          : 'ACCEPTED',
    source: location.source,
    accuracyAccepted,
    insideGeofence,
    nearestGeofence,
    matches,
  };
}
