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
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, desktopCapturer, screen, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
let Store; try { Store = require('electron-store'); } catch { Store = null; }

const store = Store ? new Store({ name: 'yondesk' }) : { get: () => undefined, set: () => {} };

let win, banner, tray;
const viewers = new Set(); // finestre operatore aperte
let controlEnabled = false; // abilitato dal renderer quando la sessione è attiva in modalità control

// --- input injection opzionale (degrada a sola visione se non disponibile) ---
let nut = null;
try { nut = require('@nut-tree-fork/nut-js'); nut.mouse.config.autoDelayMs = 0; nut.keyboard.config.autoDelayMs = 0; }
catch { console.warn('[input] nut-js non disponibile: sessioni in sola visione.'); }

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
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  const refresh = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Yondesk', enabled: false },
    { label: 'Apri pannello', click: () => { win.show(); } },
    { type: 'separator' },
    { label: 'Accesso non presidiato', type: 'checkbox', checked: !!store.get('unattended.enabled'),
      click: (mi) => { win.webContents.send('toggle-unattended', mi.checked); } },
    { type: 'separator' },
    { label: 'Esci', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  refresh();
  tray.setToolTip('Yondesk');
  ipcMain.on('tray-refresh', refresh);
}

/* ---------------- IPC: cattura schermo ---------------- */
ipcMain.handle('list-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  return sources.map(s => ({ id: s.id, name: s.display_id ? `Monitor ${s.display_id}` : s.name }));
});

/* ---------------- IPC: banner sessione ---------------- */
ipcMain.on('session-start', (e, info) => {
  controlEnabled = info && info.mode === 'control' && !!nut;
  if (banner) { banner.showInactive(); banner.webContents.send('session-info', { ...info, control: controlEnabled }); }
});
ipcMain.on('session-end', () => { controlEnabled = false; if (banner) banner.hide(); });
ipcMain.on('force-stop', () => { if (win) win.webContents.send('force-stop'); });

/* ---------------- IPC: config ---------------- */
ipcMain.handle('config-get', () => ({
  deviceKey: ensureDeviceKey(),
  signalUrl: store.get('signalUrl') || process.env.TELEASSIST_SERVER || 'https://yondesk.com',
  unattended: store.get('unattended') || { enabled: false, hash: null },
  name: store.get('name') || require('os').hostname()
}));
ipcMain.handle('config-set', (e, patch) => { Object.entries(patch).forEach(([k, v]) => store.set(k, v)); ipcMain.emit('tray-refresh'); return true; });

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
ipcMain.on('input', async (e, ev) => {
  if (!controlEnabled || !nut) return;
  try {
    const { mouse, keyboard, Button, Point, Key } = nut;
    const disp = screen.getPrimaryDisplay().size;
    if (ev.t === 'move') await mouse.setPosition(new Point(Math.round(ev.x * disp.width), Math.round(ev.y * disp.height)));
    else if (ev.t === 'down') await mouse.pressButton(ev.b === 2 ? Button.RIGHT : ev.b === 1 ? Button.MIDDLE : Button.LEFT);
    else if (ev.t === 'up') await mouse.releaseButton(ev.b === 2 ? Button.RIGHT : ev.b === 1 ? Button.MIDDLE : Button.LEFT);
    else if (ev.t === 'scroll') { if (ev.dy > 0) await mouse.scrollDown(Math.abs(ev.dy)); else if (ev.dy < 0) await mouse.scrollUp(Math.abs(ev.dy)); }
    else if (ev.t === 'dblclick') { await mouse.leftClick(); await mouse.leftClick(); }
    else if (ev.t === 'key' && ev.key) { const K = Key[ev.key]; if (K != null) { ev.down ? await keyboard.pressKey(K) : await keyboard.releaseKey(K); } }
    else if (ev.t === 'text' && ev.text) await keyboard.type(ev.text);
  } catch (err) { console.error('[input]', err.message); }
});

app.whenReady().then(() => {
  createMain(); createBanner(); setTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMain(); });
});
app.on('window-all-closed', () => { /* resta in tray */ });
