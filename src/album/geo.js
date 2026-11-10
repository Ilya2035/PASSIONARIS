// Geometry of the album scene. 1 world unit = 1 km. The region sits on a real-size sphere whose surface point at
// CENTRE is the world origin: +Y is up there, +X east, −Z north. Curvature is real, so the horizon is real too.
import { Vector3 } from 'three';

export const R = 6371;
export const BBOX = { lon0: -10.0, lon1: 4.5, lat0: 35.2, lat1: 44.8 };
export const CENTRE = { lat: 40.0, lon: -2.75 };
export const KM_PER_DEG = 111.195;
export const COS_REF = Math.cos(CENTRE.lat * Math.PI / 180); // one fixed east-west scale for the whole grid
const D = Math.PI / 180, S0 = Math.sin(CENTRE.lat * D), C0 = Math.cos(CENTRE.lat * D);

export function toWorld(lat, lon, hKm = 0, out = new Vector3()) {
  const f = lat * D, dl = (lon - CENTRE.lon) * D, cf = Math.cos(f), sf = Math.sin(f), cd = Math.cos(dl), r = R + hKm;
  return out.set(r * cf * Math.sin(dl), r * (sf * S0 + cf * cd * C0) - R, -r * (sf * C0 - cf * cd * S0));
}
export function fromWorld(v) {
  const x = v.x, y = v.y + R, z = -v.z, r = Math.hypot(x, y, z), X = x / r, U = y / r, N = z / r;
  return { lat: Math.asin(U * S0 + N * C0) / D, lon: CENTRE.lon + Math.atan2(X, U * C0 - N * S0) / D, h: r - R };
}
// local east / north / up unit vectors at a point
export function frame(lat, lon) {
  const up = toWorld(lat, lon, 0).add(new Vector3(0, R, 0)).normalize();
  const dl = (lon - CENTRE.lon) * D, east = new Vector3(Math.cos(dl), -Math.sin(dl) * C0, -Math.sin(dl) * S0).normalize();
  return { up, east, north: new Vector3().crossVectors(up, east).normalize() };
}
export const mercX = lon => (lon + 180) / 360;
export const mercY = lat => { const r = lat * D; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
// great-circle distance, km
export function distKm(a, b) {
  const f1 = a.lat * D, f2 = b.lat * D, dl = (b.lon - a.lon) * D;
  return R * Math.acos(Math.min(1, Math.sin(f1) * Math.sin(f2) + Math.cos(f1) * Math.cos(f2) * Math.cos(dl)));
}
export const clampLL = (lat, lon) => ({ lat: Math.max(BBOX.lat0, Math.min(BBOX.lat1, lat)), lon: Math.max(BBOX.lon0, Math.min(BBOX.lon1, lon)) });
