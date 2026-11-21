'use strict';
/*
 * Signaling WebSocket (/ws).
 * Il server NON vede mai audio/video/input: mette solo in contatto host e viewer.
 * I flussi WebRTC sono cifrati end-to-end (DTLS-SRTP).
 * La password della sessione viene verificata dall'host, non dal server.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const MAX_MSG = 64 * 1024;
const FAIL_LIMIT = 5;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 10 * 60 * 1000;
const PENDING_TIMEOUT_MS = 60 * 1000;

const hosts = new Map();      // id -> { ws, name, platform, unattended }
const sessions = new Map();   // sessionId -> { host, viewer, hostId, accepted, timer }
const failures = new Map();   // id -> { times: [], blockedUntil }
let deviceIds = {};           // sha256(deviceKey) -> id

try { deviceIds = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8')); } catch { /* primo avvio */ }
function saveDevices() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(deviceIds));
  } catch (e) { console.error('Impossibile salvare devices.json', e.message); }
}

function newId() {
  const used = new Set(Object.values(deviceIds));
  let id;
  do { id = String(crypto.randomInt(100000000, 999999999)); } while (used.has(id) || hosts.has(id));
  return id;
}

function idForKey(deviceKey) {
  if (!deviceKey || typeof deviceKey !== 'string' || deviceKey.length < 16) return newId();
  const h = crypto.createHash('sha256').update(deviceKey).digest('hex');
  if (!deviceIds[h]) { deviceIds[h] = newId(); saveDevices(); }
  return deviceIds[h];
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function isBlocked(id) {
  const f = failures.get(id);
  return f && f.blockedUntil > Date.now();
}

function recordFailure(id) {
  const now = Date.now();
  const f = failures.get(id) || { times: [], blockedUntil: 0 };
  f.times = f.times.filter(t => now - t < FAIL_WINDOW_MS);
  f.times.push(now);
  if (f.times.length >= FAIL_LIMIT) { f.blockedUntil = now + BLOCK_MS; f.times = []; }
  failures.set(id, f);
}

function clean(s, max = 64) {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').slice(0, max) : '';
}

function endSession(sid, reason, from) {
  const s = sessions.get(sid);
  if (!s) return;
  clearTimeout(s.timer);
  sessions.delete(sid);
  if (from !== s.host) send(s.host, { type: 'hangup', sessionId: sid, reason });
  if (from !== s.viewer) send(s.viewer, { type: 'hangup', sessionId: sid, reason });
}

function attachSignaling(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });

  wss.on('connection', (ws) => {
    ws.alive = true;
    ws.sessions = new Set();
    ws.on('pong', () => { ws.alive = true; });

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.type !== 'string') return;

      switch (m.type) {
        case 'register': {
          if (ws.hostId) hosts.delete(ws.hostId);
          const id = idForKey(m.deviceKey);
          const prev = hosts.get(id);
          if (prev && prev.ws !== ws) { send(prev.ws, { type: 'replaced' }); prev.ws.close(); }
          ws.hostId = id;
          hosts.set(id, {
            ws,
            name: clean(m.name) || 'Dispositivo',
            platform: clean(m.platform, 16),
            unattended: !!m.unattended
          });
          send(ws, { type: 'registered', id });
          break;
        }

        case 'unregister': {
          if (ws.hostId) { hosts.delete(ws.hostId); ws.hostId = null; }
          break;
        }

        case 'connect': {
          const target = String(m.target || '').replace(/\D/g, '');
          const h = hosts.get(target);
          if (!h) return send(ws, { type: 'error', code: 'offline', ref: m.ref });
          if (h.ws === ws) return send(ws, { type: 'error', code: 'self', ref: m.ref });
          if (isBlocked(target)) return send(ws, { type: 'error', code: 'blocked', ref: m.ref });
          const sid = crypto.randomUUID();
          const s = { host: h.ws, viewer: ws, hostId: target, accepted: false };
          s.timer = setTimeout(() => { if (!s.accepted) endSession(sid, 'timeout'); }, PENDING_TIMEOUT_MS);
          sessions.set(sid, s);
          ws.sessions.add(sid);
          h.ws.sessions.add(sid);
          send(ws, { type: 'pending', sessionId: sid, ref: m.ref, hostName: h.name, platform: h.platform });
          send(h.ws, {
            type: 'incoming',
            sessionId: sid,
            viewerName: clean(m.name) || 'Operatore',
            password: typeof m.password === 'string' ? m.password.slice(0, 128) : '',
            ip: undefined
          });
          break;
        }

        case 'accept': {
          const s = sessions.get(m.sessionId);
          if (!s || s.host !== ws) return;
          s.accepted = true;
          clearTimeout(s.timer);
          send(s.viewer, { type: 'accepted', sessionId: m.sessionId, mode: m.mode === 'view' ? 'view' : 'control' });
          break;
        }

        case 'reject': {
          const s = sessions.get(m.sessionId);
          if (!s || s.host !== ws) return;
          // motivi ammessi verso l'operatore; qualsiasi altro valore diventa "rejected"
          const reason = ['auth', 'busy', 'capture'].includes(m.reason) ? m.reason : 'rejected';
          if (reason === 'auth') recordFailure(s.hostId);
          // all'operatore arriva solo "rejected" (non anche "hangup"): così vede il motivo giusto
          clearTimeout(s.timer);
          sessions.delete(m.sessionId);
          send(s.viewer, { type: 'rejected', sessionId: m.sessionId, reason });
          break;
        }

        case 'signal': {
          const s = sessions.get(m.sessionId);
          if (!s || !s.accepted) return;
          const peer = ws === s.host ? s.viewer : ws === s.viewer ? s.host : null;
          if (peer) send(peer, { type: 'signal', sessionId: m.sessionId, data: m.data });
          break;
        }

        case 'hangup': {
          const s = sessions.get(m.sessionId);
          if (s && (s.host === ws || s.viewer === ws)) endSession(m.sessionId, 'hangup', ws);
          break;
        }

        case 'ping':
          send(ws, { type: 'pong' });
          break;
      }
    });

    ws.on('close', () => {
      if (ws.hostId && hosts.get(ws.hostId)?.ws === ws) hosts.delete(ws.hostId);
      for (const sid of ws.sessions) endSession(sid, 'peer-left', ws);
    });
  });

  const iv = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.alive) return ws.terminate();
      ws.alive = false;
      ws.ping();
    });
  }, 30000);
  iv.unref();
  wss.on('close', () => clearInterval(iv));
  return wss;
}

function stats() {
  return { hostsOnline: hosts.size, activeSessions: sessions.size };
}

module.exports = { attachSignaling, stats };
