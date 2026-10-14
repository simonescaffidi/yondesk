/*
 * Demo WebRTC browser-to-browser.
 * - Host: condivide lo schermo/scheda (il browser chiede consenso via getDisplayMedia),
 *   riceve richieste di connessione e deve ACCETTARLE esplicitamente.
 * - Operatore: inserisce ID + password, vede lo schermo, chat, invio file, cursore remoto.
 * Nel browser il "controllo" è dimostrativo (cursore + annotazioni): il controllo reale
 * di mouse/tastiera del SO richiede l'agent nativo, sempre con consenso e banner visibili.
 */
(function () {
  'use strict';
  var TA = window.Yondesk, L = window.__T || {};
  var sig, ice, role = 'host', peer = null, myPassword = '', myId = '';
  var fileTx = null, localStream = null;

  var $ = function (s) { return document.querySelector(s); };
  function t(k) { return L[k] || k; }
  function setStatus(txt, on) { var s = $('#status'); if (!s) return; var sp = s.querySelector('.status-text') || s.querySelectorAll('span')[1] || s.querySelector('span'); if (sp) sp.textContent = txt; s.classList.toggle('on', !!on); }

  function initSignal() {
    if (sig) return;
    sig = new TA.Signal();
    TA.iceConfig().then(function (c) { ice = c; });
    sig.on('open', function () { setStatus(t('connected_server'), true); if (role === 'host') doRegister(); });
    sig.on('close', function () { setStatus(t('reconnecting')); });
    sig.on('registered', function (m) { myId = m.id; $('#host-id').textContent = TA.formatId(m.id); });
    sig.on('incoming', onIncoming);
    sig.on('pending', function (m) { setStatus(t('waiting_accept')); });
    sig.on('accepted', function (m) { startViewer(m.sessionId, m.mode); });
    sig.on('rejected', function (m) { setStatus(m.reason === 'auth' ? t('wrong_password') : t('rejected')); cleanupPeer(); });
    sig.on('error', function (m) {
      setStatus({ offline: t('host_offline'), blocked: t('too_many'), self: t('err_self') }[m.code] || t('error'));
    });
    sig.on('hangup', function () { endSession(t('session_ended')); });
    sig.on('signal', function (m) { if (peer) peer.onSignal(m.data); });
  }

  /* ---------- HOST ---------- */
  function doRegister() {
    myPassword = myPassword || TA.genPassword();
    $('#host-pass').value = myPassword;
    sig.send({ type: 'register', name: (navigator.platform || 'Browser'), platform: 'web', deviceKey: deviceKey() });
  }
  function deviceKey() {
    try { var k = localStorage.getItem('ta_devkey'); if (!k) { k = TA.genKey(); localStorage.setItem('ta_devkey', k); } return k; }
    catch (e) { return TA.genKey(); }
  }

  var pendingReq = null;
  function onIncoming(m) {
    // Verifica password lato host (il server non la conosce)
    if (!TA.safeEqual(m.password, myPassword)) {
      sig.send({ type: 'reject', sessionId: m.sessionId, reason: 'auth' });
      return;
    }
    pendingReq = m;
    $('#consent-who').textContent = m.viewerName || t('an_operator');
    $('#consent').classList.add('show');
  }
  function respondConsent(ok, mode) {
    $('#consent').classList.remove('show');
    if (!pendingReq) return;
    var m = pendingReq; pendingReq = null;
    if (!ok) { sig.send({ type: 'reject', sessionId: m.sessionId, reason: 'declined' }); return; }
    sig.send({ type: 'accept', sessionId: m.sessionId, mode: mode });
    startHost(m.sessionId, mode);
  }

  async function startHost(sessionId, mode) {
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 }, audio: false
      });
    } catch (e) { endSession(t('share_denied')); sig.send({ type: 'hangup', sessionId: sessionId }); return; }

    localStream.getVideoTracks()[0].addEventListener('ended', function () { hangup(); });
    peer = new TA.Peer(sig, sessionId, /*polite*/ true, ice);
    wirePeer(peer, 'host', mode);
    await peer.addStream(localStream, $('#quality') ? $('#quality').value : 'balanced');
    showStage(true);
    banner(t('banner_sharing'));
    setStatus(t('in_session'), true);
  }

  /* ---------- OPERATORE (viewer) ---------- */
  function connect() {
    var id = $('#conn-id').value.replace(/\D/g, '');
    var pass = $('#conn-pass').value.trim();
    if (id.length < 6 || !pass) { setStatus(t('fill_fields')); return; }
    initSignal();
    var send = function () { sig.send({ type: 'connect', target: id, password: pass, name: t('operator'), mode: 'view' }); };
    if (sig.ws && sig.ws.readyState === 1) send(); else sig.on('open', send);
    setStatus(t('connecting'));
  }
  function startViewer(sessionId, mode) {
    peer = new TA.Peer(sig, sessionId, /*polite*/ false, ice);
    wirePeer(peer, 'viewer', mode);
    // il viewer crea i data channel; il video arriva come track dall'host
    peer.createChannel('ctrl', { ordered: true });
    peer.createChannel('chat', { ordered: true });
    fileTx = new TA.FileTransfer(peer.createChannel('file', { ordered: true }));
    bindFileTx();
    showStage(false);
    setStatus(t('in_session'), true);
  }

  /* ---------- comune ---------- */
  function wirePeer(p, as, mode) {
    p.on('track', function (stream) {
      var v = $('#stage-video'); v.srcObject = stream; v.play().catch(function () {});
      $('#stage-ph').style.display = 'none';
    });
    p.on('channel', function (ch) {
      if (ch.label === 'chat') { /* pronto */ }
      if (ch.label === 'file' && as === 'host') { fileTx = new TA.FileTransfer(ch); bindFileTx(); }
    });
    p.on('data:chat', function (data) { addChat(JSON.parse(data).text, 'them'); });
    p.on('data:ctrl', function (data) { handleCtrl(JSON.parse(data), as); });
    p.on('closed', function () { endSession(t('peer_left')); });
    // operatore: invia eventi puntatore su ctrl
    if (as === 'viewer') attachPointer(p);
    window.__sendChat = function (text) {
      var ch = p.channels.chat; if (ch && ch.readyState === 'open') { ch.send(JSON.stringify({ text: text })); addChat(text, 'me'); }
    };
    window.__sendFile = function (file) { if (fileTx) fileTx.send(file); };
  }

  function attachPointer(p) {
    var v = $('#stage-video');
    v.addEventListener('mousemove', function (e) {
      var r = v.getBoundingClientRect();
      var ch = p.channels.ctrl;
      if (ch && ch.readyState === 'open')
        ch.send(JSON.stringify({ k: 'cursor', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }));
    });
    v.addEventListener('click', function (e) {
      var r = v.getBoundingClientRect();
      var ch = p.channels.ctrl;
      if (ch && ch.readyState === 'open')
        ch.send(JSON.stringify({ k: 'click', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }));
    });
  }
  function handleCtrl(msg, as) {
    if (as !== 'host') return; // nel demo l'host mostra solo il cursore dell'operatore
    var cur = $('#remote-cursor'); var stage = $('#stage');
    if (msg.k === 'cursor' || msg.k === 'click') {
      cur.style.display = 'block';
      cur.style.left = (msg.x * stage.clientWidth) + 'px';
      cur.style.top = (msg.y * stage.clientHeight) + 'px';
      if (msg.k === 'click') { cur.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 250 }); }
    }
  }

  function bindFileTx() {
    if (!fileTx) return;
    fileTx.on('file', function (f) {
      var url = URL.createObjectURL(f.blob);
      addChat(t('file_received') + ': ' + f.name, 'them', url, f.name);
    });
    fileTx.on('progress', function (p) { setStatus((p.dir === 'in' ? '↓ ' : '↑ ') + p.name + ' ' + Math.round(p.sent / p.size * 100) + '%', true); });
    fileTx.on('sent', function () { setStatus(t('in_session'), true); });
  }

  /* ---------- UI helpers ---------- */
  function showStage(isHost) {
    $('#setup').style.display = 'none';
    $('#live').style.display = 'block';
    var cw = $('#chatwrap'); if (cw) cw.style.display = 'flex';
    $('#stage-ph').textContent = isHost ? t('ph_host') : t('ph_viewer');
  }
  function banner(txt) { var b = $('#session-banner'); b.querySelector('span').textContent = txt; b.classList.add('show'); }
  function addChat(text, who, url, name) {
    var log = $('#chatlog'); var d = document.createElement('div'); d.className = 'msg ' + who;
    if (url) { var a = document.createElement('a'); a.href = url; a.download = name; a.textContent = text; a.style.color = 'inherit'; a.style.textDecoration = 'underline'; d.appendChild(a); }
    else d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function cleanupPeer() { if (peer) { peer.close(); peer = null; } if (localStream) { localStream.getTracks().forEach(function (tk) { tk.stop(); }); localStream = null; } }
  function hangup() { if (peer) sig.send({ type: 'hangup', sessionId: peer.sessionId }); endSession(t('session_ended')); }
  function endSession(msg) {
    cleanupPeer();
    var b = $('#session-banner'); if (b) b.classList.remove('show');
    setStatus(msg || t('idle'));
    var live = $('#live'), setup = $('#setup');
    if (live) live.style.display = 'none';
    if (setup) setup.style.display = 'block';
    if (role === 'host') doRegister();
  }

  /* ---------- bootstrap ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (!$('#demo-root')) return;
    // tab ruolo
    document.querySelectorAll('.role-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.role-tabs button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        role = b.dataset.role;
        $('#pane-host').style.display = role === 'host' ? 'block' : 'none';
        $('#pane-viewer').style.display = role === 'viewer' ? 'block' : 'none';
        if (role === 'host') { initSignal(); }
      });
    });
    $('#btn-connect') && $('#btn-connect').addEventListener('click', connect);
    $('#c-allow-view') && $('#c-allow-view').addEventListener('click', function () { respondConsent(true, 'view'); });
    $('#c-allow-ctrl') && $('#c-allow-ctrl').addEventListener('click', function () { respondConsent(true, 'control'); });
    $('#c-deny') && $('#c-deny').addEventListener('click', function () { respondConsent(false); });
    $('#btn-hangup') && $('#btn-hangup').addEventListener('click', hangup);
    $('#btn-regen') && $('#btn-regen').addEventListener('click', function () { myPassword = TA.genPassword(); doRegister(); });
    $('#chat-send') && $('#chat-send').addEventListener('click', sendChatUI);
    $('#chat-input') && $('#chat-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChatUI(); });
    $('#btn-file') && $('#btn-file').addEventListener('click', function () { $('#file-input').click(); });
    $('#file-input') && $('#file-input').addEventListener('change', function (e) { if (e.target.files[0] && window.__sendFile) window.__sendFile(e.target.files[0]); });
    $('#btn-clip') && $('#btn-clip').addEventListener('click', function () {
      navigator.clipboard.readText().then(function (txt) { if (window.__sendChat) window.__sendChat('📋 ' + txt); }).catch(function () {});
    });
    // avvia come host di default
    initSignal();
  });
  function sendChatUI() { var i = $('#chat-input'); if (i.value.trim() && window.__sendChat) { window.__sendChat(i.value.trim()); i.value = ''; } }
})();
