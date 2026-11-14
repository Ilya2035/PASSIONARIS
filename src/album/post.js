// The finishing pass over the whole picture: ambient occlusion from the depth buffer (soft dark contact around
// cliffs and in gullies), a light sharpening, the weather and a vignette. The scene is drawn into a multisampled
// target with a depth texture; this pass puts it on screen.
//
// The weather is laid here, from the depth of every pixel, and not in the shaders of the land: the ground shader has
// no room left for it (see light.js), and here it falls on everything alike — land, water, trees, houses, roads.
// That is the shadows of the clouds, the rain (wet ground, the grey veil that hangs under a raining cloud, the lines
// of falling rain near the ground) and the fog of the morning in the valleys and over the water (sky/weather.js).
// Each of them is a piece of the shader that is there only while it is switched on: with no weather the pass is
// the plain one, and the weather costs nothing.
import { WebGLRenderTarget, DepthTexture, UnsignedIntType, LinearFilter, NearestFilter, ShaderMaterial, Mesh, PlaneGeometry, OrthographicCamera, Scene, Vector2, Vector3, Matrix4 } from 'three';
import { COMMON } from './glsl.js';
import { LIGHT, lightUniforms } from './light.js';
import { WEATHER, WX } from './sky/weather.js';

const CLOUDS = 1, RAIN = 2, FOG = 4;
// (this pass is drawn with its own flat camera: the eye of the map comes as uEye, under the name LIGHT knows)
const HEAD = `#define cameraPosition uEye\n${COMMON}\n${LIGHT}\n${WEATHER}`;
// the lines of rain are this many times longer than the cell they fall in is wide
const RAIN_LEN = 20;
const RAIN_FN = /* glsl */`
        uniform float uRpp;                           // radians in one pixel (a little more on a large picture)
        // where the rain that passes a point of the air comes from, on the plane of the weather: the cloud has moved
        // on while it fell (not at all at the height of the clouds, RAIN_LAG km at the ground)
        vec2 wxFallQ(vec3 P) { return P.xz / max(P.y, 1.) * RKM + WX_WIND * (RAIN_LAG * clamp(1. - (length(P) - RKM) / uCloud.w, 0., 1.)); }
        // Lines of falling rain, in the cells of a grid wrapped around the vertical through the eye. All rain falls
        // along that vertical, so on the screen its lines run toward the point straight under the eye, wherever the
        // camera looks. a: 0..1 around the vertical; v: along the fall; n: how many cells around.
        float wxLines(float a, float v, float n) {
          float x = a * n, ix = floor(x), fx = x - ix, col = mod(ix, n), h = hashCell(vec2(col, n));
          float y = v * n * ${(1 / (2 * Math.PI * RAIN_LEN)).toFixed(5)} + uRain.z * (2.6 + 1.8 * h) + h * 61.;
          float iy = floor(y), fy = y - iy, d = hashCell(vec2(col + n, iy));
          return (1. - smoothstep(.04, .15, abs(fx - .25 - .5 * fract(d * 7.31)))) * smoothstep(0., .35, fy) * (1. - smoothstep(.55, 1., fy)) * step(.4, d) * (.35 + .65 * fract(d * 3.77));
        }
        // Falling snow in the same grid, in cells as long as they are wide: one small soft flake in about half of
        // the cells, falling slowly and swaying.
        float wxFlakes(float a, float v, float n) {
          float y = v * n * .15915 + uRain.z * 1.9, x = a * n + sin(y * 1.3 + uRain.z * .7) * .22;
          vec2 i = floor(vec2(x, y)), f = vec2(x, y) - i; float d = hashCell(vec2(mod(i.x, n) + n, i.y));
          return (1. - smoothstep(.07, .2, length(f - .25 - .5 * vec2(fract(d * 7.31), fract(d * 3.77))))) * step(.45, d);
        }
        // soft stripes around the same vertical: the streaks of a curtain of rain seen from afar
        float wxBands(float a, float n) {
          float x = a * n, i = floor(x), f = x - i; f = f * f * (3. - 2. * f);
          return mix(hashCell(vec2(mod(i, n), n + 9.)), hashCell(vec2(mod(i + 1., n), n + 9.)), f);
        }`;
