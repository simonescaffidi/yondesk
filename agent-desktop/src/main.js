'use strict';
/*
 * Yondesk agent desktop (Electron).
 * Finestre:
 *  - main: pannello (ID, password, stato, impostazioni non presidiato).
 *  - banner: barra frameless always-on-top, VISIBILE per tutta la sessione remota.
 *  - consent: dialog modale di consenso per le sessioni presidiate.
 * Il controllo input (mouse/tastiera) avviene nel main process via nut-js SOLO quando
 * la sessione è in modalità "control" e il consenso è stato dato (o non presidiato abilitato).
 */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, desktopCapturer, screen, shell, systemPreferences } = require('electron');
const path = require('path');
const crypto = require('crypto');
const unattendedHash = require('./unattended-hash');
let Store; try { Store = require('electron-store'); } catch { Store = null; }

// Assistenza remota: i due dispositivi devono potersi raggiungere direttamente anche in rete locale.
// Senza questo, Chromium nasconde gli indirizzi locali dietro nomi mDNS che telefoni e altri client non risolvono.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => showPanel());

const store = Store ? new Store({ name: 'yondesk' }) : { get: () => undefined, set: () => {} };

let win, banner, tray;
const viewers = new Set(); // finestre operatore aperte
let controlEnabled = false; // abilitato dal renderer quando la sessione è attiva in modalità control

// --- input injection opzionale (degrada a sola visione se non disponibile) ---
let nut = null;
try { nut = require('@nut-tree-fork/nut-js'); nut.mouse.config.autoDelayMs = 0; nut.keyboard.config.autoDelayMs = 0; }
catch { console.warn('[input] nut-js non disponibile: sessioni in sola visione.'); }
if (process.env.YONDESK_E2E) global.__yondeskNut = nut; // solo per i test automatici: lettura posizione reale del cursore

