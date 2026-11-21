'use strict';
/*
 * Test end-to-end del client web (pagina demo del sito) e dell'interoperabilità con l'app desktop:
 *  - browser ↔ browser: consenso, video, chat, invio file, cursore remoto, chiusura, password errata
 *  - operatore dal browser → assistito con app desktop
 *  - operatore con app desktop → assistito dal browser
 * Uso: node test/e2e/web.js   (Linux senza display: xvfb-run -a node test/e2e/web.js)
 * E2E_CHROMIUM=/percorso/chrome per usare un Chromium già installato.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('./run.js');
const { sleep, waitFor, check } = T;

const FAKE_DISPLAY = () => {
  // nei test non c'è uno schermo da scegliere: la "condivisione" è un canvas animato
  const make = () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = `hsl(${(n += 3) % 360},70%,45%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '36px sans-serif'; g.fillText('Yondesk web ' + n, 40, 180); }, 50);
    return c.captureStream(20);
  };
  navigator.mediaDevices.getDisplayMedia = async () => make();
};

async function page(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(FAKE_DISPLAY);
  if (process.env.E2E_FORCE_RELAY) {
    // prova del relay TURN: vieta i collegamenti diretti, la sessione deve passare dal relay
    await ctx.addInitScript(() => {
      const Native = window.RTCPeerConnection;
      window.RTCPeerConnection = function (cfg) { return new Native({ ...(cfg || {}), iceTransportPolicy: 'relay' }); };
      window.RTCPeerConnection.prototype = Native.prototype;
    });
  }
  await ctx.addInitScript(() => { try { localStorage.setItem('cookie_consent_v1', JSON.stringify({ necessary: true, statistics: false, ts: Date.now() })); } catch {} });
  const p = await ctx.newPage();
  const logs = [];
  p.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
  p.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await p.goto(base + '/it/demo.html', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { ['cookie-banner', 'cookie-modal'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; }); });
  p.logs = logs;
  return p;
}
const status = (p) => p.evaluate(() => { const s = document.querySelector('#status'); const t = s.querySelector('.status-text') || s.querySelectorAll('span')[1] || s; return t.textContent; });
async function webHostReady(p) {
  const id = await waitFor(async () => { const v = (await p.textContent('#host-id')).replace(/\D/g, ''); return /^\d{9}$/.test(v) ? v : null; }, 'ID host web');
  return { id, pass: await p.inputValue('#host-pass') };
}
async function webConnect(p, id, pass) {
  await p.click('.role-tabs button[data-role="viewer"]');
  await p.fill('#conn-id', id); await p.fill('#conn-pass', pass);
  await p.click('#btn-connect');
}
async function webVideo(p, sel = '#stage-video') {
  const read = () => p.evaluate((s) => { const el = document.querySelector(s); const q = el.getVideoPlaybackQuality(); return { w: el.videoWidth, h: el.videoHeight, frames: q.totalVideoFrames }; }, sel);
  const a = await waitFor(async () => { const s = await read(); return s.w > 0 && s.frames > 0 ? s : null; }, 'primo frame video', 30000);
  await sleep(1200);
  const b = await read();
  if (!(b.frames > a.frames)) throw new Error('video fermo');
  return b;
}

async function main() {
  const port = await T.freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await T.startServer(port, fs.mkdtempSync(path.join(os.tmpdir(), 'yondesk-data-')));
  const browser = await chromium.launch({
    executablePath: process.env.E2E_CHROMIUM || undefined,
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', ...(process.env.E2E_FORCE_RELAY ? ['--no-proxy-server'] : [])]
  });
  console.log(`Client web · server ${base} · Chromium ${browser.version()}${process.env.E2E_FORCE_RELAY ? ' · SOLO RELAY TURN' : ''}`);
  let host, viewer, desk;
  try {
    let cred;
    await check('web: pagina demo, registrazione host e ID', async () => { host = await page(browser, base); cred = await webHostReady(host); return `ID ${cred.id}`; });
    await check('web: password errata rifiutata', async () => {
      viewer = await page(browser, base);
      await webConnect(viewer, cred.id, 'errata123');
      await waitFor(async () => (await status(viewer)) === 'Password errata', 'messaggio password errata');
    });
    await check('web ↔ web: consenso e video', async () => {
      await viewer.fill('#conn-pass', cred.pass); await viewer.click('#btn-connect');
      await waitFor(() => host.evaluate(() => document.querySelector('#consent').classList.contains('show')), 'richiesta di consenso');
      await host.click('#c-allow-ctrl');
      const v = await webVideo(viewer);
      await waitFor(() => host.evaluate(() => document.querySelector('#session-banner').classList.contains('show')), 'banner sull\'host');
      return `${v.w}x${v.h}, ${v.frames} frame`;
    });
    await check('web: chat nei due sensi', async () => {
      await viewer.fill('#chat-input', 'ciao dall\'operatore'); await viewer.click('#chat-send');
      await waitFor(() => host.evaluate(() => [...document.querySelectorAll('#chatlog .msg.them')].some(m => m.textContent === 'ciao dall\'operatore')), 'messaggio ricevuto dall\'host');
      await host.fill('#chat-input', 'ricevuto'); await host.click('#chat-send');
      await waitFor(() => viewer.evaluate(() => [...document.querySelectorAll('#chatlog .msg.them')].some(m => m.textContent === 'ricevuto')), 'risposta ricevuta dall\'operatore');
    });
    await check('web: invio file (300 KB) integro', async () => {
      const buf = Buffer.alloc(300 * 1024); for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) % 251;
      await viewer.setInputFiles('#file-input', { name: 'prova-e2e.bin', mimeType: 'application/octet-stream', buffer: buf });
      const info = await waitFor(() => host.evaluate(async () => {
        const a = [...document.querySelectorAll('#chatlog .msg.them a')].find(x => x.download === 'prova-e2e.bin');
        if (!a) return null;
        const b = new Uint8Array(await (await fetch(a.href)).arrayBuffer()); let sum = 0; for (const x of b) sum = (sum + x) % 1000000007;
        return { size: b.length, sum };
      }), 'file ricevuto dall\'host', 20000);
      let sum = 0; for (const x of buf) sum = (sum + x) % 1000000007;
      if (info.size !== buf.length || info.sum !== sum) throw new Error('file ricevuto diverso: ' + JSON.stringify(info));
      return `${info.size} byte, checksum uguale`;
    });
    await check('web: cursore dell\'operatore visibile sull\'host', async () => {
      const box = await viewer.locator('#stage-video').boundingBox();
      await viewer.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 3 });
      await waitFor(() => host.evaluate(() => getComputedStyle(document.querySelector('#remote-cursor')).display !== 'none'), 'cursore remoto mostrato');
    });
    await check('web: chiusura sessione', async () => {
      await viewer.click('#btn-hangup');
      await waitFor(() => host.evaluate(() => document.querySelector('#setup').style.display !== 'none' && !document.querySelector('#session-banner').classList.contains('show')), 'host tornato alla schermata iniziale');
    });

    // ---- interoperabilità con l'app desktop ----
    if (!process.env.E2E_FORCE_RELAY) await check('avvio app desktop', async () => { desk = await T.launchApp('interop', base); });
    if (desk) {
      await check('operatore dal browser → assistito con app desktop: video', async () => {
        const id = await waitFor(async () => { const v = await T.hostId(desk); return /^\d{9}$/.test(v) ? v : null; }, 'ID app desktop');
        const pass = await T.hostPass(desk);
        const w = await page(browser, base);
        await webConnect(w, id, pass);
        await waitFor(() => desk.panel.evaluate(() => document.querySelector('#consent').open), 'consenso sull\'app desktop');
        await desk.panel.click('#c-view');
        let fake = false;
        try { await waitFor(async () => /Sessione attiva/.test(await T.hostStatus(desk)), 'sessione attiva', 15000); }
        catch { fake = true; }
        if (fake) throw new Error('cattura schermo non disponibile in questo ambiente');
        const v = await webVideo(w);
        await w.click('#btn-hangup');
        await waitFor(async () => (await T.hostStatus(desk)) === 'In linea', 'app desktop di nuovo in linea');
        await w.context().close();
        return `${v.w}x${v.h}, ${v.frames} frame`;
      }, { optional: process.platform === 'darwin' });
      await check('operatore con app desktop → assistito dal browser: video', async () => {
        const h2 = await page(browser, base);
        const c2 = await webHostReady(h2);
        const v = await T.openViewer(desk, c2.id, c2.pass);
        await waitFor(() => h2.evaluate(() => document.querySelector('#consent').classList.contains('show')), 'consenso nel browser');
        await h2.click('#c-allow-view');
        const s = await T.waitVideo(v);
        await T.closeViewer(v);
        await h2.context().close();
        return `${s.w}x${s.h}, ${s.frames} frame`;
      });
    }
    await check('web: nessun errore JavaScript', async () => {
      const errs = [...(host ? host.logs : []), ...(viewer ? viewer.logs : [])].filter(l => /PAGEERROR|Uncaught|is not defined/.test(l));
      if (errs.length) throw new Error(errs.slice(0, 4).join(' | '));
    });
  } catch (e) { console.log('ERRORE FATALE: ' + e.message); process.exitCode = 1; }
  finally {
    fs.mkdirSync(T.OUT, { recursive: true });
    fs.writeFileSync(path.join(T.OUT, `log-web-${process.platform}.txt`), `== host ==\n${host ? host.logs.join('\n') : ''}\n== viewer ==\n${viewer ? viewer.logs.join('\n') : ''}\n== desktop ==\n${desk ? desk.logs.join('\n') : ''}\n== server ==\n${server.log()}`);
    if (desk) { try { await desk.app.evaluate(({ app }) => { app.isQuitting = true; app.exit(0); }); } catch {} }
    await browser.close().catch(() => {});
    server.proc.kill();
  }
  const failed = T.state().failed;
  const ok = T.results.filter(r => r.ok).length;
  console.log(`\nRISULTATO web: ${ok}/${T.results.length} superati, ${failed} falliti`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Yondesk client web e interoperabilità — ${process.platform}`, '', '| Verifica | Esito | Dettaglio |', '|---|---|---|',
      ...T.results.map(r => `| ${r.name} | ${r.ok ? '✅' : r.optional ? '⚠️ non verificabile' : '❌'} | ${String(r.note).replace(/\|/g, '/').slice(0, 200)} |`)].join('\n') + '\n');
  }
  process.exit(failed || process.exitCode ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
