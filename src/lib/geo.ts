// Job-site geofencing for the time clock. Pure functions.

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export const DEFAULT_RADIUS_M = 300;
const MAX_ACCURACY_CREDIT_M = 500; // a phone's stated accuracy helps, up to a point

export type Fence = { lat: number; lng: number; radiusM: number };
export type FenceResult = { distanceM: number | null; outside: boolean; reason: 'inside' | 'outside' | 'no-location' | 'no-site' };

/** Is this punch at the site? A fix counts as inside if its accuracy circle reaches the fence. */
export function checkFence(site: Fence | null, geo?: { lat: number; lng: number; accuracy?: number } | null): FenceResult {
  if (!site) return { distanceM: null, outside: false, reason: 'no-site' };
  if (!geo) return { distanceM: null, outside: true, reason: 'no-location' };
  const d = distanceM(site, geo);
  const slack = Math.min(geo.accuracy ?? 0, MAX_ACCURACY_CREDIT_M);
  return { distanceM: d, outside: d - slack > site.radiusM, reason: d - slack > site.radiusM ? 'outside' : 'inside' };
}

export const fenceOf = (job: { siteLat: number | null; siteLng: number | null; geofenceMeters: number | null }): Fence | null =>
  job.siteLat != null && job.siteLng != null ? { lat: job.siteLat, lng: job.siteLng, radiusM: job.geofenceMeters ?? DEFAULT_RADIUS_M } : null;

export const howFar = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1609.34).toFixed(m < 16000 ? 1 : 0)} miles`);

/** "28.5383, -81.3792" or a Google Maps link → coordinates. */
export function parseCoords(s: string): { lat: number; lng: number } | null {
  const m = s.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/) ?? s.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
