'use strict';
/*
 * Dispositivo remoto "vero" per i test dell'app mobile (mobile/integration_test/app_test.dart).
 *
 *   node mobile-peer.js host-desktop   l'app desktop fa da assistito (accesso non presidiato, controllo):
 *                                      verifica che l'app mobile muova il cursore e scriva testo
 *   node mobile-peer.js host-web       una pagina del client web fa da assistito (sola visione)
 *   node mobile-peer.js viewer-web     una pagina del client web fa da operatore verso il telefono
 *
 * Scrive e2e-out/peer.json (server, id, password) appena pronto; esce con 0 se la sessione
 * osservata è andata come previsto. Porta: E2E_PORT (default 8787).
 */
const { chromium } = require('playwright-core');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('./run.js');
const { sleep, waitFor } = T;

const MODE = process.argv[2];
const PORT = Number(process.env.E2E_PORT || 8787);
const OUT = T.OUT;
const WAIT = Number(process.env.E2E_PEER_TIMEOUT || 600) * 1000; // attesa dell'app mobile (build inclusa)
const PASS = 'e2emobile9';
const DEVICE_KEY = process.env.E2E_DEVICE_KEY || 'e2e-device-key-0123456789abcdef';
const DEVICE_ID = '424242424';
const log = (...a) => console.log('[peer]', ...a);

