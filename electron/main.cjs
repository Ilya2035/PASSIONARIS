// Passionaris desktop wrapper: launcher window -> game window.
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const { registerSaveIpc } = require('./saves.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// Laptops with two GPUs: ask Chromium for the discrete one (settings "gpu": 'discrete' (default) | 'auto').
const startupSettings = (() => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')); } catch { return {}; } })();
const gpuPref = process.env.PASSIONARIS_GPU || startupSettings.gpu || 'discrete';
const safeGpu = process.argv.includes('--passionaris-safe-gpu');
if (gpuPref === 'discrete' && !safeGpu) app.commandLine.appendSwitch('force_high_performance_gpu');
// Some systems (restricted accounts, sandboxed shells, odd drivers) crash Chromium's GPU process at start-up.
// If it keeps crashing, restart once in "safe GPU" mode: no forced adapter, no GPU sandbox — instead of running without WebGL.
let gpuCrashes = 0;
app.on('child-process-gone', (_e, d) => {
  if (process.env.PASSIONARIS_GPU_DEBUG) console.log('[gpu]', d.type, d.reason, d.exitCode);
  if (d.type !== 'GPU' || d.reason === 'clean-exit') return;
  if (++gpuCrashes >= 2 && !safeGpu) {
    const args = process.argv.slice(1).filter(a => a !== '--disable-gpu-sandbox');
    app.relaunch({ args: args.concat(['--disable-gpu-sandbox', '--passionaris-safe-gpu']) });
    app.exit(0);
  }
});

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');
const DEV_URL = process.env.PASSIONARIS_DEV_URL; // e.g. http://localhost:5173 for live reload
const pageUrl = page => (DEV_URL ? `${DEV_URL}/${page}` : `app://passionaris/${page}`);

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
const writeSettings = s => { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); };

const ICON = path.join(PUBLIC, "assets", "ui", "icon.png");
if (process.platform === "win32") app.setAppUserModelId("Passionaris");
const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false };
let launcher = null;
let game = null;

function createLauncher() {
  launcher = new BrowserWindow({
    width: 1240, height: 740, minWidth: 960, minHeight: 600,
    frame: false, backgroundColor: '#121211', show: false, title: 'Passionaris', icon: ICON, webPreferences,
  });
  launcher.once('ready-to-show', () => launcher.show());
  launcher.on('closed', () => { launcher = null; });
  launcher.loadURL(pageUrl('index.html'));
}

function createGame(settings) {
  const mode = settings?.windowMode || 'fullscreen';
  game = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 640,
    fullscreen: mode === 'fullscreen', autoHideMenuBar: true,
    backgroundColor: '#121211', show: false, title: 'Passionaris', icon: ICON, webPreferences,
  });
  game.once('ready-to-show', () => { if (mode === 'maximized') game.maximize(); game.show(); game.focus(); });
  game.on('closed', () => { game = null; });
  if (process.env.PASSIONARIS_SMOKE) game.webContents.on('console-message', e => console.log('[smoke] game console:', e.message));
  game.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { game.setFullScreen(!game.isFullScreen()); e.preventDefault(); }
  });
  game.loadURL(pageUrl('game.html'));
}

app.whenReady().then(() => {
  protocol.handle('app', async req => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    for (const base of [DIST, PUBLIC]) {
      const file = path.normalize(path.join(base, rel));
      if (!file.startsWith(base)) continue;
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return net.fetch(pathToFileURL(file).toString());
    }
    return new Response('Not found', { status: 404 });
  });

  // saves live in %APPDATA%/Passionaris/saves; deleting moves the file to the recycle bin
  registerSaveIpc(ipcMain, app, { trashItem: p => shell.trashItem(p) });
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', (_e, s) => { writeSettings(s); return true; });
  ipcMain.on('game:launch', (_e, s) => {
    if (s) writeSettings(s);
    if (!game) createGame(s || readSettings());
    launcher?.close();
  });
  ipcMain.on('game:exit-to-launcher', () => {
    if (!launcher) createLauncher();
    game?.close();
  });
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('win:minimize', e => BrowserWindow.fromWebContents(e.sender)?.minimize());

  if (CAPTURE) { captureShot(JSON.parse(CAPTURE)); return; }
  createLauncher();
  if (SMOKE) smokeTest();
});

