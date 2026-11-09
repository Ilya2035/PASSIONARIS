import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '../shared/theme.css';
import './launcher.css';
import * as THREE from 'three';
import changelogMd from '../../CHANGELOG.md?raw';
import { APP_NAME, VERSION, VERSION_LABEL, EPOCH_LABEL } from '../shared/version.js';
import { loadSettings, saveSettings, isElectron, DEFAULT_SETTINGS } from '../shared/settings.js';

const $ = id => document.getElementById(id);
if (!isElectron) document.body.classList.add('browser');
document.title = `${APP_NAME} ${VERSION_LABEL} — лаунчер`;
$('ver').textContent = VERSION_LABEL;
$('epoch').textContent = EPOCH_LABEL;
$('foot-ver').textContent = `${APP_NAME} ${VERSION_LABEL}`;

// ------------------------------------------------------------- changelog
function mdToHtml(md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  let html = '', inList = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^- /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^## /.test(line)) html += `<h3>${inline(line.slice(3))}</h3>`;
    else if (/^### /.test(line)) html += `<h4>${inline(line.slice(4))}</h4>`;
    else if (line.trim() && !/^# /.test(line)) html += `<p>${inline(line)}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}
const sections = changelogMd.split(/^(?=## )/m).filter(s => s.startsWith('## '));
const versionOf = s => (s.match(/^## \[?v?([\d.]+)/) || [])[1];
const select = $('version-select');
for (const s of sections) {
  const v = versionOf(s); if (!v) continue;
  const o = document.createElement('option');
  o.value = v; o.textContent = `v${v}${v === VERSION ? ' · текущая' : ''}`;
  select.appendChild(o);
}
const showVersion = v => { $('changelog').innerHTML = mdToHtml(sections.find(s => versionOf(s) === v) || sections[0] || ''); };
select.onchange = () => showVersion(select.value);
select.value = VERSION;
showVersion(VERSION);

// ------------------------------------------------------------- roadmap of epoch 0
const ROADMAP = [
  ['Обёртка (Electron) и лаунчер', 'done'],
  ['Глобус и 3D-карта высот', 'done'],
  ['Природные области (реки, горы)', ''],
  ['Куски ~100 км² и морские зоны', ''],
  ['Границы всех эпох', ''],
  ['Погода и климат', ''],
  ['Визуализация и стиль', 'wip'],
  ['Ход времени', ''],
  ['Сохранение и загрузка', ''],
  ['Старые и новые версии', ''],
  ['Оптимизация', ''],
];
$('roadmap').innerHTML = ROADMAP.map(([t, s]) => `<li class="${s}">${t}</li>`).join('');

// ------------------------------------------------------------- settings
const settings = await loadSettings();
const fields = [
  ['s-window', 'windowMode', String],
  ['s-quality', 'quality', String],
  ['s-pixel', 'pixelRatio', Number],
  ['s-relief', 'reliefScale', Number],
  ['s-unroll', 'unroll', Number],
];
const syncFields = () => { for (const [id, key] of fields) $(id).value = String(settings[key]); };
syncFields();
for (const [id, key, parse] of fields) $(id).addEventListener('input', () => { settings[key] = parse($(id).value); saveSettings(settings); });
$('open-settings').onclick = () => $('settings').classList.add('open');
$('s-close').onclick = () => $('settings').classList.remove('open');
$('s-reset').onclick = () => { Object.assign(settings, DEFAULT_SETTINGS); syncFields(); saveSettings(settings); };
$('settings').addEventListener('click', e => { if (e.target === $('settings')) $('settings').classList.remove('open'); });

// ------------------------------------------------------------- actions
$('play').onclick = async () => {
  await saveSettings(settings);
  if (isElectron) window.orbis.launch(settings);
  else location.href = './game.html';
};
$('quit').onclick = () => { if (isElectron) window.orbis.quit(); else window.close(); };
$('win-close').onclick = () => window.orbis?.quit();
$('win-min').onclick = () => window.orbis?.minimize();

// ------------------------------------------------------------- background globe
const canvas = $('bg');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#04070d');
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 0, 5.4);

const tex = new THREE.TextureLoader().load('assets/map/albedo-2k.jpg');
tex.anisotropy = 8;
const globeMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: { uTex: { value: tex } },
  vertexShader: `out vec2 vUv; out vec3 vN; out vec3 vW;
    void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `precision highp float; uniform sampler2D uTex; in vec2 vUv; in vec3 vN; in vec3 vW; layout(location=0) out vec4 o;
    void main(){
      vec3 c = pow(texture(uTex, vUv).rgb, vec3(0.85));
      vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
      vec3 L = normalize(vec3(-0.6, 0.45, 0.65));
      float d = clamp(dot(N, L), 0.0, 1.0);
      float lit = 0.08 + 1.05 * d;
      float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
      vec3 col = c * lit + vec3(0.35, 0.55, 0.95) * rim * (0.25 + 0.75 * d);
      o = vec4(col, 1.0);
    }`,
});
const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), globeMat);
const tiltGroup = new THREE.Group();
tiltGroup.rotation.z = THREE.MathUtils.degToRad(23.4);
tiltGroup.add(globe);
scene.add(tiltGroup);
const halo = new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 32), new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `out vec3 vN; out vec3 vW; void main(){ vN = normalize(normal); vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `precision highp float; in vec3 vN; in vec3 vW; layout(location=0) out vec4 o;
    void main(){ float r = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))); float a = pow(r, 4.0) * 1.1; o = vec4(vec3(0.4,0.62,1.0)*a, a); }`,
}));
scene.add(halo);
{
  const n = 3500, pos = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.randomDirection().multiplyScalar(30); pos.set([v.x, v.y, v.z], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc8d0e0, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.7 })));
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // keep the globe on the right side of the window
  camera.setViewOffset(w, h, -w * 0.18, 0, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
const timer = new THREE.Timer();
renderer.setAnimationLoop(ts => {
  timer.update(ts);
  globe.rotation.y = 2.2 + timer.getElapsed() * 0.04;
  renderer.render(scene, camera);
});