// the ray of the pixel in the world and the point of the world behind it (none where the pixel is sky)
const RAY = /* glsl */`
          bool ground = z0 < uFar * .97;
          vec4 v4 = uInvProj * vec4(vUv * 2. - 1., 1., 1.); vec3 dv = normalize(v4.xyz / v4.w), rdW = normalize(mat3(uCamWorld) * dv);
          float tG = z0 / max(-dv.z, 1e-4); vec3 wpos = uEye + rdW * tG;`;
// Wet ground: darker and a little deeper in colour where the rain falls now, and — fading — where it fell a while
// ago: the rain goes on with its cloud and leaves a wet trail behind. (The picture here is in screen colours.)
//
// Above the line of snowfall what falls is snow, and the ground under it is not wet but white: fresh snow, thin at
// the line and whole a few hundred metres higher. It stays longer than the wet: the white trail behind a snow cloud
// is more than a hundred km long. What was bright in the picture — open slopes in the Sun — becomes white; what was
// dark — forest, a slope in shade — becomes blue-grey, so the relief and the forests still read through the snow.
// (This snow is weather, laid here by the height of the pixel. The lasting snow is the ground shader's own.)
const WET = /* glsl */`
          if (uRain.x > 0. && ground) {
            vec2 q0 = wxPlane(wpos), qw = q0 + WX_WIND * RAIN_LAG;
            float now = wxRainAt(qw, 0.), was = wxRainAt(qw + WX_WIND * 40., 2.), wk = min(uRain.x * 1.6, 1.), wet = max(now, .7 * was) * wk;
            float alt = length(wpos + vec3(0., RKM, 0.)) - RKM, over = alt - uSnowF.x - q0.y * uSnowF.y;
            if (uSnowF.w > 0. && over > -uSnowF.z * 2.) {
              // The edge of the fresh snow is crisp and ragged, with patches before it: not a contour drawn with a
              // ruler and not a soft band either (a soft band lies on the slopes like cotton wool). The raggedness
              // is the picture of the clouds read very small (a read of a picture is cheaper here than noise), at a
              // level of detail by the size of the pixel: patches smaller than a pixel fade by themselves.
              float pk = tG * uRpp;
              float e = over / uSnowF.z + (textureLod(tCloud, q0 * ${(37 / 8192).toFixed(7)}, log2(max(pk / .216, 1.))).r - .5) * 3.2
                + (textureLod(tCloud, q0 * ${(160 / 8192).toFixed(7)} + .31, log2(max(pk / .05, 1.))).r - .5) * 2.4;
              float white = smoothstep(-.15, .45, e);
              // (no snow on the sea in a winter when the line is down at the shore: snow melts in open water)
              float lay = white * max(max(now, .9 * was), .75 * wxRainAt(qw + WX_WIND * 110., 3.)) * wk * smoothstep(.002, .012, alt);
              wet *= 1. - white;
              float day = albumDay(), ref = mix(.1, .4, day), up = smoothstep(ref * .2, ref * 1.6, dot(c, vec3(.2126, .7152, .0722)));
              c = mix(c, mix(vec3(.45, .53, .69), vec3(.96, .97, .99), up) * mix(.2, 1., day), lay * mix(.74, .93, up));
            }
            vec3 w3 = c * (.5 + .32 * c); w3 = mix(vec3(dot(w3, vec3(.2126, .7152, .0722))), w3, 1.12);
            c = mix(c, w3, wet * .9);
          }`;