const FAKE_DISPLAY = () => {
  const make = () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = `hsl(${(n += 3) % 360},70%,45%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '36px sans-serif'; g.fillText('Yondesk ' + n, 40, 180); }, 50);
    return c.captureStream(20);
  };
  navigator.mediaDevices.getDisplayMedia = async () => make();
};
async function webPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript(FAKE_DISPLAY);
  const p = await ctx.newPage();
  p.on('console', m => { if (/yondesk|error/i.test(m.text())) log('web:', m.text()); });
  await p.goto(base + '/it/demo.html', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { ['cookie-banner', 'cookie-modal'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; }); });
  return p;
}
const webStatus = (p) => p.evaluate(() => { const s = document.querySelector('#status'); const t = s.querySelector('.status-text') || s.querySelectorAll('span')[1] || s; return t.textContent; });
const launchBrowser = () => chromium.launch({
  executablePath: process.env.E2E_CHROMIUM || undefined,
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
});
function ready(info) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'peer.json'), JSON.stringify(info));
  log('pronto', JSON.stringify(info));
}

async function hostDesktop(base) {
  const host = await T.launchApp('mobile-host', base);
  const id = await waitFor(async () => { const v = await T.hostId(host); return /^\d{9}$/.test(v) ? v : null; }, 'ID app desktop');
  await host.panel.check('#unatt');
  await host.panel.fill('#unatt-pass', PASS);
  await host.panel.dispatchEvent('#unatt-pass', 'change');
  await sleep(800);
  const d = await host.app.evaluate(({ screen }) => screen.getPrimaryDisplay().size);
  // campo di testo di prova sull'assistito: l'app mobile ci fa clic e ci scrive
  await host.app.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({ width: 500, height: 200, x: 40, y: 120, title: 'e2e-input', alwaysOnTop: true });
    await w.loadURL('data:text/html,<input id="t" autofocus style="width:90%;font-size:24px">');
    global.__e2eInput = w;
  });
  const tap = { x: 240 / d.width, y: 185 / d.height };
  ready({ server: base, id, pass: PASS, tapX: tap.x, tapY: tap.y, control: true });

  await waitFor(async () => /Sessione attiva/.test(await T.hostStatus(host)), 'sessione avviata dall\'app mobile', WAIT, 500);
  log('sessione attiva:', await T.hostStatus(host));
  await host.app.evaluate(() => { const w = global.__e2eInput; w.show(); w.moveTop(); w.focus(); w.webContents.focus(); });
  const cur = () => host.app.evaluate(async ({ screen }) => {
    const nut = global.__yondeskNut; if (!nut) return null;
    const p = await nut.mouse.getPosition(); const sf = process.platform === 'darwin' ? 1 : (screen.getPrimaryDisplay().scaleFactor || 1);
    return { x: Math.round(p.x / sf), y: Math.round(p.y / sf) };
  });
  const typed = () => host.app.evaluate(() => global.__e2eInput.webContents.executeJavaScript('document.getElementById("t").value'));
  let controlOk = false, note = '';
  try {
    const c = await waitFor(async () => { const p = await cur(); return p && Math.abs(p.x - 240) <= 14 && Math.abs(p.y - 185) <= 14 ? p : null; }, 'cursore remoto sul campo di prova', 60000, 300);
    const txt = await waitFor(async () => (await typed()) === 'yd42' ? 'yd42' : null, 'testo scritto dall\'app mobile', 30000, 300);
    controlOk = true; note = `cursore in ${c.x},${c.y}, testo "${txt}"`;
  } catch (e) { note = `${e.message} · cursore ${JSON.stringify(await cur())} · testo ${JSON.stringify(await typed())}`; }
  log(controlOk ? 'controllo OK:' : 'controllo NON riuscito:', note);
  await waitFor(async () => (await T.hostStatus(host)) === 'In linea', 'chiusura della sessione dall\'app mobile', 90000, 500);
  log('sessione chiusa dall\'app mobile');
  fs.writeFileSync(path.join(OUT, 'log-mobile-host.txt'), host.logs.join('\n'));
  try { await host.app.evaluate(({ app }) => { app.isQuitting = true; app.exit(0); }); } catch {}
  const mustControl = process.platform !== 'darwin';
  return controlOk || !mustControl;
}

async function hostWeb(base) {
  const browser = await launchBrowser();
  const p = await webPage(browser, base);
  const id = await waitFor(async () => { const v = (await p.textContent('#host-id')).replace(/\D/g, ''); return /^\d{9}$/.test(v) ? v : null; }, 'ID host web');
  const pass = await p.inputValue('#host-pass');
  ready({ server: base, id, pass, control: false });
  await waitFor(() => p.evaluate(() => document.querySelector('#consent').classList.contains('show')), 'richiesta dall\'app mobile', WAIT, 500);
  await p.click('#c-allow-view');
  await waitFor(() => p.evaluate(() => document.querySelector('#session-banner').classList.contains('show')), 'sessione attiva', 30000);
  log('sessione attiva (host web)');
  await waitFor(() => p.evaluate(() => !document.querySelector('#session-banner').classList.contains('show')), 'chiusura della sessione dall\'app mobile', 120000, 500);
  log('sessione chiusa dall\'app mobile');
  await browser.close();
  return true;
}

async function viewerWeb(base) {
  const browser = await launchBrowser();
  const p = await webPage(browser, base);
  const pass = process.env.E2E_HOST_PASS || PASS;
  ready({ server: base, id: DEVICE_ID, pass, deviceKey: DEVICE_KEY });
  await p.click('.role-tabs button[data-role="viewer"]');
  await p.fill('#conn-id', DEVICE_ID); await p.fill('#conn-pass', pass);
  // riprova finché il telefono non è in linea
  await waitFor(async () => {
    await p.click('#btn-connect'); await sleep(1500);
    const s = await webStatus(p);
    return s !== 'Dispositivo non in linea' && s !== 'Errore' ? s : null;
  }, 'telefono in linea', WAIT, 2500);
  log('richiesta inviata al telefono:', await webStatus(p));
  const read = () => p.evaluate(() => { const el = document.querySelector('#stage-video'); const q = el.getVideoPlaybackQuality(); return { w: el.videoWidth, h: el.videoHeight, frames: q.totalVideoFrames }; });
  const a = await waitFor(async () => { const s = await read(); return s.w > 0 && s.frames > 0 ? s : null; }, 'video dallo schermo del telefono', 120000, 500);
  await sleep(4000);
  const b = await read();
  await p.screenshot({ path: path.join(OUT, 'telefono-visto-dal-browser.png') }).catch(() => {});
  log(`video dal telefono: ${b.w}x${b.h}, ${b.frames} frame`);
  const ok = b.frames > a.frames;
  await p.click('#btn-hangup');
  await sleep(1500);
  await browser.close();
  return ok;
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yondesk-data-'));
  if (MODE === 'viewer-web') {
    const h = crypto.createHash('sha256').update(DEVICE_KEY).digest('hex');
    fs.writeFileSync(path.join(dataDir, 'devices.json'), JSON.stringify({ [h]: DEVICE_ID }));
  }
  const server = await T.startServer(PORT, dataDir);
  const base = `http://127.0.0.1:${PORT}`;
  let ok = false;
  try {
    if (MODE === 'host-desktop') ok = await hostDesktop(base);
    else if (MODE === 'host-web') ok = await hostWeb(base);
    else if (MODE === 'viewer-web') ok = await viewerWeb(base);
    else throw new Error('modalità sconosciuta: ' + MODE);
  } catch (e) { log('ERRORE:', e.message); }
  server.proc.kill();
  fs.writeFileSync(path.join(OUT, `peer-result-${MODE}.json`), JSON.stringify({ mode: MODE, ok }));
  log('ESITO', MODE, ok ? 'OK' : 'FALLITO');
  process.exit(ok ? 0 : 1);
})();