function createMain() {
  win = new BrowserWindow({
    width: 420, height: 640, resizable: false, title: 'Yondesk',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function showPanel() {
  if (!win || win.isDestroyed()) { createMain(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createBanner() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  banner = new BrowserWindow({
    width: 360, height: 44, x: Math.round(width / 2 - 180), y: 8,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: true, focusable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  banner.setAlwaysOnTop(true, 'screen-saver');
  banner.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  banner.loadFile(path.join(__dirname, 'renderer', 'banner.html'));
}

// Finestra operatore (viewer): mostra lo schermo remoto e invia input
function createViewer(target) {
  const v = new BrowserWindow({
    width: 1100, height: 720, title: 'Yondesk — Sessione remota',
    backgroundColor: '#05070f',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  v.setMenuBarVisibility(false);
  v.loadFile(path.join(__dirname, 'renderer', 'viewer.html'));
  v.webContents.once('did-finish-load', () => v.webContents.send('viewer-target', target));
  v.on('closed', () => viewers.delete(v));
  viewers.add(v);
  return v;
}
ipcMain.handle('open-viewer', (e, target) => { createViewer(target); return true; });

function setTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  if (!img.isEmpty() && process.platform === 'darwin') img = img.resize({ width: 18, height: 18 });
  try { tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img); }
  catch (e) { console.warn('[tray] non disponibile:', e.message); return; }
  const refresh = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Yondesk', enabled: false },
    { label: 'Apri pannello', click: () => showPanel() },
    { type: 'separator' },
    { label: 'Accesso non presidiato', type: 'checkbox', checked: !!store.get('unattended.enabled'),
      click: (mi) => { win.webContents.send('toggle-unattended', mi.checked); } },
    { type: 'separator' },
    { label: 'Esci', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  refresh();
  tray.setToolTip('Yondesk');
  tray.on('click', () => showPanel());
  ipcMain.on('tray-refresh', refresh);
}

/* ---------------- IPC: cattura schermo ---------------- */
ipcMain.handle('list-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  // schermo principale per primo: è quello su cui viene mappato il controllo mouse
  const primary = String(screen.getPrimaryDisplay().id);
  sources.sort((a, b) => (String(b.display_id) === primary) - (String(a.display_id) === primary));
  return sources.map(s => ({ id: s.id, name: s.display_id ? `Monitor ${s.display_id}` : s.name }));
});

/* ---------------- IPC: permessi di sistema (macOS) e attenzione utente ---------------- */
ipcMain.handle('permissions', () => {
  if (process.platform !== 'darwin') return { platform: process.platform, screen: 'granted', accessibility: true };
  return {
    platform: 'darwin',
    screen: systemPreferences.getMediaAccessStatus('screen'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  };
});
ipcMain.handle('open-permission', (e, kind) => {
  if (process.platform !== 'darwin') return false;
  if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true); // mostra la richiesta di sistema
  const pane = kind === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture';
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  return true;
});
// Una richiesta di assistenza deve essere vista anche se il pannello è nascosto nel tray
ipcMain.on('attention', () => { showPanel(); if (win) { win.flashFrame(true); setTimeout(() => { if (win && !win.isDestroyed()) win.flashFrame(false); }, 4000); } });

/* ---------------- IPC: banner sessione ---------------- */
ipcMain.on('session-start', (e, info) => {
  controlEnabled = info && info.mode === 'control' && !!nut;
  if (banner) { banner.showInactive(); banner.webContents.send('session-info', { ...info, control: controlEnabled }); }
});
ipcMain.on('session-end', () => { controlEnabled = false; releaseHeld(); if (banner) banner.hide(); });
ipcMain.on('force-stop', () => { if (win) win.webContents.send('force-stop'); });

/* ---------------- IPC: config ---------------- */
ipcMain.handle('config-get', () => ({
  deviceKey: ensureDeviceKey(),
  signalUrl: store.get('signalUrl') || process.env.YONDESK_SERVER || process.env.TELEASSIST_SERVER || 'https://yondesk.com',
  unattended: store.get('unattended') || { enabled: false, hash: null },
  name: store.get('name') || require('os').hostname()
}));
ipcMain.handle('config-set', (e, patch) => { Object.entries(patch).forEach(([k, v]) => store.set(k, v)); ipcMain.emit('tray-refresh'); return true; });

/* Password accesso non presidiato: hash scrypt con salt calcolato nel main process.
 * Il vecchio formato (SHA-256 senza salt) viene verificato e risalvato nel nuovo alla prima verifica riuscita. */
ipcMain.handle('unattended-set', (e, password) => {
  store.set('unattended', { enabled: true, hash: unattendedHash.hashPassword(String(password || '')) });
  ipcMain.emit('tray-refresh');
  return true;
});
ipcMain.handle('unattended-verify', (e, password) => {
  const u = store.get('unattended');
  if (!u || !u.enabled || !u.hash) return false;
  const ok = unattendedHash.verifyPassword(String(password || ''), u.hash);
  if (ok && unattendedHash.needsRehash(u.hash)) {
    store.set('unattended', { ...u, hash: unattendedHash.hashPassword(String(password)) });
  }
  return ok;
});

function ensureDeviceKey() {
  let k = store.get('deviceKey');
  if (!k) { k = crypto.randomBytes(24).toString('hex'); store.set('deviceKey', k); }
  return k;
}

/* ---------------- IPC: input injection (gated) ---------------- */
/*
 * Gli eventi arrivano SOLO dal renderer durante una sessione control consentita.
 * controlEnabled fa da gate finale: senza consenso control o senza nut-js, no-op.
 */
const inputQueue = [];
let inputBusy = false;
const held = { keys: new Set(), buttons: new Set() };
const BTN = (b) => (b === 2 ? nut.Button.RIGHT : b === 1 ? nut.Button.MIDDLE : nut.Button.LEFT);
const num01 = (v) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

async function applyInput(ev) {
  const { mouse, keyboard, Point, Key } = nut;
  if (ev.t === 'move') {
    const x = num01(ev.x), y = num01(ev.y);
    if (x === null || y === null) return;
    // nut-js lavora in pixel fisici su Windows/Linux e in punti su macOS
    const d = screen.getPrimaryDisplay();
    const sf = process.platform === 'darwin' ? 1 : (d.scaleFactor || 1);
    await mouse.setPosition(new Point(Math.round(x * (d.size.width * sf - 1)), Math.round(y * (d.size.height * sf - 1))));
  } else if (ev.t === 'down') { held.buttons.add(ev.b | 0); await mouse.pressButton(BTN(ev.b | 0)); }
  else if (ev.t === 'up') { held.buttons.delete(ev.b | 0); await mouse.releaseButton(BTN(ev.b | 0)); }
  else if (ev.t === 'scroll') {
    const n = Math.min(20, Math.abs(Number(ev.dy) || 0));
    if (ev.dy > 0) await mouse.scrollDown(n); else if (ev.dy < 0) await mouse.scrollUp(n);
  } else if (ev.t === 'dblclick') { await mouse.doubleClick(nut.Button.LEFT); }
  else if (ev.t === 'key' && typeof ev.key === 'string') {
    const K = Object.prototype.hasOwnProperty.call(Key, ev.key) ? Key[ev.key] : null;
    if (K == null) return;
    if (ev.down) { held.keys.add(K); await keyboard.pressKey(K); } else { held.keys.delete(K); await keyboard.releaseKey(K); }
  } else if (ev.t === 'text' && typeof ev.text === 'string' && ev.text) { await keyboard.type(ev.text.slice(0, 4000)); }
}

async function drainInput() {
  inputBusy = true;
  while (inputQueue.length) {
    const ev = inputQueue.shift();
    if (!controlEnabled) continue;
    try { await applyInput(ev); } catch (err) { console.error('[input]', ev && ev.t, err.message); }
  }
  inputBusy = false;
}

// A fine sessione niente tasti o pulsanti "incastrati" sul dispositivo assistito
async function releaseHeld() {
  inputQueue.length = 0;
  if (!nut) return;
  for (const k of [...held.keys]) { try { await nut.keyboard.releaseKey(k); } catch {} }
  for (const b of [...held.buttons]) { try { await nut.mouse.releaseButton(BTN(b)); } catch {} }
  held.keys.clear(); held.buttons.clear();
}

ipcMain.on('input', (e, ev) => {
  if (!controlEnabled || !nut || !ev || typeof ev.t !== 'string') return;
  if (win && e.sender !== win.webContents) return; // solo il pannello (sessione host) può iniettare input
  // gli eventi vanno applicati in ordine; i movimenti consecutivi si fondono nell'ultimo
  const last = inputQueue[inputQueue.length - 1];
  if (ev.t === 'move' && last && last.t === 'move') inputQueue[inputQueue.length - 1] = ev; else inputQueue.push(ev);
  if (inputQueue.length > 500) inputQueue.splice(0, inputQueue.length - 500);
  if (!inputBusy) drainInput();
});

app.whenReady().then(() => {
  createMain(); createBanner(); setTray();
  app.on('activate', () => showPanel()); // clic sull'icona nel Dock (macOS)
});
app.on('before-quit', () => { app.isQuitting = true; }); // Cmd+Q / chiusura sessione: lascia chiudere il pannello
app.on('window-all-closed', () => { /* resta in tray */ });
