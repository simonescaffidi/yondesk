'use strict';
/*
 * Renderer dell'agent: registra il dispositivo, gestisce consenso, cattura schermo,
 * stabilisce il WebRTC e inoltra gli input ricevuti al main (gated lì da controlEnabled).
 */
(function () {
  const TA = window.Yondesk;
  const $ = (s) => document.querySelector(s);
  let cfg, sig, ice, peer = null, stream = null, sessionPass = '', mode = 'view';
  let pendingReq = null;

  function setStatus(t, on) { const s = $('#status'); s.querySelector('span:last-child').textContent = t; s.classList.toggle('on', !!on); }

  async function boot() {
    cfg = await window.agent.getConfig();
    ice = await TA.iceConfig(cfg.signalUrl);
    sessionPass = TA.genPassword();
    $('#pass').value = sessionPass;
    $('#unatt').checked = !!(cfg.unattended && cfg.unattended.enabled);
    $('#unatt-box').style.display = $('#unatt').checked ? 'block' : 'none';
    connectSignal();
  }

  function wsUrl() {
    const u = new URL(cfg.signalUrl);
    return (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/ws';
  }

  function connectSignal() {
    sig = new TA.Signal(wsUrl());
    sig.on('open', () => { setStatus('In linea', true); register(); });
    sig.on('close', () => setStatus('Riconnessione…'));
    sig.on('registered', (m) => { cfg.id = m.id; $('#id').textContent = TA.formatId(m.id); });
    sig.on('incoming', onIncoming);
    sig.on('signal', (m) => { if (peer) peer.onSignal(m.data); });
    sig.on('hangup', () => endSession());
  }

  function register() {
    sig.send({ type: 'register', name: cfg.name, platform: process.platform, deviceKey: cfg.deviceKey,
      unattended: $('#unatt').checked });
  }

  async function onIncoming(m) {
    // 1) verifica password: sessione o (se non presidiato) password dedicata
    let ok = TA.safeEqual(m.password, sessionPass);
    let auto = false;
    if (!ok && $('#unatt').checked && cfg.unattended && cfg.unattended.hash) {
      const h = await sha256(m.password);
      if (TA.safeEqual(h, cfg.unattended.hash)) { ok = true; auto = true; }
    }
    if (!ok) { sig.send({ type: 'reject', sessionId: m.sessionId, reason: 'auth' }); return; }

    if (auto) { accept(m, 'control'); return; } // non presidiato: nessuna conferma, ma banner sempre visibile
    // 2) consenso esplicito (presidiato)
    pendingReq = m;
    $('#who').textContent = m.viewerName || 'Un operatore';
    $('#consent').showModal();
  }

  function bindConsent() {
    $('#c-deny').onclick = () => { $('#consent').close(); if (pendingReq) sig.send({ type: 'reject', sessionId: pendingReq.sessionId, reason: 'declined' }); pendingReq = null; };
    $('#c-view').onclick = () => { const m = pendingReq; $('#consent').close(); pendingReq = null; if (m) accept(m, 'view'); };
    $('#c-ctrl').onclick = () => { const m = pendingReq; $('#consent').close(); pendingReq = null; if (m) accept(m, 'control'); };
  }

  async function accept(m, md) {
    mode = md;
    sig.send({ type: 'accept', sessionId: m.sessionId, mode: md });
    try { stream = await captureScreen(); }
    catch (e) { sig.send({ type: 'hangup', sessionId: m.sessionId }); setStatus('Cattura schermo negata'); return; }

    peer = new TA.Peer(sig, m.sessionId, /*polite*/ true, ice);
    peer.on('data:ctrl', (data) => { if (mode === 'control') handleInput(JSON.parse(data)); });
    peer.on('closed', () => endSession());
    await peer.addStream(stream, 'balanced');

    window.agent.sessionStart({ viewerName: m.viewerName || 'Operatore', mode: md });
    $('#stop').style.display = 'block';
    setStatus('Sessione attiva · ' + (md === 'control' ? 'controllo' : 'sola visione'), true);
  }

  async function captureScreen() {
    const sources = await window.agent.listSources();
    const id = (sources[0] && sources[0].id);
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxFrameRate: 30 } }
    });
  }

  function handleInput(ev) { window.agent.sendInput(ev); }

  function endSession() {
    if (peer) { peer.close(); peer = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    window.agent.sessionEnd();
    $('#stop').style.display = 'none';
    setStatus('In linea', true);
    sessionPass = TA.genPassword(); $('#pass').value = sessionPass; register();
  }

  async function sha256(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindConsent();
    $('#regen').onclick = () => { sessionPass = TA.genPassword(); $('#pass').value = sessionPass; };
    $('#stop').onclick = () => { if (peer) sig.send({ type: 'hangup', sessionId: peer.sessionId }); endSession(); };
    $('#unatt').onchange = async (e) => {
      $('#unatt-box').style.display = e.target.checked ? 'block' : 'none';
      if (!e.target.checked) { await window.agent.setConfig({ unattended: { enabled: false, hash: null } }); register(); }
    };
    $('#unatt-pass').onchange = async (e) => {
      const v = e.target.value.trim();
      if (v.length < 6) return;
      await window.agent.setConfig({ unattended: { enabled: true, hash: await sha256(v) } });
      cfg = await window.agent.getConfig();
      e.target.value = ''; register();
    };
    window.agent.onToggleUnattended((v) => { $('#unatt').checked = v; $('#unatt').onchange({ target: { checked: v } }); });
    window.agent.onForceStop(() => { if (peer) sig.send({ type: 'hangup', sessionId: peer.sessionId }); endSession(); });
    boot();
  });
})();
