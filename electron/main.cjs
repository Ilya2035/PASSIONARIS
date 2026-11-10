// Passionaris desktop wrapper: launcher window -> game window.
const { app, BrowserWindow, ipcMain, protocol, net, shell, screen } = require('electron');
const { registerSaveIpc } = require('./saves.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// Tests and agents: PASSIONARIS_USERDATA=<dir> keeps settings and saves away from the player's own folder,
// PASSIONARIS_DIST=<dir> serves a separately built copy of the pages (parallel builds do not clash).
if (process.env.PASSIONARIS_USERDATA) app.setPath('userData', path.resolve(process.env.PASSIONARIS_USERDATA));

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
const DIST = process.env.PASSIONARIS_DIST ? path.resolve(process.env.PASSIONARIS_DIST) : path.join(ROOT, 'dist');
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

// ---------------------------------------------------------------- window geometry
// settings.resolution: 'native' | 'WxH' in PHYSICAL pixels (what a game calls a resolution; a 150% display turns
// 1920×1080 into a 1280×720-DIP window). Window mode: the window's picture (content) is that size, scaled down to fit
// the display's work area with the same aspect, and centred. Fullscreen / maximized: the window covers the screen and
// the renderer draws at that resolution and upscales (src/game/main.js). 'native' in window mode = 1600×900 DIP.
const parseRes = r => { const m = /^(\d{3,5})x(\d{3,5})$/.exec(String(r || '')); return m ? { w: +m[1], h: +m[2] } : null; };
const MIN_GAME = { w: 640, h: 400 };
const FRAME_GUESS = { w: 16, h: 39 }; // Windows 11: 8-DIP side borders, 31-DIP title bar
// frame = outer size minus content size (title bar, borders) in DIP; measured on a live window when it has one
function contentBoundsFor(s, display, frame = FRAME_GUESS) {
  const wa = display.workArea, sf = display.scaleFactor || 1, r = parseRes(s?.resolution);
  let w = r ? r.w / sf : 1600, h = r ? r.h / sf : 900;
  const k = Math.min(1, (wa.width - frame.w) / w, (wa.height - frame.h) / h);
  w = Math.max(Math.min(MIN_GAME.w, wa.width - frame.w), Math.round(w * k));
  h = Math.max(Math.min(MIN_GAME.h, wa.height - frame.h), Math.round(h * k));
  // centre the whole window (content + frame) in the work area; the title bar sits above the content
  const x = Math.round(wa.x + (wa.width - w - frame.w) / 2 + frame.w / 2);
  const y = Math.round(wa.y + (wa.height - h - frame.h) / 2 + (frame.h - frame.w / 2));
  return { x, y, width: w, height: h };
}
const displayOf = win => (win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
const nextEvent = (win, ev, ms = 1500) => new Promise(res => {
  const done = () => { clearTimeout(t); win.removeListener(ev, done); res(); };
  const t = setTimeout(done, ms);
  win.once(ev, done);
});
// Live switch from the in-game settings (and the same rules as at launch): 'fullscreen' | 'maximized' | 'window'.
let applying = Promise.resolve();
function applyWindow(win, s) {
  applying = applying.then(async () => {
    if (!win || win.isDestroyed()) return;
    const mode = s?.windowMode || 'fullscreen';
    if (mode === 'fullscreen') { if (!win.isFullScreen()) win.setFullScreen(true); return; }
    if (win.isFullScreen()) { const p = nextEvent(win, 'leave-full-screen'); win.setFullScreen(false); await p; await new Promise(r => setTimeout(r, 60)); }
    if (mode === 'maximized') { if (!win.isMaximized()) win.maximize(); return; }
    if (win.isMaximized()) { const p = nextEvent(win, 'unmaximize'); win.unmaximize(); await p; }
    const [ow, oh] = win.getSize(), [cw, ch] = win.getContentSize();
    const frame = ow > cw || oh > ch ? { w: ow - cw, h: oh - ch } : undefined;
    win.setContentBounds(contentBoundsFor(s, displayOf(win), frame));
  }).catch(e => console.warn('[window]', e.message));
  return applying.then(() => true);
}

function createLauncher() {
  // fits small screens: at most 92% of the work area of the screen under the cursor
  const wa = displayOf(null).workArea;
  const width = Math.min(1240, Math.round(wa.width * 0.92)), height = Math.min(740, Math.round(wa.height * 0.92));
  launcher = new BrowserWindow({
    width, height, minWidth: Math.min(960, width), minHeight: Math.min(600, height),
    x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2),
    frame: false, backgroundColor: '#121211', show: false, title: 'Passionaris', icon: ICON, webPreferences,
  });
  launcher.once('ready-to-show', () => launcher.show());
  launcher.on('closed', () => { launcher = null; });
  launcher.loadURL(pageUrl('index.html'));
}

function createGame(settings, page = 'game.html') {
  const mode = settings?.windowMode || 'fullscreen';
  // open on the launcher's screen; window mode gets its resolution as the content size right away
  const display = displayOf(launcher);
  const wa = display.workArea;
  let geo;
  if (mode === 'window') {
    // width/height are the content (useContentSize); x/y place the outer window
    const c = contentBoundsFor(settings, display);
    geo = { width: c.width, height: c.height, x: c.x - FRAME_GUESS.w / 2, y: c.y - (FRAME_GUESS.h - FRAME_GUESS.w / 2) };
  } else {
    const w = Math.min(1600, wa.width), h = Math.min(900, wa.height);
    geo = { width: w, height: h, x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2) };
  }
  game = new BrowserWindow({
    ...geo, useContentSize: mode === 'window',
    minWidth: Math.min(MIN_GAME.w, wa.width), minHeight: Math.min(MIN_GAME.h, wa.height),
    fullscreen: mode === 'fullscreen', autoHideMenuBar: true,
    backgroundColor: '#121211', show: false, title: 'Passionaris', icon: ICON, webPreferences,
  });
  game.once('ready-to-show', () => { if (mode === 'maximized') game.maximize(); game.show(); game.focus(); });
  game.on('closed', () => { game = null; });
  if (process.env.PASSIONARIS_SMOKE) game.webContents.on('console-message', e => console.log('[smoke] game console:', e.message));
  game.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { game.setFullScreen(!game.isFullScreen()); e.preventDefault(); }
  });
  game.loadURL(pageUrl(page));
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
  // the graphics album opens in the game window's place; its marks go to a text file next to the settings
  ipcMain.on('album:open', () => { if (!game) createGame(readSettings(), 'album.html'); launcher?.close(); });
  ipcMain.handle('album:feedback', (_e, text) => { const f = path.join(app.getPath('userData'), 'album-feedback.txt'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(text).slice(0, 200000)); return f; });
  ipcMain.on('app:quit', () => app.quit());
  // screens for the resolution list: logical size, scale factor (Windows display scaling), refresh rate
  ipcMain.handle('app:displays', () => screen.getAllDisplays().map(d => ({ id: d.id, width: d.size.width, height: d.size.height, scale: d.scaleFactor, hz: d.displayFrequency, primary: d.id === screen.getPrimaryDisplay().id })));
  ipcMain.handle('app:open-saves-folder', async () => { const dir = path.join(app.getPath('userData'), 'saves'); fs.mkdirSync(dir, { recursive: true }); return shell.openPath(dir); });
  ipcMain.handle('app:info', () => ({ userData: app.getPath('userData'), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome }));
  ipcMain.on('win:minimize', e => BrowserWindow.fromWebContents(e.sender)?.minimize());
  // in-game settings: window mode and resolution applied live (only the game window, only these two keys)
  ipcMain.handle('win:apply', (e, s) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win !== game) return false;
    return applyWindow(win, { windowMode: String(s?.windowMode || 'fullscreen'), resolution: String(s?.resolution || 'native') });
  });
  ipcMain.handle('win:state', e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    const d = displayOf(win);
    return { fullscreen: win.isFullScreen(), maximized: win.isMaximized(), bounds: win.getBounds(), content: win.getContentBounds(), workArea: d.workArea, scale: d.scaleFactor };
  });

  if (CAPTURE) { captureShot(JSON.parse(CAPTURE)); return; }
  createLauncher();
  if (SMOKE) smokeTest();
});

