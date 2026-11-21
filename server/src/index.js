'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { attachSignaling, stats } = require('./signaling');
const alerts = require('./alerts');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const SITE_URL = (process.env.SITE_URL || 'https://yondesk-production.up.railway.app').replace(/\/$/, '');
const GA4_ID = process.env.GA4_ID || '';
const GSC_VERIFICATION = process.env.GSC_VERIFICATION || '';
// Versione asset per cache-busting: cambia ad ogni deploy, così CSS/JS si aggiornano subito
const ASSET_VER = String(process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || Date.now()).slice(0, 12);

// Dominio canonico (principale) e domini da reindirizzare con 301.
// yondesk.net e le varianti www sono alias -> redirect verso yondesk.com.
let CANONICAL_HOST = '';
try { CANONICAL_HOST = new URL(SITE_URL).host.toLowerCase(); } catch (_) {}
const REDIRECT_HOSTS = new Set(
  (process.env.REDIRECT_HOSTS || 'yondesk.net,www.yondesk.net,www.yondesk.com')
    .split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});

// Redirect 301 degli alias (es. yondesk.net) verso il dominio canonico (yondesk.com)
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (CANONICAL_HOST && host && host !== CANONICAL_HOST && REDIRECT_HOSTS.has(host)) {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  }
  next();
});

