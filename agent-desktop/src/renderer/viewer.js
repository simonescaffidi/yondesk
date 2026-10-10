'use strict';
/*
 * Finestra operatore: si collega a un ID remoto, mostra lo schermo e invia input.
 * Signaling + WebRTC propri (indipendenti dal pannello host).
 * Gli eventi input sono inviati sul data channel "ctrl"; il PC remoto li applica
 * SOLO se ha concesso il controllo (gating lato host). In sola visione vengono ignorati.
 */
(function () {
  const TA = window.TeleAssist;
  const $ = (s) => document.querySelector(s);
  const v = $('#v');
  let sig, ice, peer = null, ctrl = null, sessionId = '';
  const mods = { ctrl: false, alt: false, shift: false, meta: false };

  function setStatus(t) { $('#status').textContent = t; }

  // Mappa tasti speciali del browser -> nomi Key di nut-js (lato host)
  const KEY = {
    Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
    Space: 'Space', Delete: 'Delete', Insert: 'Insert',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ControlLeft: 'LeftControl', ControlRight: 'RightControl',
    ShiftLeft: 'LeftShift', ShiftRight: 'RightShift',
    AltLeft: 'LeftAlt', AltRight: 'RightAlt',
    MetaLeft: 'LeftSuper', MetaRight: 'RightSuper',
    CapsLock: 'CapsLock',
    F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
    F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12'
  };

  function send(ev) { if (ctrl && ctrl.readyState === 'open') ctrl.send(JSON.stringify(ev)); }

  function rel(e) {
    const r = v.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }

  function bindInput() {
    v.addEventListener('mousemove', (e) => { const p = rel(e); send({ t: 'move', x: p.x, y: p.y }); });
    v.addEventListener('mousedown', (e) => { e.preventDefault(); const p = rel(e); send({ t: 'move', x: p.x, y: p.y }); send({ t: 'down', b: e.button }); });
    v.addEventListener('mouseup', (e) => { e.preventDefault(); send({ t: 'up', b: e.button }); });
    v.addEventListener('dblclick', (e) => { e.preventDefault(); send({ t: 'dblclick' }); });
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    v.addEventListener('wheel', (e) => { e.preventDefault(); send({ t: 'scroll', dy: e.deltaY > 0 ? 3 : -3 }); }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (document.activeElement !== v && document.activeElement !== document.body) return;
      e.preventDefault();
      trackMods(e, true);
      const name = KEY[e.code] || letterDigit(e.code);
      if (name && (KEY[e.code] || e.ctrlKey || e.altKey || e.metaKey)) { send({ t: 'key', key: name, down: true }); return; }
      // carattere stampabile senza modificatori di controllo -> digita testo
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) send({ t: 'text', text: e.key });
    });
    window.addEventListener('keyup', (e) => {
      trackMods(e, false);
      const name = KEY[e.code] || letterDigit(e.code);
      if (name && (KEY[e.code] || e.ctrlKey || e.altKey || e.metaKey)) send({ t: 'key', key: name, down: false });
    });
  }
  function letterDigit(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return 'Num' + code.slice(5);
    return null;
  }
  function trackMods(e, down) {
    if (e.code.startsWith('Control')) mods.ctrl = down;
    if (e.code.startsWith('Alt')) mods.alt = down;
    if (e.code.startsWith('Shift')) mods.shift = down;
    if (e.code.startsWith('Meta')) mods.meta = down;
  }

  async function start(target) {
    const cfg = await window.agent.getConfig();
    ice = await TA.iceConfig(cfg.signalUrl);
    const u = new URL(cfg.signalUrl);
    sig = new TA.Signal((u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/ws');

    sig.on('open', () => { setStatus('Connessione al dispositivo…'); sig.send({ type: 'connect', target: String(target.id), password: target.pass, name: target.name || 'Operatore' }); });
    sig.on('pending', () => setStatus('In attesa di conferma sul dispositivo remoto…'));
    sig.on('accepted', (m) => { sessionId = m.sessionId; buildPeer(m.mode); });
    sig.on('rejected', (m) => { setStatus(m.reason === 'auth' ? 'Password errata' : 'Richiesta rifiutata'); });
    sig.on('error', (m) => setStatus({ offline: 'Dispositivo non in linea', blocked: 'Troppi tentativi, riprova più tardi', self: 'ID non valido' }[m.code] || 'Errore di connessione'));
    sig.on('signal', (m) => { if (peer) peer.onSignal(m.data); });
    sig.on('hangup', () => end('Sessione terminata'));
    sig.on('close', () => setStatus('Connessione persa'));
  }

  function buildPeer(mode) {
    peer = new TA.Peer(sig, sessionId, /*polite*/ false, ice);
    ctrl = peer.createChannel('ctrl', { ordered: true });
    peer.on('track', (stream) => { v.srcObject = stream; $('#ph').style.display = 'none'; v.play().catch(() => {}); v.focus(); });
    peer.on('closed', () => end('Sessione terminata'));
    setStatus(mode === 'control' ? 'Controllo attivo' : 'Sola visione');
    bindInput();
  }

  function end(msg) {
    if (peer) { try { peer.close(); } catch {} peer = null; }
    setStatus(msg || 'Chiuso');
    v.srcObject = null;
    $('#ph').style.display = 'block';
    $('#ph').textContent = msg || 'Sessione chiusa';
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#hang').onclick = () => { if (sessionId) sig.send({ type: 'hangup', sessionId }); end('Chiuso'); window.close(); };
    $('#fs').onclick = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); };
    $('#clip').onclick = async () => {
      try { const txt = await navigator.clipboard.readText(); if (txt) send({ t: 'text', text: txt }); } catch {}
    };
    window.agent.onViewerTarget((target) => start(target));
  });
})();
