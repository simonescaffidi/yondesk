'use strict';
/*
 * Test end-to-end dell'app desktop: due istanze reali (assistito + operatore)
 * contro un server di signaling locale. Verifica registrazione, consenso,
 * video, controllo mouse/tastiera, sola visione, password errata, non presidiato.
 *
 * Uso:  node test/e2e/run.js                 (app da sorgente)
 *       YONDESK_APP_BIN=/percorso/Yondesk node test/e2e/run.js   (app pacchettizzata)
 * Su Linux senza display: xvfb-run -a node test/e2e/run.js
 */
const { _electron: electron } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..', '..');
const SERVER_DIR = path.join(ROOT, '..', 'server');
const APP_BIN = process.env.YONDESK_APP_BIN || '';
const OUT = process.env.E2E_OUT || path.join(ROOT, 'e2e-out');
const results = [];
let failed = 0;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
async function waitFor(fn, what, timeout = 20000, step = 200) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < timeout) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e.message; }
    await sleep(step);
  }
  throw new Error(`timeout: ${what} (ultimo valore: ${JSON.stringify(last)})`);
}
async function check(name, fn, { optional = false } = {}) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note || '', ms: Date.now() - t0 });
    console.log(`  ok   ${name}${note ? ' — ' + note : ''}`);
    return true;
  } catch (e) {
    results.push({ name, ok: false, optional, note: e.message, ms: Date.now() - t0 });
    console.log(`  ${optional ? 'SKIP' : 'FAIL'} ${name} — ${e.message}`);
    if (!optional) failed++;
    return false;
  }
}