// The fog of the morning. The last stretch of the ray before the ground is walked in six steps; a step that lies
// under the top of the fog adds to it. So the fog has its own thickness: its edge runs along the slopes where the
// ground rises out of it, and a look along the ground sees more of it than a look from above.
const FOGGY = /* glsl */`
          if (uFog.x > 0. && ground) {
            vec3 G = wpos + vec3(0., RKM, 0.);
            // the top of a fog is not smooth: it billows, and its edge is ragged
            vec2 qf = wxPlane(wpos); float puff = vnoise(qf / 2.3) * .4 + vnoise(qf / 7.1 + 3.) * .6, lift = (puff - .5) * uFog.y * .45;
            float reach = min(min((uFog.y * 1.6 + .04) / max(-dot(rdW, G) / length(G), .03), 30.), tG * .9), fog = 0.;
            for (int i = 0; i < 6; i++) {
              vec3 P = G - rdW * (reach * (float(i) + .5) / 6.);
              fog += smoothstep(0., uFog.w, wxFogTop(P.xz / max(P.y, 1.) * RKM) + lift - (length(P) - RKM));
            }
            fog = 1. - exp(-fog * reach / 6. * 7.);
            if (fog > .004) {
              // its billows are lit from the side of the Sun
              vec2 qs = qf + normalize(uSunW.xz + 1e-4) * 1.1; float side = clamp((puff - vnoise(qs / 2.3) * .4 - vnoise(qs / 7.1 + 3.) * .6) * 4., -1., 1.);
              // (by night it is a pale grey a little lighter than the dark land, not a light of its own)
              vec3 fl = (albumSunCol() * (.5 * max(uSun.z, 0.) + .16) + albumSkyCol() * 1.15 + albumMoonCol() * .5) * (.66 + .16 * puff + .12 * side * albumDay()) * mix(.5, 1., albumDay());
              c = mix(c, albumFinish(albumAir(fl, wpos)), fog);
            }
          }`;
// the shadows of the clouds: how much sun the clouds leave the point behind the pixel; the air in front of the
// point is not shaded (the picture here is already in screen colours: hence the root)
const SHADE = /* glsl */`
          if (uCloud.x > 0. && ground) c *= mix(1., sqrt(albumCloudShade(wpos)), 1. - albumHaze(wpos));`;
// Rain in the air. The ray is walked from the height of the clouds down to the ground (or out of the layer again);
// where it passes under a raining part of a cloud it gathers a grey veil — the curtain of rain that hangs under the
// cloud, slanted because the cloud moves on while the drops fall. Seen from afar the curtain has soft streaks; near
// the ground thin lines of rain fall through it.
const RAINY = /* glsl */`
          if (uRain.x > 0.) {
            vec3 E = uEye + vec3(0., RKM, 0.); float top = RKM + uCloud.w, eb = dot(E, rdW), disc = eb * eb - dot(E, E) + top * top;
            if (disc > 0.) {
              float sq = sqrt(disc), t0 = max(-eb - sq, 0.), t1 = ground ? min(tG, sq - eb) : sq - eb;
              if (t1 > t0) {
                // (a short way through the layer — a steep look from near the ground — is walked in three steps, and
                // which clouds rain is asked at its two ends only: that picture is too large to change on 40 km)
                bool brief = t1 - t0 < 40.; int steps = brief ? 3 : 6; float rain = 0., sf = 0., ma = 0., mb = 0.;
                if (brief) { ma = wxRainMask(wxFallQ(E + rdW * t0)); mb = wxRainMask(wxFallQ(E + rdW * t1)); }
                for (int i = 0; i < steps; i++) {
                  float u = (float(i) + .5) / float(steps); vec2 qi = wxFallQ(E + rdW * mix(t0, t1, u));
                  rain += wxRainCloud(qi, 0.) * (brief ? mix(ma, mb, u) : wxRainMask(qi));
                }
                rain *= 6. / float(steps);
                // how much of it is snow: in the air by the height of the land under it; near the ground by the very
                // slope behind the pixel, so that snow falls exactly where the ground turns white
                if (uSnowF.w > 0. && rain > 0.) {
                  if (!ground || uRain.w < 1.) { vec3 Pa = E + rdW * mix(t0, t1, .3), Pb = E + rdW * mix(t0, t1, .75); sf = .5 * (wxSnowAir(Pa.xz / max(Pa.y, 1.) * RKM) + wxSnowAir(Pb.xz / max(Pb.y, 1.) * RKM)); }
                  if (ground) sf = mix(sf, wxSnowy(wxPlane(wpos), length(wpos + vec3(0., RKM, 0.)) - RKM), uRain.w);
                }
                float veil = 1. - exp(-rain * (t1 - t0) / 6. * uRain.x * (.075 + .04 * sf));
                if (veil > .004) {
                  vec3 upE = normalize(E); float cg = clamp(-dot(rdW, upE), -1., 1.), sg = sqrt(max(1. - cg * cg, 1e-8));
                  vec3 hd = rdW + upE * cg, ax = normalize(cross(upE, vec3(0., 0., 1.))), ay = cross(ax, upE);
                  // around the vertical of the eye (0..1), and along the fall; cells of the same size in pixels everywhere:
                  // two grids, one twice as fine as the other, pass into each other
                  float az = atan(dot(hd, ax), dot(hd, ay)) / 6.2831853 + .5, vv = log(sg / (1. + cg + 1e-4));
                  float L = log2(sg * 6.2831853 / (uRpp * 7.)), Lb = L - 1.8, kb = floor(Lb), ab = az + uRain.z * .0003, bands = .5;
                  if (uRain.w < 1.) bands = mix(.5, mix(wxBands(ab, exp2(kb)), wxBands(ab, exp2(kb + 1.)), Lb - kb), smoothstep(2., 3.5, Lb));
                  // (near the ground the veil stays thin, so that the map under the rain can be read, and has no streaks)
                  veil = min(veil * mix(mix(.66 + .68 * bands, .8 + .4 * bands, sf), 1., uRain.w), mix(.9, .38 + .1 * sf, uRain.w));
                  // (the curtain is a darker, bluer grey than its cloud from afar; near the ground it is a pale mist;
                  // by night it is only a little lighter than the dark land. A curtain of snow is white and soft.)
                  vec3 air = mix((albumSkyCol() * .6 + albumSunCol() * .08 + albumMoonCol() * .25) * mix(.52, 1., uRain.w), albumSkyCol() + albumSunCol() * .3 + albumMoonCol() * .45, sf);
                  vec3 rc = albumFinish(mix(air * mix(.4, 1., albumDay()), albumHorizon(rdW), albumHaze(uEye + rdW * mix(t0, t1, .5))));
                  c = mix(c, rc, veil);
                  if (uRain.w > 0.) {
                    float k = floor(L), fall = 0.;
                    // (lines of rain or flakes of snow, never both in one pixel: sleet is a narrow strip of the slope)
                    if (sf < .5) fall = mix(wxLines(az, vv, exp2(k)), wxLines(az, vv, exp2(k + 1.)), L - k) * (1. - sf);
                    else fall = mix(wxFlakes(az, vv, exp2(k)), wxFlakes(az, vv, exp2(k + 1.)), L - k) * sf * 1.6;
                    c += fall * smoothstep(3., 4.5, L) * veil * uRain.w * (.12 + .3 * albumDay()) * vec3(.92, .96, 1.);
                  }
                }
              }
            }
          }`;
