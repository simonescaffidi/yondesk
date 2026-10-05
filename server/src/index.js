'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { attachSignaling, stats } = require('./signaling');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const SITE_URL = (process.env.SITE_URL || 'https://yondesk-production.up.railway.app').replace(/\/$/, '');
const GA4_ID = process.env.GA4_ID || '';
const GSC_VERIFICATION = process.env.GSC_VERIFICATION || '';

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Configurazione ICE (STUN/TURN) letta dalle variabili d'ambiente
app.get('/api/ice', (req, res) => {
  const servers = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',') }];
  if (process.env.TURN_URLS) {
    servers.push({
      urls: process.env.TURN_URLS.split(','),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || ''
    });
  }
  res.json({ iceServers: servers });
});

app.get('/api/health', (req, res) => res.json({ ok: true, ...stats() }));

app.get('/api/releases', (req, res) => {
  const repo = process.env.GITHUB_REPO || 'simonescaffidi/yondesk';
  res.json({ repo, latest: `https://github.com/${repo}/releases/latest` });
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
    .replace('<!--GSC-->', GSC_VERIFICATION ? `<meta name="google-site-verification" content="${GSC_VERIFICATION}">` : '');
  if (process.env.NODE_ENV === 'production') htmlCache.set(file, html);
  return html;
}

app.get('/', (req, res) => res.redirect(302, '/it/'));

app.get(['/sitemap.xml'], (req, res) => {
  const pages = ['', 'funzionalita.html', 'demo.html', 'download.html', 'prezzi.html', 'privacy-policy.html', 'cookie-policy.html'];
  const en = { 'funzionalita.html': 'features.html', 'prezzi.html': 'pricing.html' };
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

const server = http.createServer(app);
attachSignaling(server);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Yondesk in ascolto sulla porta ${PORT}`));
}

module.exports = { app, server };