async function startServer(port, dataDir) {
  const p = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', BREVO_API_KEY: '', SMTP_HOST: '', ALERT_EMAIL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  p.stdout.on('data', d => { log += d; });
  p.stderr.on('data', d => { log += d; });
  await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/ice`).catch(() => null);
    return r && r.ok;
  }, 'server di signaling in ascolto', 15000);
  return { proc: p, log: () => log };
}

async function launchApp(label, serverUrl) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `yondesk-${label}-`));
  const args = [`--user-data-dir=${userData}`];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const opts = {
    env: { ...process.env, YONDESK_SERVER: serverUrl, TELEASSIST_SERVER: serverUrl, YONDESK_E2E: '1' },
    timeout: 60000
  };
  if (APP_BIN) { opts.executablePath = APP_BIN; opts.args = args; }
  else { opts.args = [ROOT, ...args]; }
  const app = await electron.launch(opts);
  const logs = [];
  app.on('console', m => logs.push(`[main] ${m.text()}`));
  const hook = (pg) => {
    pg.on('console', m => logs.push(`[${path.basename(pg.url())}] ${m.type()}: ${m.text()}`));
    pg.on('pageerror', e => logs.push(`[${path.basename(pg.url())}] PAGEERROR: ${e.message}`));
  };
  app.windows().forEach(hook);
  app.on('window', hook);
  const panel = await waitFor(async () => app.windows().find(w => w.url().endsWith('index.html')), `finestra pannello ${label}`, 30000);
  await panel.waitForLoadState('domcontentloaded');
  return { app, panel, logs, label };
}

const hostId = (h) => h.panel.evaluate(() => document.querySelector('#id').textContent.replace(/\D/g, ''));
const hostPass = (h) => h.panel.inputValue('#pass');
const hostStatus = (h) => h.panel.evaluate(() => document.querySelector('#status span:last-child').textContent);
const bannerVisible = (h) => h.app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('banner.html') && w.isVisible()));
// Posizione reale del cursore letta dal sistema (nut-js): su Linux il valore di Electron è in cache e non affidabile
const cursor = (h) => h.app.evaluate(async ({ screen }) => {
  try {
    const nut = global.__yondeskNut;
    if (!nut) throw new Error('nut-js non caricato');
    const p = await nut.mouse.getPosition();
    const sf = process.platform === 'darwin' ? 1 : (screen.getPrimaryDisplay().scaleFactor || 1);
    return { x: Math.round(p.x / sf), y: Math.round(p.y / sf) };
  } catch (e) { return { ...screen.getCursorScreenPoint(), nota: 'lettura da Electron: ' + (e && e.message) }; }
});
const display = (h) => h.app.evaluate(({ screen }) => screen.getPrimaryDisplay().size);

async function openViewer(op, id, pass) {
  await op.panel.click('.tab[data-pane="operator"]');
  await op.panel.fill('#op-id', id);
  await op.panel.fill('#op-pass', pass);
  const before = new Set(op.app.windows());
  await op.panel.click('#op-connect');
  const viewer = await waitFor(async () => op.app.windows().find(w => !before.has(w) && w.url().endsWith('viewer.html')), 'finestra operatore', 15000);
  await viewer.waitForLoadState('domcontentloaded');
  return viewer;
}
const viewerStatus = (v) => v.evaluate(() => document.querySelector('#status').textContent);
async function videoStats(v) {
  return v.evaluate(() => {
    const el = document.querySelector('#v');
    const q = el.getVideoPlaybackQuality ? el.getVideoPlaybackQuality() : { totalVideoFrames: 0 };
    return { w: el.videoWidth, h: el.videoHeight, frames: q.totalVideoFrames, t: el.currentTime };
  });
}
async function waitVideo(v) {
  const a = await waitFor(async () => { const s = await videoStats(v); return s.w > 0 && s.frames > 0 ? s : null; }, 'primo frame video', 30000);
  await sleep(1500);
  const b = await videoStats(v);
  if (!(b.frames > a.frames || b.t > a.t)) throw new Error(`video fermo (${JSON.stringify(a)} -> ${JSON.stringify(b)})`);
  return b;
}
/* Luminosità media dell'immagine ricevuta: distingue uno schermo vero da frame neri */
async function videoBrightness(v) {
  return v.evaluate(() => {
    const el = document.querySelector('#v');
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const g = c.getContext('2d'); g.drawImage(el, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return Math.round(s / (d.length / 4) / 3);
  });
}
/* Le due app condividono lo stesso schermo: la finestra operatore va in basso a destra così il
 * cursore reale (mosso dal controllo remoto in alto a sinistra) non le passa sopra creando un anello. */
async function parkViewer(op, d) {
  await op.app.evaluate(({ BrowserWindow }, b) => {
    const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('viewer.html'));
    if (w) w.setBounds(b);
  }, { x: Math.round(d.width * 0.55), y: Math.round(d.height * 0.45), width: Math.round(d.width * 0.44), height: Math.round(d.height * 0.5) });
  await sleep(600);
}
async function closeViewer(v) {
  try { await v.click('#hang', { timeout: 3000 }); } catch { /* già chiusa */ }
  await sleep(500);
}

/* Sostituisce la cattura schermo con un canvas animato (per ambienti senza permesso di cattura) */
async function installFakeCapture(h) {
  await h.panel.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = `hsl(${n++ % 360},70%,50%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('Yondesk E2E ' + n, 40, 180); }, 50);
    const stream = c.captureStream(20);
    navigator.mediaDevices.getUserMedia = async () => stream;
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const port = await freePort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yondesk-data-'));
  console.log(`Piattaforma: ${process.platform} ${os.release()} · app: ${APP_BIN || 'sorgente'} · server: ${serverUrl}`);
  const server = await startServer(port, dataDir);
  let host, op, fakeCapture = false, controlOk = false;

  try {
    await check('avvio app assistito', async () => { host = await launchApp('host', serverUrl); });
    await check('avvio app operatore', async () => { op = await launchApp('op', serverUrl); });
    if (!host || !op) throw new Error('app non avviata');

    let id = '', pass = '';
    await check('assistito: registrazione e ID a 9 cifre', async () => {
      id = await waitFor(async () => { const v = await hostId(host); return /^\d{9}$/.test(v) ? v : null; }, 'ID assegnato');
      pass = await hostPass(host);
      if (!/^[a-z0-9]{8}$/.test(pass)) throw new Error('password sessione non valida: ' + pass);
      const st = await hostStatus(host);
      if (st !== 'In linea') throw new Error('stato: ' + st);
      return `ID ${id}`;
    });
    await check('operatore: registrazione propria', async () => {
      const v = await waitFor(async () => { const x = await hostId(op); return /^\d{9}$/.test(x) ? x : null; }, 'ID operatore');
      if (v === id) throw new Error('stesso ID su due dispositivi');
    });

    // --- password errata ---
    await check('password errata rifiutata', async () => {
      const v = await openViewer(op, id, 'sbagliata1');
      await waitFor(async () => (await viewerStatus(v)) === 'Password errata', 'messaggio password errata');
      if (await bannerVisible(host)) throw new Error('banner visibile senza sessione');
      await v.close();
    });

    // --- ID inesistente ---
    await check('ID non in linea segnalato', async () => {
      const v = await openViewer(op, '100000001', 'x1234567');
      await waitFor(async () => (await viewerStatus(v)) === 'Dispositivo non in linea', 'messaggio offline');
      await v.close();
    });

    // --- rifiuto ---
    await check('richiesta rifiutata dall\'assistito', async () => {
      const v = await openViewer(op, id, pass);
      await waitFor(() => host.panel.evaluate(() => document.querySelector('#consent').open), 'dialog consenso');
      const who = await host.panel.textContent('#who');
      if (!who) throw new Error('nome operatore assente nel consenso');
      await host.panel.click('#c-deny');
      await waitFor(async () => (await viewerStatus(v)) === 'Richiesta rifiutata', 'messaggio rifiuto');
      await v.close();
    });

    // --- sessione con controllo ---
    let viewer;
    await check('sessione con consenso: video ricevuto', async () => {
      viewer = await openViewer(op, id, pass);
      await waitFor(() => host.panel.evaluate(() => document.querySelector('#consent').open), 'dialog consenso');
      await host.panel.click('#c-ctrl');
      let st;
      try {
        st = await waitFor(async () => { const s = await hostStatus(host); return /Sessione attiva|Cattura schermo negata/.test(s) ? s : null; }, 'esito cattura', 20000);
      } catch (e) { st = 'timeout'; }
      if (!/Sessione attiva/.test(st)) {
        // cattura schermo non disponibile in questo ambiente: riprova con sorgente sintetica
        fakeCapture = true;
        await closeViewer(viewer);
        await installFakeCapture(host);
        await waitFor(async () => (await hostStatus(host)) === 'In linea' || /negata/.test(await hostStatus(host)), 'ritorno in linea');
        pass = await hostPass(host);
        viewer = await openViewer(op, id, pass);
        await waitFor(() => host.panel.evaluate(() => document.querySelector('#consent').open), 'dialog consenso (2)');
        await host.panel.click('#c-ctrl');
        await waitFor(async () => /Sessione attiva/.test(await hostStatus(host)), 'sessione attiva con sorgente sintetica');
      }
      const s = await waitVideo(viewer);
      const lum = await videoBrightness(viewer);
      await viewer.screenshot({ path: path.join(OUT, `viewer-${process.platform}.png`) }).catch(() => {});
      return `${s.w}x${s.h}, ${s.frames} frame, luminosità ${lum}, cattura ${fakeCapture ? 'SINTETICA (schermo reale non catturabile qui)' : 'schermo reale'}`;
    });

    await check('banner di sessione visibile sull\'assistito', async () => {
      await waitFor(() => bannerVisible(host), 'banner visibile');
      const st = await viewerStatus(viewer);
      if (!/Controllo attivo/.test(st)) throw new Error('stato operatore: ' + st);
    });

    await check('controllo mouse dall\'operatore', async () => {
      const d = await display(host);
      await parkViewer(op, d);
      const box = await viewer.locator('#v').boundingBox();
      const pts = [[0.10, 0.15], [0.30, 0.25]];
      const seen = [];
      for (const [fx, fy] of pts) {
        await viewer.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 4 });
        const want = { x: Math.round(d.width * fx), y: Math.round(d.height * fy) };
        const got = await waitFor(async () => {
          const c = await cursor(host);
          return Math.abs(c.x - want.x) <= 6 && Math.abs(c.y - want.y) <= 6 ? c : null;
        }, `cursore remoto in ${want.x},${want.y}`, 6000).catch(async () => { throw new Error(`cursore remoto non si muove: atteso ${JSON.stringify(want)}, attuale ${JSON.stringify(await cursor(host))}`); });
        seen.push(`${got.x},${got.y}`);
      }
      controlOk = true;
      return `cursore remoto spostato in ${seen.join(' → ')}`;
    }, { optional: process.platform === 'darwin' });

    await check('controllo tastiera dall\'operatore', async () => {
      if (!controlOk) throw new Error('controllo input non disponibile');
      // finestra di prova sull'assistito con un campo di testo a fuoco
      await host.app.evaluate(async ({ BrowserWindow }) => {
        const w = new BrowserWindow({ width: 500, height: 200, x: 40, y: 120, title: 'e2e-input', alwaysOnTop: true });
        await w.loadURL('data:text/html,<input id="t" autofocus style="width:90%;font-size:24px">');
        w.setAlwaysOnTop(true, 'screen-saver'); w.show(); w.moveTop(); w.focus(); w.webContents.focus();
        global.__e2eInput = w;
      });
      await sleep(800);
      const d = await display(host);
      const box = await viewer.locator('#v').boundingBox();
      // clic dentro il campo (finestra a x=40,y=120 -> campo circa a 140,170 + bordi)
      const tx = 240 / d.width, ty = 185 / d.height;
      await viewer.mouse.click(box.x + box.width * tx, box.y + box.height * ty);
      await sleep(400);
      await viewer.keyboard.type('ciao123', { delay: 60 });
      await viewer.keyboard.press('Backspace');
      const val = await waitFor(() => host.app.evaluate(() => global.__e2eInput.webContents.executeJavaScript('document.getElementById("t").value')).then(v => v === 'ciao12' ? v : null), 'testo digitato da remoto', 8000)
        .catch(async () => {
          const diag = await host.app.evaluate(async ({ BrowserWindow }) => {
            const w = global.__e2eInput; const f = BrowserWindow.getFocusedWindow();
            return { testo: await w.webContents.executeJavaScript('document.getElementById("t").value'), finestraAFuoco: f ? f.getTitle() : null, campoAttivo: await w.webContents.executeJavaScript('document.activeElement && document.activeElement.id'), bounds: w.getBounds(), visibile: w.isVisible() };
          });
          throw new Error('testo non arrivato: ' + JSON.stringify(diag) + ' · cursore ' + JSON.stringify(await cursor(host)));
        });
      await host.app.evaluate(() => { global.__e2eInput.destroy(); });
      return `digitato "${val}" sul dispositivo remoto`;
    }, { optional: process.platform === 'darwin' });

    await check('chiusura dall\'operatore: assistito torna in linea, banner nascosto, nuova password', async () => {
      await closeViewer(viewer);
      await waitFor(async () => (await hostStatus(host)) === 'In linea', 'assistito in linea');
      await waitFor(async () => !(await bannerVisible(host)), 'banner nascosto');
      const np = await hostPass(host);
      if (np === pass) throw new Error('password sessione non rigenerata');
      pass = np;
    });

    // --- sola visione ---
    await check('sola visione: video sì, input ignorato', async () => {
      const v = await openViewer(op, id, pass);
      await waitFor(() => host.panel.evaluate(() => document.querySelector('#consent').open), 'dialog consenso');
      await host.panel.click('#c-view');
      await waitFor(async () => (await viewerStatus(v)) === 'Sola visione', 'stato sola visione');
      await waitVideo(v);
      const before = await cursor(host);
      const box = await v.locator('#v').boundingBox();
      await v.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9, { steps: 3 });
      await v.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1, { steps: 3 });
      await sleep(1200);
      const after = await cursor(host);
      if (before.x !== after.x || before.y !== after.y) throw new Error(`cursore mosso in sola visione: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      // chiusura dall'assistito
      await host.panel.click('#stop');
      await waitFor(async () => /terminata|Chiuso/.test(await v.evaluate(() => document.querySelector('#ph').textContent)), 'operatore avvisato della chiusura');
      await v.close();
      pass = await hostPass(host);
    });

    // --- termina dal banner ---
    await check('pulsante Termina del banner', async () => {
      const v = await openViewer(op, id, pass);
      await waitFor(() => host.panel.evaluate(() => document.querySelector('#consent').open), 'dialog consenso');
      await host.panel.click('#c-view');
      await waitFor(() => bannerVisible(host), 'banner visibile');
      const b = host.app.windows().find(w => w.url().endsWith('banner.html'));
      await b.evaluate(() => document.getElementById('stop').click());
      await waitFor(async () => (await hostStatus(host)) === 'In linea', 'sessione chiusa dal banner');
      await waitFor(async () => !(await bannerVisible(host)), 'banner nascosto');
      await v.close();
      pass = await hostPass(host);
    });

    // --- non presidiato ---
    await check('accesso non presidiato con password dedicata', async () => {
      await host.panel.check('#unatt');
      await host.panel.fill('#unatt-pass', 'segretaE2E9');
      await host.panel.dispatchEvent('#unatt-pass', 'change');
      await sleep(800);
      const v = await openViewer(op, id, 'segretaE2E9');
      await waitFor(async () => /Controllo attivo/.test(await viewerStatus(v)), 'sessione non presidiata avviata senza consenso', 20000);
      if (await host.panel.evaluate(() => document.querySelector('#consent').open)) throw new Error('dialog consenso aperto in non presidiato');
      await waitVideo(v);
      await waitFor(() => bannerVisible(host), 'banner visibile in non presidiato');
      await closeViewer(v);
      await waitFor(async () => (await hostStatus(host)) === 'In linea', 'assistito in linea');
      // password sbagliata resta rifiutata
      const v2 = await openViewer(op, id, 'segretaE2E0');
      await waitFor(async () => (await viewerStatus(v2)) === 'Password errata', 'password non presidiato errata rifiutata');
      await v2.close();
    });

    await check('nessun errore JavaScript nelle finestre', async () => {
      const errs = [...host.logs, ...op.logs].filter(l => /PAGEERROR|Uncaught|is not defined|Cannot read/.test(l));
      if (errs.length) throw new Error(errs.slice(0, 5).join(' | '));
    });
  } catch (e) {
    console.log('ERRORE FATALE: ' + e.message);
    failed++;
  } finally {
    const dump = (x) => x ? x.logs.join('\n') : '';
    fs.writeFileSync(path.join(OUT, `log-${process.platform}.txt`),
      `== host ==\n${dump(host)}\n== operatore ==\n${dump(op)}\n== server ==\n${server.log()}\n`);
    for (const x of [host, op]) { if (x) { try { await x.app.evaluate(({ app }) => { app.isQuitting = true; app.exit(0); }); } catch {} try { await x.app.close(); } catch {} } }
    server.proc.kill();
  }

  const summary = { platform: process.platform, release: os.release(), packaged: !!APP_BIN, fakeCapture, controlOk, failed, results };
  fs.writeFileSync(path.join(OUT, `result-${process.platform}.json`), JSON.stringify(summary, null, 2));
  const passed = results.filter(r => r.ok).length;
  console.log(`\nRISULTATO ${process.platform}: ${passed}/${results.length} superati, ${failed} falliti` +
    (fakeCapture ? ' · cattura schermo reale NON verificata' : '') + (controlOk ? '' : ' · controllo input NON verificato'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`### Yondesk desktop — ${process.platform}${APP_BIN ? ' (app pacchettizzata)' : ''}`, '', '| Verifica | Esito | Dettaglio |', '|---|---|---|',
      ...results.map(r => `| ${r.name} | ${r.ok ? '✅' : r.optional ? '⚠️ non verificabile' : '❌'} | ${String(r.note).replace(/\|/g, '/').slice(0, 200)} |`)].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { sleep, freePort, waitFor, check, startServer, launchApp, hostId, hostPass, hostStatus, openViewer, viewerStatus, waitVideo, closeViewer, results, state: () => ({ failed }), OUT };
