// The sky behind the map: one triangle over the whole screen, behind everything. Every pixel is a ray from the eye; the ray
// either leaves into the air and space or meets the ground where no land is drawn (there it is open sea under the
// same air). The colour comes from how much air the ray crosses, so the same code gives the pale sky over the
// horizon seen from 20 km, the thin blue shell over the edge of the globe seen from 2000 km, and everything between,
// without a seam and without layers. The Sun, the Moon with its phase, and the stars are drawn here too.
// The air of the ground (albumHaze, albumHorizon in light.js) ends in the same colour this sky starts with.
import { Mesh, BufferGeometry, BufferAttribute, ShaderMaterial, Matrix4, Vector3, Vector4 } from 'three';
import { COMMON } from '../glsl.js';
import { LIGHT, lightUniforms, HAZE_KM } from '../light.js';

// The air that colours the sky is this many km thick (density falls e times). The real figure is 8; the map lifts its
// relief 1.6 times, and its air with it.
export const AIR_KM = 12;
// how many times larger than life the discs of the Sun and the Moon are drawn (real: half a degree across)
export const SUN_SCALE = 1.6, MOON_SCALE = 2.2;

const VERT = /* glsl */`
uniform mat4 uInvProj, uCamWorld;
varying vec3 vDir;
void main() {
  vec4 v = uInvProj * vec4(position.xy, 1., 1.);
  vDir = mat3(uCamWorld) * (v.xyz / v.w);
  gl_Position = vec4(position.xy, .99999, 1.);
}`;

