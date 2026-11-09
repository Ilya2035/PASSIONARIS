// ORBIS desktop wrapper: launcher window -> game window.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// laptops with two GPUs: ask for the discrete one
if (process.env.ORBIS_GPU === 'discrete') app.commandLine.appendSwitch('force_high_performance_gpu');
// Some systems (restricted accounts, sandboxed shells) kill Chromium's GPU sandbox at start-up.
// If the GPU process keeps crashing, restart once without the GPU sandbox instead of running without WebGL.
let gpuCrashes = 0;
app.on('child-process-gone', (_e, d) => {
  if (process.env.ORBIS_GPU_DEBUG) console.log('[gpu]', d.type, d.reason, d.exitCode);
  if (d.type !== 'GPU' || d.reason === 'clean-exit') return;
  if (++gpuCrashes >= 2 && !app.commandLine.hasSwitch('disable-gpu-sandbox')) {
    app.relaunch({ args: process.argv.slice(1).concat(['--disable-gpu-sandbox']) });
    app.exit(0);
  }
});

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');
const DEV_URL = process.env.ORBIS_DEV_URL; // e.g. http://localhost:5173 for live reload
const pageUrl = page => (DEV_URL ? `${DEV_URL}/${page}` : `app://orbis/${page}`);

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
const writeSettings = s => { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); };

const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false };
let launcher = null;
let game = null;

function createLauncher() {
  launcher = new BrowserWindow({
    width: 1240, height: 740, minWidth: 960, minHeight: 600,
    frame: false, backgroundColor: '#04070d', show: false, title: 'ORBIS', webPreferences,
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
    backgroundColor: '#04070d', show: false, title: 'ORBIS', webPreferences,
  });
  game.once('ready-to-show', () => { if (mode === 'maximized') game.maximize(); game.show(); game.focus(); });
  game.on('closed', () => { game = null; });
  if (process.env.ORBIS_SMOKE) game.webContents.on('console-message', e => console.log('[smoke] game console:', e.message));
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

  createLauncher();
  if (SMOKE) smokeTest();
});

// ORBIS_SMOKE=<folder>: open launcher -> press Play -> wait for the map -> save screenshots -> quit
const SMOKE = process.env.ORBIS_SMOKE;
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
      const ready = await game.webContents.executeJavaScript('!!window.__orbis').catch(() => false);
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
    const gpu = await game.webContents.executeJavaScript(`(() => { const gl = window.__orbis.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })()`);
    const fps = await game.webContents.executeJavaScript("document.getElementById('fps').textContent");
    log('gpu:', gpu, '| fps:', fps);
    await shot(game, 'smoke-game.png');
    log('game ok');
  } catch (e) {
    log('FAILED', e.message);
  }
  app.quit();
}

app.on('window-all-closed', () => app.quit());