// PASSIONARIS_CAPTURE={"query":"lat=..&lon=..","width":2560,"height":1440,"out":"file.png"}
// renders game.html?shot=1&<query> in an offscreen-sized window and saves one frame (menu art, docs)
const CAPTURE = process.env.PASSIONARIS_CAPTURE;
async function captureShot({ query, width = 2560, height = 1440, out, evaluate, page }) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, frame: false, paintWhenInitiallyHidden: true, backgroundColor: '#121211', webPreferences });
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.log('[capture] console:', e.level, e.message); });
  // Sizes the screen cannot hold (Windows clamps even hidden windows to the desktop), or dpr=N in the query:
  // emulate the viewport (CSS size width×height at devicePixelRatio N) through the DevTools protocol and take the
  // shot from it — e.g. "…&dpr=1" 3840 2160 = a 4K monitor at 100% display scaling.
  const disp = screen.getPrimaryDisplay();
  const dprQ = Number(new URLSearchParams(query || '').get('dpr')) || 0;
  let dbg = null;
  if (dprQ || width > disp.workAreaSize.width || height > disp.workAreaSize.height) {
    const limit = (p, ms, what) => Promise.race([p, wait(ms).then(() => { throw new Error(what + ' timed out'); })]);
    try {
      await limit(win.loadURL('about:blank'), 10000, 'blank page');
      dbg = win.webContents.debugger;
      dbg.attach('1.3');
      await limit(dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dprQ || disp.scaleFactor, mobile: false, screenWidth: width, screenHeight: height }), 10000, 'metrics override');
      console.log('[capture] emulated viewport', width, 'x', height, '@', dprQ || disp.scaleFactor);
    } catch (e) { console.log('[capture] emulation failed:', e.message); try { dbg?.detach(); } catch { /* not attached */ } dbg = null; }
  }
  // page: another page (e.g. 'index.html', the launcher) captured as it is, after a short settle
  await win.loadURL(page ? `${pageUrl(page)}${query ? '?' + query : ''}` : `${pageUrl('game.html')}?shot=1&${query}`);
  // the graphics album (album.html) raises its own ready flag once the data is on screen
  const albumPage = !!page && page.startsWith('album');
  if (albumPage) win.webContents.on('console-message', e => { if (String(e.message).startsWith('[album]')) console.log('[capture]', e.message); });
  for (let i = 0; i < 480 && (!page || albumPage); i++) {
    if (await win.webContents.executeJavaScript(albumPage ? '!!(window.__album && window.__album.ready)' : '!!(window.__game && window.__game.ready)').catch(() => false)) break;
    await wait(250);
  }
  await wait(2500); // let streaming/fades settle
  if (evaluate) {
    console.log('[capture] eval:', await win.webContents.executeJavaScript(evaluate).catch(e => 'ERR ' + e.message));
    // let what the script changed reach the screen (a slow GPU may draw only a few frames per second)
    await win.webContents.executeJavaScript('Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))), new Promise(r => setTimeout(r, 4000))])').catch(() => {});
    await wait(300);
  }
  let png = null;
  if (dbg) png = await Promise.race([dbg.sendCommand('Page.captureScreenshot', { format: 'png' }).then(r => Buffer.from(r.data, 'base64')), wait(20000).then(() => null)]).catch(e => { console.log('[capture] cdp shot failed:', e.message); return null; });
  fs.writeFileSync(out, png || (await win.webContents.capturePage()).toPNG());
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