const frag = f => /* glsl */`uniform vec3 uEye;
        ${f ? HEAD : ''}${f & RAIN ? RAIN_FN : ''}
        uniform sampler2D tCol, tDepth; uniform vec2 uPx; uniform float uNear, uFar, uProj, uRad, uAO, uSharp, uVig; uniform mat4 uInvProj, uCamWorld; varying vec2 vUv;
        float vz(vec2 uv) { float z = texture(tDepth, uv).r * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 c = texture(tCol, vUv).rgb; float z0 = vz(vUv), ao = 0.;
          if (uAO > 0. && z0 < uFar * .97) {
            float r = clamp(uRad * uProj / z0, 2., 26.), a0 = hash(gl_FragCoord.xy) * 6.283;
            vec2 grad = vec2(vz(vUv + vec2(uPx.x, 0.)) - vz(vUv - vec2(uPx.x, 0.)), vz(vUv + vec2(0., uPx.y)) - vz(vUv - vec2(0., uPx.y))) * .5;   // the surface as a plane
            // Toward the horizon one pixel spans kilometres of depth, and the depth written there is not exact: it is
            // off by a small part of that span from one triangle to the next, and the levels of the land's grid lie
            // half such a span apart (they are pushed back in depth so as not to flicker). So only what stands out
            // of the plane by more than the span of a pixel counts as standing in the way, and where that span
            // outgrows the reach of the shade there is no shade at all. Without this the horizon was all grain, with
            // dark lines along the borders of the grid's levels.
            // And nothing lower than 40 m counts at all: a house, a town wall, the bank of a river have no shade around
            // them (the owner, 13.11.2026: shadows come from mountains and relief only); cliffs and gullies keep theirs.
            float span = length(grad), lo = max(max(uRad * .05, span * .8), .04), keep = 1. - smoothstep(uRad * .5, uRad * 1.6, span);
            if (keep > 0.) {
              for (int i = 0; i < 8; i++) {
                float a = a0 + float(i) * .7854; vec2 o = vec2(cos(a), sin(a)) * r * (.4 + .6 * fract(float(i) * .618 + .3));
                float dz = z0 + dot(grad, o) - vz(vUv + o * uPx);                 // above the plane = something stands in the way
                ao += smoothstep(lo, lo + uRad * .5, dz) * (1. - smoothstep(uRad * 1.6, uRad * 4.5, dz));
              }
              ao *= keep / 8.;
            }
          }
          c *= 1. - uAO * ao * .8;
          vec3 n4 = (texture(tCol, vUv + vec2(uPx.x, 0.)).rgb + texture(tCol, vUv - vec2(uPx.x, 0.)).rgb + texture(tCol, vUv + vec2(0., uPx.y)).rgb + texture(tCol, vUv - vec2(0., uPx.y)).rgb) * .25;
          c = clamp(c + (c - n4) * uSharp, 0., 1.);${f ? RAY : ''}${f & RAIN ? WET : ''}${f & FOG ? FOGGY : ''}${f & CLOUDS ? SHADE : ''}${f & RAIN ? RAINY : ''}
          vec2 q = vUv - .5; c *= 1. - uVig * dot(q, q) * 1.5;
          gl_FragColor = vec4(c, 1.);
        }`;