const FRAG = /* glsl */`
${COMMON}
${LIGHT}
uniform vec3 uMoonW; uniform vec4 uSkyK;        // uSkyK: x radians in one pixel, y lit share of the Moon
varying vec3 vDir;
#define AIR_KM ${AIR_KM.toFixed(2)}
#define HAZE_KM ${HAZE_KM.toFixed(3)}
const vec3 BLUE = vec3(.105, .215, .46);        // how strongly the clear air scatters red, green and blue
const float SUN_R = ${(.00465 * SUN_SCALE).toFixed(5)}, MOON_R = ${(.00452 * MOON_SCALE).toFixed(5)};

// All the air along a ray that leaves into space, in columns of air standing over the sea. X = R / H for an air
// layer H thick, h = height of the eye / H, c = cosine between the ray and the zenith. A ray that looks down passes
// its lowest point and climbs out again (C. Schüler's approximation of the Chapman function).
float airAlong(float X, float h, float c) {
  float q = sqrt(X + h);
  if (c >= 0.) return q / (q * c + 1.) * exp(-h);
  float x0 = sqrt(max(1. - c * c, 0.)) * (X + h);
  return 2. * sqrt(x0) * exp(min(X - x0, 0.)) - q / (1. - q * c) * exp(-h);
}
// stars: one in some cells of a grid on the faces of a cube around the eye, each a soft dot a pixel or two wide
float stars(vec3 d, float px) {
  vec3 a = abs(d); vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0. ? 0. : 1.; }
  else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0. ? 2. : 3.; }
  else { uv = d.xy / a.z; face = d.z > 0. ? 4. : 5.; }
  vec2 g = uv * 70., id = floor(g) + face * 131.;
  float m = hash21(id + 3.7);
  if (m < .86) return 0.;
  vec2 o = .2 + .6 * hash22(id);
  float r = length(fract(g) - o) / 70., big = (m - .86) / .14;
  return smoothstep(px * (1.1 + big), px * .25, r) * (.25 + .75 * big * big);
}

void main() {
  vec3 rd = normalize(vDir), C = cameraPosition + vec3(0., RKM, 0.);
  float rC = length(C), alt = max(rC - RKM, 0.), mu = dot(rd, C) / rC;
  float low = rC * sqrt(max(1. - mu * mu, 0.)) - RKM;              // the lowest point of the ray over the ground, km
  vec3 hor = albumHorizon(rd), col;
  if (mu < 0. && low < 0.) {
    // the ground where no land is drawn: open sea under the same air as the land
    float b = dot(C, rd), t = -b - sqrt(max(b * b - (rC * rC - RKM * RKM), 0.));
    vec3 sea = uStyle == 3 ? vec3(.62, .66, .68) : (uStyle == 6 ? vec3(.02, .03, .05)
      : pow(vec3(.07, .19, .40), vec3(2.2)) * (albumSkyCol() * 1.5 + albumSunCol() * max(uSun.z, 0.) * .75));
    col = albumAir(sea, cameraPosition + rd * t);
  } else {
    float day = albumDay(), px = uSkyK.x;
    float mAir = airAlong(RKM / AIR_KM, alt / AIR_KM, mu), mHaze = airAlong(RKM / HAZE_KM, alt / HAZE_KM, mu);
    vec3 T = exp(-(mAir * BLUE + mHaze * uHaze * .34));           // what is left of the light from beyond the air
    // space: never pure black; lighter and bluer the higher the eye, and a little lighter near the globe
    float off = mu < 0. ? low : alt;
    vec3 space = uStyle == 3 ? vec3(.60, .64, .68) : (uStyle == 6 ? vec3(.012, .016, .03) : (uStyle == 2 ? vec3(.10, .16, .30)
      : vec3(.0065, .013, .034) * mix(.45, 1.5, smoothstep(30., 1700., alt)) * (1. + 1.6 * exp(-max(off, 0.) / 420.))));
    col = hor * (1. - T) + space * T;
    if (uStyle == 0) {
      float clear = dot(T, vec3(.3333));
      // the stars come out as the day fades; from space they show a little by day too
      float dark = 1. - day * mix(1., .78, smoothstep(150., 1200., alt));
      if (dark > .01) col += vec3(.80, .86, 1.) * stars(rd, px) * dark * clear * .9;
      // the Sun: a disc reddened by the air it shines through, and the glare around it
      float sd = sqrt(max(2. - 2. * dot(rd, uSunW), 0.));
      if (sd < .6) {
        vec3 sunC = vec3(1.25, 1.12, .95) * T;
        col += sunC * (22. * (1. - smoothstep(SUN_R - px, SUN_R + px, sd)) + .9 * exp(-sd / .022) + .16 * exp(-sd / .11));
      }
      // the Moon: a ball lit by the same Sun, so its phase is simply where the Sun stands
      float md = sqrt(max(2. - 2. * dot(rd, uMoonW), 0.));
      if (md < MOON_R * 6.) {
        vec3 ux = normalize(cross(uMoonW, vec3(.31, .87, .38))), uy = cross(ux, uMoonW);
        vec2 q = vec2(dot(rd, ux), dot(rd, uy)) / MOON_R; float r2 = dot(q, q);
        float disc = 1. - smoothstep(1. - 2.5 * px / MOON_R, 1., sqrt(r2));
        if (disc > 0.) {
          vec3 n = ux * q.x + uy * q.y - uMoonW * sqrt(max(1. - r2, 0.));
          float lit = smoothstep(-.04, .22, dot(n, uSunW));
          float seas = .72 + .28 * smoothstep(.35, .62, vnoise(q * 1.7 + 4.2) * .6 + vnoise(q * 4.1 + 9.) * .4);
          col = mix(col, col + vec3(1., .97, .90) * seas * (lit * 1.5 + .012) * mix(1., .42, day) * clear, disc);
        }
        col += vec3(.55, .62, .80) * exp(-md / (MOON_R * 2.2)) * .05 * uSkyK.y * (1. - day) * clear;   // its halo in the night air
      }
    }
  }
  col = albumFinish(col);
  gl_FragColor = vec4(col + (hash21(gl_FragCoord.xy * .37 + 1.3) - .5) / 255., 1.);   // (the noise hides the steps of a slow gradient)
}`;

export class SkyDome {
  constructor(album) {
    const T = album.terrain.u, geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.u = { ...lightUniforms(T), uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() }, uMoonW: { value: new Vector3(0, 1, 0) }, uSkyK: { value: new Vector4(.001, 1, 0, 0) } };
    // It lies at the very back of the depth range and is drawn after the land and everything solid on it, so its
    // shader runs only for the pixels nothing has covered: looking straight down, the sky costs nothing.
    this.mesh = new Mesh(geo, new ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, depthTest: true, depthWrite: false }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 900;
    album.scene.add(this.mesh);
  }
  // camera: the PerspectiveCamera of the album; pixels: height of the picture in pixels
  update(camera, pixels) {
    this.u.uInvProj.value.copy(camera.projectionMatrixInverse); this.u.uCamWorld.value.copy(camera.matrixWorld);
    this.u.uSkyK.value.x = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(pixels, 1);
  }
}