// Configurazione ICE (STUN/TURN) letta dalle variabili d'ambiente
app.get('/api/ice', (req, res) => {
  const servers = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun2.l.google.com:19302,stun:stun.cloudflare.com:3478').split(',') }];
  if (process.env.TURN_URLS) {
    let username = process.env.TURN_USERNAME || '';
    let credential = process.env.TURN_CREDENTIAL || '';
    if (process.env.TURN_SECRET) {
      // credenziali temporanee (coturn "use-auth-secret"): scadono dopo 6 ore, nessuna password fissa nei client
      username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:yondesk`;
      credential = require('crypto').createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    }
    servers.push({ urls: process.env.TURN_URLS.split(','), username, credential });
  }
  res.json({ iceServers: servers });
});

app.get('/api/health', (req, res) => res.json({ ok: true, ...stats() }));

// Release: link diretti per piattaforma, letti dalla GitHub API (con cache)
let relCache = { at: 0, data: null };
async function getReleases() {
  const repo = process.env.GITHUB_REPO || 'simonescaffidi/yondesk';
  const base = { repo, latest: `https://github.com/${repo}/releases/latest`, tag: null, assets: {}, ids: {} };
  const fresh = relCache.data && (Date.now() - relCache.at) < 10 * 60 * 1000;
  if (fresh) return relCache.data;
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'yondesk-site' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (r.ok) {
      const j = await r.json();
      base.tag = j.tag_name || null;
      (j.assets || []).forEach(a => {
        const n = (a.name || '').toLowerCase(), u = a.browser_download_url, id = a.id;
        if (n.includes('portable') && n.endsWith('.exe')) { base.assets.win = u; base.ids['win-portable'] = id; }
        else if (n.endsWith('.exe')) { base.assets.win_setup = u; base.ids['win-setup'] = id; }
        else if (n.endsWith('.dmg') && n.includes('arm64')) { base.assets.mac_arm64 = u; base.ids['mac-arm64'] = id; }
        else if (n.endsWith('.dmg')) { base.assets.mac_x64 = u; base.ids['mac-x64'] = id; }
        else if (n.endsWith('.appimage')) { base.assets.linux = u; base.ids['linux-appimage'] = id; }
        else if (n.endsWith('.deb')) { base.assets.linux_deb = u; base.ids['linux-deb'] = id; }
        else if (n.endsWith('.apk')) { base.assets.android = u; base.ids['android'] = id; }
      });
      relCache = { at: Date.now(), data: base }; // cache solo i successi
    } else {
      relCache = { at: Date.now() - 9 * 60 * 1000, data: base }; // riprova tra ~1 min
    }
  } catch (e) {
    relCache = { at: Date.now() - 9 * 60 * 1000, data: base };
  }
  return base;
}
app.get('/api/releases', async (req, res) => {
  try { res.json(await getReleases()); }
  catch (e) {
    const repo = process.env.GITHUB_REPO || 'simonescaffidi/yondesk';
    res.json({ repo, latest: `https://github.com/${repo}/releases/latest`, assets: {} });
  }
});

/*
 * Download proxy: /dl/<key> -> redirect all'URL firmato dell'asset della release.
 * Il repo è privato, quindi i link github.com/.../releases/download/* danno 404
 * agli utenti. Qui il server (con GITHUB_TOKEN read-only) risolve l'asset e
 * reindirizza all'URL firmato pubblico (valido ~1h). URL brandizzati e stabili.
 */
const DL_FILES = {
  'win-portable': 'Yondesk-portable.exe',
  'win-setup': 'Yondesk-Setup.exe',
  'mac-arm64': 'Yondesk-mac-arm64.dmg',
  'mac-x64': 'Yondesk-mac-x64.dmg',
  'linux-appimage': 'Yondesk.AppImage',
  'linux-deb': 'Yondesk.deb',
  'android': 'app-release.apk'
};
const DL_KEYS = Object.keys(DL_FILES);
app.get('/dl/:key', async (req, res) => {
  const key = String(req.params.key || '').toLowerCase();
  if (!DL_KEYS.includes(key)) return res.status(404).send('Download non trovato');
  const repo = process.env.GITHUB_REPO || 'simonescaffidi/yondesk';
  if (!process.env.GITHUB_TOKEN) {
    // Senza token: redirect diretto al file della release (funziona con repo pubblico).
    return res.redirect(302, `https://github.com/${repo}/releases/latest/download/${DL_FILES[key]}`);
  }
  try {
    const rel = await getReleases();
    const id = rel.ids && rel.ids[key];
    if (!id) return res.status(404).send('Asset non disponibile (build in pubblicazione)');
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${id}`, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'yondesk-site', Authorization: 'Bearer ' + process.env.GITHUB_TOKEN },
      redirect: 'manual'
    });
    const loc = r.headers.get('location');
    if ((r.status === 302 || r.status === 301 || r.status === 307) && loc) return res.redirect(302, loc);
    if (r.ok && r.body) { // alcuni runtime seguono il redirect: stream diretto
      res.setHeader('Content-Type', 'application/octet-stream');
      const buf = Buffer.from(await r.arrayBuffer());
      return res.end(buf);
    }
    return res.status(502).send('Download temporaneamente non disponibile');
  } catch (e) {
    return res.redirect(302, `https://github.com/${repo}/releases/latest`);
  }
});

// Health check (200 se l'app risponde)
app.get('/health', (req, res) => res.json({ ok: true, ...stats() }));

// Test alert (protetto da token) per verificare l'invio email
app.get('/api/alert-test', (req, res) => {
  const token = process.env.ALERT_TEST_TOKEN;
  if (!token || req.query.token !== token) return res.status(403).json({ error: 'forbidden' });
  alerts.sendAlert('test', 'Test manuale alert Yondesk', new Error('test').stack);
  res.json({ ok: true, configured: alerts.configured() });
});

// Iniezione partial (header/footer/cookie) + GA4 / Search Console nelle pagine HTML
const htmlCache = new Map();
const partials = {};
function partial(lang, name) {
  const key = lang + '/' + name;
  if (partials[key] != null) return partials[key];
  const f = path.join(PUBLIC, '_partials', lang, name + '.html');
  partials[key] = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  return partials[key];
}
function renderHtml(file) {
  if (htmlCache.has(file)) return htmlCache.get(file);
  const lang = file.includes(path.sep + 'en' + path.sep) ? 'en' : 'it';
  let html = fs.readFileSync(file, 'utf8');
  html = html
    .replace('<!--#HEADER#-->', partial(lang, 'header'))
    .replace('<!--#FOOTER#-->', partial(lang, 'footer'))
    .replace('<!--#COOKIE#-->', partial(lang, 'cookie'))
    .replace(/{{GA4_ID}}/g, GA4_ID)
    .replace(/{{SITE_URL}}/g, SITE_URL)
    .replace(/(["'])(\/(?:css|js)\/[A-Za-z0-9._\-]+\.(?:css|js))\1/g, '$1$2?v=' + ASSET_VER + '$1')
    .replace('<!--GSC-->', GSC_VERIFICATION ? `<meta name="google-site-verification" content="${GSC_VERIFICATION}">` : '');
  if (process.env.NODE_ENV === 'production') htmlCache.set(file, html);
  return html;
}

app.get('/', (req, res) => res.redirect(302, '/it/'));

app.get(['/sitemap.xml'], (req, res) => {
  const pages = ['', 'funzionalita.html', 'demo.html', 'download.html', 'prezzi.html', 'privacy-policy.html', 'cookie-policy.html', 'firma-del-codice.html'];
  const en = { 'funzionalita.html': 'features.html', 'prezzi.html': 'pricing.html', 'firma-del-codice.html': 'code-signing-policy.html' };
  const urls = pages.flatMap(p => [`${SITE_URL}/it/${p}`, `${SITE_URL}/en/${en[p] || p}`]);
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n') + '\n</urlset>\n');
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  let p = decodeURIComponent(req.path);
  if (p.endsWith('/')) p += 'index.html';
  if (!p.endsWith('.html')) return next();
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return next();
  res.type('html').send(renderHtml(file));
});

app.use(express.static(PUBLIC, { maxAge: '1h', extensions: ['html'] }));

app.use((req, res) => res.status(404).type('html').send(renderHtml(path.join(PUBLIC, 'it', '404.html'))));

// Alert email su errori (handler globali + middleware 5xx, registrato per ultimo)
alerts.install(app);

const server = http.createServer(app);
attachSignaling(server);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Yondesk in ascolto sulla porta ${PORT}`));
}

module.exports = { app, server };
