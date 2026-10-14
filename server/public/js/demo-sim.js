/*
 * Demo guidata / Guided demo — simulazione a schermo singolo.
 * Non usa WebRTC: riproduce una sessione Yondesk "finta" (consenso, schermo
 * remoto, cursore dell'operatore, chat, invio file) per far capire subito
 * il prodotto anche con un solo dispositivo. Testi da window.__SIM.
 */
(function () {
  'use strict';
  var S = window.__SIM || {};
  function t(k) { return S[k] || k; }
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var stage, sim, cursor, timers = [], running = false;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function after(ms, fn) { var id = setTimeout(fn, ms); timers.push(id); return id; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function build() {
    sim = el('div', 'sim');
    sim.innerHTML =
      '<div class="sim-wall"></div>' +
      '<div class="sim-top"><span class="sdot"></span><span>' + t('top') + '</span></div>' +
      '<div class="sim-dock">' +
        '<div class="sim-ico" data-ico="net">🛠️</div>' +
        '<div class="sim-ico" data-ico="file">📁</div>' +
        '<div class="sim-ico" data-ico="web">🌐</div>' +
      '</div>' +
      '<div class="sim-win" id="sim-win">' +
        '<div class="tb"><span class="b" style="background:#ff5f56"></span><span class="b" style="background:#ffbd2e"></span><span class="b" style="background:#27c93f"></span>&nbsp;' + t('winTitle') + '</div>' +
        '<div class="bd">' +
          '<div class="sim-row"><span>' + t('rowWifi') + '</span><span class="sim-tgl" id="sim-tgl"><span class="k"></span></span></div>' +
          '<div class="sim-row"><span>' + t('rowVpn') + '</span><span style="color:#8aa6c6">' + t('ok') + '</span></div>' +
          '<div class="sim-row"><span>' + t('rowFw') + '</span><span style="color:#8aa6c6">' + t('ok') + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="sim-chat" id="sim-chat"></div>' +
      '<div class="sim-toast" id="sim-toast">📎 ' + t('file') + '</div>' +
      '<div class="sim-consent" id="sim-consent"><div class="cbox">' +
        '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--brand2)" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
        '<div class="who">' + t('who') + '</div>' +
        '<p style="color:var(--muted);font-size:.85rem;margin:0">' + t('consentMsg') + '</p>' +
        '<div class="crow">' +
          '<button class="btn btn-ghost">' + t('deny') + '</button>' +
          '<button class="btn btn-primary sim-cbtn" id="sim-allow">' + t('allow') + '</button>' +
        '</div>' +
      '</div></div>' +
      '<img class="sim-cursor" id="sim-cursor" src="/img/cursor.svg" alt="">' +
      '<button class="sim-close" id="sim-close" aria-label="Chiudi">&times;</button>' +
      '<div class="sim-end" id="sim-end"><div><h3>' + t('endTitle') + '</h3><p>' + t('endText') + '</p>' +
        '<div class="erow"><button class="btn btn-primary" id="sim-replay">↻ ' + t('replay') + '</button>' +
        '<button class="btn btn-ghost" id="sim-real">' + t('tryReal') + '</button></div></div></div>';
    stage.appendChild(sim);
    cursor = $('#sim-cursor', sim);
    $('#sim-close', sim).addEventListener('click', stop);
    $('#sim-replay', sim).addEventListener('click', function () { reset(); play(); });
    $('#sim-real', sim).addEventListener('click', function () {
      stop();
      var p = document.querySelector('.panel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function moveTo(xPct, yPct) {
    if (!cursor) return;
    cursor.style.left = xPct + '%';
    cursor.style.top = yPct + '%';
  }
  function click() { if (!cursor) return; cursor.classList.remove('click'); void cursor.offsetWidth; cursor.classList.add('click'); }

  function bubble(cls, text) {
    var box = $('#sim-chat', sim); if (!box) return;
    var b = el('div', 'sim-bubble ' + cls, text);
    box.appendChild(b);
    requestAnimationFrame(function () { b.classList.add('show'); });
  }

  function reset() {
    clearTimers();
    if (!sim) return;
    $('#sim-end', sim).classList.remove('show');
    $('#sim-top', sim);
    sim.querySelector('.sim-top').classList.remove('show');
    $('#sim-win', sim).classList.remove('show');
    $('#sim-tgl', sim).classList.remove('on');
    $('#sim-chat', sim).innerHTML = '';
    $('#sim-toast', sim).classList.remove('show');
    cursor.classList.remove('show', 'click');
    cursor.style.transition = 'none';
    moveTo(50, 92);
    void cursor.offsetWidth;
    cursor.style.transition = '';
    sim.querySelectorAll('.sim-ico').forEach(function (i) { i.classList.remove('hot'); });
    var c = $('#sim-consent', sim); c.classList.remove('show'); c.style.display = 'grid';
    $('#sim-allow', sim).classList.remove('hot');
  }

  function play() {
    running = true;
    var top = sim.querySelector('.sim-top');
    var consent = $('#sim-consent', sim), allow = $('#sim-allow', sim);
    var win = $('#sim-win', sim), tgl = $('#sim-tgl', sim), toast = $('#sim-toast', sim);
    var net = sim.querySelector('.sim-ico[data-ico="net"]');

    // 1. richiesta di consenso
    after(300, function () { consent.classList.add('show'); });
    after(1400, function () { allow.classList.add('hot'); });
    after(2100, function () { allow.classList.remove('hot'); consent.classList.remove('show'); after(300, function () { consent.style.display = 'none'; }); });

    // 2. sessione attiva: appare la scrivania remota
    after(2400, function () { top.classList.add('show'); cursor.classList.add('show'); });

    // 3. l'operatore apre le impostazioni
    after(3000, function () { moveTo(50, 86); });
    after(3700, function () { net.classList.add('hot'); moveTo(45, 82); });
    after(4300, function () { click(); });
    after(4600, function () { win.classList.add('show'); net.classList.remove('hot'); });

    // 4. riattiva una impostazione (toggle)
    after(5400, function () { moveTo(62, 40); });
    after(6200, function () { click(); tgl.classList.add('on'); });

    // 5. chat tra operatore e utente
    after(6900, function () { bubble('op', t('chat1')); });
    after(8000, function () { bubble('me', t('chat2')); });

    // 6. invio file
    after(8900, function () { moveTo(30, 60); });
    after(9500, function () { toast.classList.add('show'); });
    after(10400, function () { bubble('op', t('chat3')); });

    // 7. fine
    after(12000, function () { $('#sim-end', sim).classList.add('show'); running = false; });
  }

  function start() {
    if (!stage) return;
    if (!sim) build();
    sim.classList.add('show');
    reset();
    play();
  }
  function stop() {
    clearTimers(); running = false;
    if (sim) sim.classList.remove('show');
  }

  document.addEventListener('DOMContentLoaded', function () {
    stage = $('#stage'); if (!stage) return;
    var btn = $('#btn-guided');
    if (btn) btn.addEventListener('click', start);
  });
})();
