// The ground point under a screen position: the view ray meets the sphere, then spheres through the ground height
// found there (a few rounds settle it on relief seen at a slant).
import { Raycaster, Vector2, Vector3 } from 'three';
import { fromWorld, R } from './geo.js';

const rc = new Raycaster(), ndc = new Vector2(), o = new Vector3(), UP = new Vector3(0, R, 0), hit = new Vector3();
// → { lat, lon } or null when the ray misses the globe
export function pickGround(album, clientX, clientY) {
  const r = album.renderer.domElement.getBoundingClientRect();
  ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  rc.setFromCamera(ndc, album.cam.cam);
  const d = rc.ray.direction; o.copy(rc.ray.origin).add(UP);
  let ll = null, rad = R;
  for (let i = 0; i < 5; i++) {
    const b = o.dot(d), disc = b * b - (o.dot(o) - rad * rad);
    if (disc < 0) return ll;
    ll = fromWorld(hit.copy(rc.ray.origin).addScaledVector(d, -b - Math.sqrt(disc)));
    rad = R + Math.max(0, album.data.base.at(ll.lat, ll.lon)) * album.terrain.u.uExag.value / 1000;
  }
  return ll;
}
