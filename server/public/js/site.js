/* Nav mobile, tema, cookie banner GDPR (consenso prima del tracking), GA4 on-consent */
(function () {
  'use strict';
  var GA4 = (document.documentElement.getAttribute('data-ga4') || '').trim();

  document.addEventListener('DOMContentLoaded', function () {
    var burger = document.querySelector('.burger');
    var links = document.querySelector('.nav-links');
    if (burger && links) burger.addEventListener('click', function () {
      links.classList.toggle('open');
      burger.setAttribute('aria-expanded', links.classList.contains('open'));
    });
  });

  var COOKIE = 'cookie_consent_v1';
  var listeners = [];
  window.onCookieConsent = function (cb) { var c = getConsent(); if (c) cb(c); else listeners.push(cb); };
  function getConsent() { try { var r = localStorage.getItem(COOKIE); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function setConsent(c) {
    try { localStorage.setItem(COOKIE, JSON.stringify(c)); } catch (e) {}
    var b = document.getElementById('cookie-banner'); if (b) b.style.display = 'none';
    var m = document.getElementById('cookie-modal'); if (m) m.style.display = 'none';
    listeners.splice(0).forEach(function (cb) { try { cb(c); } catch (e) {} });
  }
  window.openCookieSettings = function () { var m = document.getElementById('cookie-modal'); if (m) m.style.display = 'grid'; };

  // GA4 caricato SOLO dopo consenso statistico
  window.onCookieConsent(function (c) {
    if (!c.statistics || !GA4) return;
    var s = document.createElement('script'); s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date()); gtag('config', GA4, { anonymize_ip: true });
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (!getConsent()) { var b = document.getElementById('cookie-banner'); if (b) b.style.display = 'block'; }
    function on(id, fn) { var e = document.getElementById(id); if (e) e.addEventListener('click', fn); }
    on('cb-accept', function () { setConsent({ necessary: true, statistics: true, marketing: true }); });
    on('cb-reject', function () { setConsent({ necessary: true, statistics: false, marketing: false }); });
    on('cb-customize', window.openCookieSettings);
    on('cm-save', function () {
      setConsent({ necessary: true,
        statistics: !!document.getElementById('cm-stat') && document.getElementById('cm-stat').checked,
        marketing: !!document.getElementById('cm-mkt') && document.getElementById('cm-mkt').checked });
    });
  });
})();