// (for the tests: the text of the pass for a set of weather)
export const postShader = frag, POST_CLOUDS = CLOUDS, POST_RAIN = RAIN, POST_FOG = FOG;

export class Post {
  // T: the uniforms of the ground (album.terrain.u), for the light the weather is counted with
  constructor(renderer, T) {
    this.renderer = renderer; this.T = T;
    this.rt = new WebGLRenderTarget(4, 4, { samples: 4, minFilter: LinearFilter, magFilter: LinearFilter });
    this.rt.depthTexture = new DepthTexture(4, 4, UnsignedIntType); this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = NearestFilter;
    this.uniforms = { ...(T ? lightUniforms(T) : {}), ...WX, uExag: T?.uExag || { value: 1.6 }, tCol: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, uPx: { value: new Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 }, uProj: { value: 1000 },
      uRad: { value: .1 }, uAO: { value: .8 }, uSharp: { value: .3 }, uVig: { value: .35 }, uRpp: { value: .0005 }, uEye: { value: new Vector3() }, uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() } };
    // One shader of the pass for every set of weather that is on, all with the same uniforms, each made when it is
    // first needed. With no weather the plain one is used.
    this.mats = new Map(); this.mat = this.material(0);
    this.scene = new Scene(); this.cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false; this.scene.add(this.quad);
  }
  material(flags) {
    if (!this.mats.has(flags)) this.mats.set(flags, new ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: this.uniforms, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: frag(flags) }));
    return this.mats.get(flags);
  }
  // which weather is on now (the sky layer sets it every frame: aspects/sky.js)
  weather() {
    if (!this.T || !WX.tCloud.value) return 0;
    const clouds = this.T.uCloud?.value.x > 0;
    return (clouds ? CLOUDS : 0) | (clouds && WX.uRain.value.x > 0 ? RAIN : 0) | (WX.uFog.value.x > 0 && WX.tFog.value ? FOG : 0);
  }
  // fewer samples when the machine is struggling (the album has already halved its picture scale)
  setSamples(n) { if (this.rt.samples !== n) { this.rt.samples = n; this.rt.dispose(); } }
  render(scene, camera, heightKm, ao, sharp) {
    const r = this.renderer, size = r.getDrawingBufferSize(new Vector2()), u = this.uniforms;
    if (this.rt.width !== size.x || this.rt.height !== size.y) this.rt.setSize(size.x, size.y);
    u.uPx.value.set(1 / size.x, 1 / size.y); u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uProj.value = size.y / (2 * Math.tan(camera.fov * Math.PI / 360)); u.uRad.value = heightKm * .0065; u.uAO.value = ao; u.uSharp.value = sharp;
    u.uRpp.value = 2 * Math.tan(camera.fov * Math.PI / 360) / size.y * Math.max(1, size.y / 1400);
    u.uEye.value.copy(camera.position); u.uInvProj.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld);
    this.quad.material = this.material(this.weather());
    r.setRenderTarget(this.rt); r.render(scene, camera);
    r.setRenderTarget(null); r.render(this.scene, this.cam);
  }
}