// PASSIONARIS_CAPTURE={"query":"lat=..&lon=..","width":2560,"height":1440,"out":"file.png"}
// renders game.html?shot=1&<query> in an offscreen-sized window and saves one frame (menu art, docs)
const CAPTURE = process.env.PASSIONARIS_CAPTURE;
async function captureShot({ query, width = 2560, height = 1440, out, evaluate }) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, frame: false, paintWhenInitiallyHidden: true, backgroundColor: '#121211', webPreferences });
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.log('[capture] console:', e.level, e.message); });
  await win.loadURL(`${pageUrl('game.html')}?shot=1&${query}`);
  for (let i = 0; i < 240; i++) {
    if (await win.webContents.executeJavaScript('!!(window.__game && window.__game.ready)').catch(() => false)) break;
    await wait(250);
  }
  await wait(2500); // let streaming/fades settle
  if (evaluate) console.log('[capture] eval:', await win.webContents.executeJavaScript(evaluate).catch(e => 'ERR ' + e.message));
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log('[capture] saved', out);
  app.quit();
}

// PASSIONARIS_SMOKE=<folder>: open launcher -> press Play -> wait for the map -> save screenshots -> quit
const SMOKE = process.env.PASSIONARIS_SMOKE;
async function smokeTest() {
  const shot = async (win, name) => fs.writeFileSync(path.join(SMOKE, name), (await win.webContents.capturePage()).toPNG());
  const log = (...a) => console.log('[smoke]', ...a);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  try {
    fs.mkdirSync(SMOKE, { recursive: true });
    await new Promise(r => launcher.webContents.once('did-finish-load', r));
    await wait(2500);
    await shot(launcher, 'smoke-launcher.png');
    log('launcher ok');
    await launcher.webContents.executeJavaScript("document.getElementById('play').click()");
    for (let i = 0; i < 60 && !game; i++) await wait(250);
    game.webContents.on('console-message', (e, level, msg) => log('game console:', e.message ?? msg));
    game.webContents.on('did-fail-load', (_e, code, desc, url) => log('load failed', code, desc, url));
    for (let i = 0; i < 120; i++) {
      await wait(500);
      const ready = await game.webContents.executeJavaScript('!!window.__game').catch(() => false);
      if (ready) break;
      if (i % 10 === 9) {
        log('waiting…', await game.webContents.executeJavaScript("document.getElementById('load-version')?.textContent + ' | ' + (document.getElementById('load-fill')?.style.width)").catch(e => e.message));
        if (i === 9) {
          const t = expr => game.webContents.executeJavaScript(`Promise.race([(${expr}).catch(e => 'ERR ' + e.message), new Promise(r => setTimeout(() => r('timeout'), 5000))])`).catch(e => e.message);
          log('arrayBuffer:', await t("fetch('assets/map/world.json').then(r => r.arrayBuffer()).then(b => b.byteLength)"));
          log('reader:', await t("fetch('assets/map/world.json').then(r => r.body.getReader().read()).then(x => x.done + ' ' + (x.value && x.value.length))"));
          log('albedo:', await t("new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i.width); i.onerror = () => rej(new Error('img')); i.src = 'assets/map/albedo.jpg'; })"));
        }
      }
    }
    await wait(3000);
    const gpu = await game.webContents.executeJavaScript(`(() => { const gl = window.__game.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })()`);
    const fps = await game.webContents.executeJavaScript("(window.__game && window.__game.ready) ? 'ready' : 'not ready'");
    log('gpu:', gpu, '| fps:', fps);
    // frame-rate probe: globe view, then a close tilted view with the detail window
    const probe = q => game.webContents.executeJavaScript(`(async () => { const g = window.__game; ${q}; await new Promise(r => setTimeout(r, 1500)); let n = 0; const t0 = performance.now(); await new Promise(r => { const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); return (n / ((performance.now() - t0) / 1000)).toFixed(1); })()`);
    log('fps globe:', await probe('g.gcam.lookAt(30, 20, 2.2); g.gcam.alt = 2.2'));
    log('fps close:', await probe('g.gcam.lookAt(46.4, 9, 0.012); g.gcam.alt = 0.012'));
    // time flow: speed 5 for 3 s, then read the HUD date
    log('time:', await game.webContents.executeJavaScript(`(async () => { const w = window.__game.world; if (!w.clock) return 'no clock'; const d0 = document.getElementById('clock-date').textContent; w.setSpeed(5); await new Promise(r => setTimeout(r, 3000)); const d1 = document.getElementById('clock-date').textContent; w.setSpeed(0); return d0 + ' -> ' + d1 + ' | t=' + w.clock.t.toFixed(1); })()`));
    if (process.env.PASSIONARIS_EVAL) {
      // PASSIONARIS_EVAL=<file.js>: evaluate a script in the running game (visible window, real frame rate)
      log('eval:', await game.webContents.executeJavaScript(fs.readFileSync(process.env.PASSIONARIS_EVAL, 'utf8')).catch(e => 'ERR ' + e.message));
    }
    if (process.env.PASSIONARIS_SAVETEST) {
      // save -> run on -> load: the clock (and the weather snapshot) must come back
      log('savetest:', await game.webContents.executeJavaScript(`(async () => {
        const w = window.__game.world, sleep = ms => new Promise(r => setTimeout(r, ms));
        w.setSpeed(3); await sleep(2500); w.setSpeed(0);
        const t0 = w.clock.t; await w.quickSave(); await sleep(500);
        w.setSpeed(4); await sleep(2500); w.setSpeed(0);
        const t1 = w.clock.t; await w.quickLoad(); await sleep(1500);
        const t2 = w.clock.t;
        const toasts = [...document.querySelectorAll('#toasts .toast')].map(e => e.textContent).join(' | ');
        // the test's quick save was written by the test: remove it so the player's save list stays clean
        await w.time.storage.remove(w.time.quickSaveId).catch(() => {});
        return 'saved t=' + t0.toFixed(2) + ', moved to ' + t1.toFixed(2) + ', loaded t=' + t2.toFixed(2) + ' | ' + toasts;
      })()`));
    }
    if (process.env.PASSIONARIS_PERF2) {
      // what each layer costs at the globe view and up close (PASSIONARIS_PERF2=1 with PASSIONARIS_SMOKE)
      const g0 = 'g.gcam.lookAt(30, 20, 2.2); g.gcam.alt = 2.2';
      const g1 = 'g.gcam.lookAt(46.4, 9, 0.012); g.gcam.alt = 0.012';
      log('perf2 globe base:', await probe(g0), '| dyn scale', await game.webContents.executeJavaScript('window.__game.dynScale'));
      log('perf2 globe scale 1.0:', await probe(g0 + '; g.settings.renderScale = 1'));
      log('perf2 globe scale 0.5:', await probe(g0 + '; g.settings.renderScale = 0.5'));
      log('perf2 globe no weather:', await probe(g0 + '; g.globe.terrainMat.uniforms.uHasWeather.value = 0'));
      log('perf2 globe dense mesh:', await probe(g0 + '; g.globe.terrainMat.uniforms.uHasWeather.value = 1; g.globe.forceNear = true; g.globe.terrainFar.visible = false; g.globe.terrainNear.visible = true; g.globe.terrainMat.uniforms.uRings.value = g.globe.rings'));
      log('perf2 close scale 0.5:', await probe(g1 + '; g.globe.forceNear = false'));
      log('perf2 close scale 1.0:', await probe(g1 + '; g.settings.renderScale = 1'));
      await game.webContents.executeJavaScript("window.__game.settings.renderScale = 'auto'");
    }
    if (process.env.PASSIONARIS_PERF) {
      log('settings:', await game.webContents.executeJavaScript('JSON.stringify({q: window.__game.settings.qualityResolved, rs: window.__game.settings.renderScale, dyn: window.__game.dynScale, size: [innerWidth, innerHeight, devicePixelRatio]})'));
      log('fps close @50%:', await probe('g.settings.renderScale = 0.5'));
      log('fps close @50% no detail:', await probe('g.detail.update = () => { g.globe.shared.uDetailOn.value = 0; }'));
      log('fps close @50% no detail, mesh hidden:', await probe('g.globe.terrain.visible = false'));
    }
    await shot(game, 'smoke-game.png');
    log('game ok');
  } catch (e) {
    log('FAILED', e.message);
  }
  app.quit();
}

app.on('window-all-closed', () => app.quit());
