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
  let accepting = null; // sessione in fase di avvio (cattura schermo in corso)

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
    sig.on('signal', (m) => { if (peer && m.sessionId === peer.sessionId) peer.onSignal(m.data); });
    sig.on('hangup', (m) => {
      // richiesta scaduta o annullata prima della risposta: chiudi il consenso
      if (pendingReq && (!m.sessionId || m.sessionId === pendingReq.sessionId)) { pendingReq = null; if ($('#consent').open) $('#consent').close(); }
      if (accepting && (!m.sessionId || m.sessionId === accepting)) { accepting = null; return; }
      if (peer && (!m.sessionId || m.sessionId === peer.sessionId)) endSession();
    });
    sig.on('replaced', () => setStatus('Yondesk è aperto in un\'altra finestra su questo dispositivo'));
  }

  function register() {
    sig.send({ type: 'register', name: cfg.name, platform: window.agent.platform, deviceKey: cfg.deviceKey,
      unattended: $('#unatt').checked });
  }

  async function onIncoming(m) {
    // 1) verifica password: sessione o (se non presidiato) password dedicata
    let ok = TA.safeEqual(m.password, sessionPass);
    let auto = false;
    if (!ok && $('#unatt').checked && cfg.unattended && cfg.unattended.hash) {
      if (await window.agent.verifyUnattended(m.password)) { ok = true; auto = true; }
    }
    if (!ok) { sig.send({ type: 'reject', sessionId: m.sessionId, reason: 'auth' }); return; }

    if (auto) { if (peer || accepting) { sig.send({ type: 'reject', sessionId: m.sessionId, reason: 'busy' }); return; } accept(m, 'control'); return; } // non presidiato: nessuna conferma, ma banner sempre visibile
    // 2) consenso esplicito (presidiato)
    if (peer || pendingReq || accepting) { sig.send({ type: 'reject', sessionId: m.sessionId, reason: 'busy' }); return; } // una sessione alla volta
    pendingReq = m;
    $('#who').textContent = m.viewerName || 'Un operatore';
    window.agent.attention();
    if (!$('#consent').open) $('#consent').showModal();
  }

  function bindConsent() {
    $('#c-deny').onclick = () => { $('#consent').close(); if (pendingReq) sig.send({ type: 'reject', sessionId: pendingReq.sessionId, reason: 'declined' }); pendingReq = null; };
    $('#c-view').onclick = () => { const m = pendingReq; $('#consent').close(); pendingReq = null; if (m) accept(m, 'view'); };
    $('#c-ctrl').onclick = () => { const m = pendingReq; $('#consent').close(); pendingReq = null; if (m) accept(m, 'control'); };
  }

  async function accept(m, md) {
    mode = md;
    accepting = m.sessionId;
    // Ordine importante: prima cattura e peer, POI "accept". Così l'offerta dell'operatore
    // (che parte appena riceve "accepted") trova sempre un peer pronto a riceverla.
    try { stream = await captureScreen(); }
    catch (e) {
      console.error('cattura schermo:', e && e.message);
      sig.send({ type: 'reject', sessionId: m.sessionId, reason: 'capture' });
      accepting = null;
      setStatus('Cattura schermo negata'); refreshPermissions(); return;
    }
    // l'operatore ha rinunciato mentre il sistema chiedeva il permesso di cattura
    if (accepting !== m.sessionId) { stream.getTracks().forEach(t => t.stop()); stream = null; return; }
    accepting = null;
    peer = new TA.Peer(sig, m.sessionId, /*polite*/ true, ice);
    peer.on('data:ctrl', (data) => { if (mode === 'control') handleInput(JSON.parse(data)); });
    peer.on('closed', () => endSession());
    peer.createChannel('ctrl', { ordered: true }); // l'host apre i canali: l'operatore risponde soltanto
    sig.send({ type: 'accept', sessionId: m.sessionId, mode: md });
    await peer.addStream(stream, 'balanced');

    window.agent.sessionStart({ viewerName: m.viewerName || 'Operatore', mode: md });
    $('#stop').style.display = 'block';
    setStatus('Sessione attiva · ' + (md === 'control' ? 'controllo' : 'sola visione'), true);
  }

  async function captureScreen() {
    const sources = await window.agent.listSources();
    const id = (sources[0] && sources[0].id);
    if (!id) throw new Error('nessuno schermo disponibile');
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxFrameRate: 30 } }
    });
  }

  function handleInput(ev) { window.agent.sendInput(ev); }

  // macOS: senza "Registrazione schermo" il video è nero, senza "Accessibilità" il controllo non funziona
  async function refreshPermissions() {
    const p = await window.agent.permissions();
    const need = [];
    if (p.platform === 'darwin' && p.screen !== 'granted') need.push('screen');
    if (p.platform === 'darwin' && !p.accessibility) need.push('accessibility');
    $('#perm').style.display = need.length ? 'block' : 'none';
    $('#perm-screen').style.display = need.includes('screen') ? 'block' : 'none';
    $('#perm-acc').style.display = need.includes('accessibility') ? 'block' : 'none';
  }

  function endSession() {
    if (peer) { peer.close(); peer = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    window.agent.sessionEnd();
    $('#stop').style.display = 'none';
    setStatus('In linea', true);
    sessionPass = TA.genPassword(); $('#pass').value = sessionPass; register();
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
      await window.agent.setUnattendedPassword(v);
      cfg = await window.agent.getConfig();
      e.target.value = ''; register();
    };
    window.agent.onToggleUnattended((v) => { $('#unatt').checked = v; $('#unatt').onchange({ target: { checked: v } }); });
    window.agent.onForceStop(() => { if (peer) sig.send({ type: 'hangup', sessionId: peer.sessionId }); endSession(); });

    // Tab ruolo
    document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      $('#pane-host').style.display = t.dataset.pane === 'host' ? 'block' : 'none';
      $('#pane-operator').style.display = t.dataset.pane === 'operator' ? 'block' : 'none';
    });
    // Operatore: apre la finestra viewer dedicata
    $('#op-connect').onclick = () => {
      const id = $('#op-id').value.replace(/\D/g, '');
      const pass = $('#op-pass').value.trim();
      if (id.length < 6 || !pass) { $('#op-connect').textContent = 'Inserisci ID e password'; setTimeout(() => $('#op-connect').textContent = 'Connetti', 1500); return; }
      window.agent.openViewer({ id, pass, name: cfg ? cfg.name : 'Operatore' });
    };

    $('#perm-screen-btn').onclick = () => window.agent.openPermission('screen');
    $('#perm-acc-btn').onclick = () => window.agent.openPermission('accessibility');
    window.addEventListener('focus', refreshPermissions);
    refreshPermissions();

    boot();
  });
})();
