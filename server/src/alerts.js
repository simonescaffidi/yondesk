'use strict';
/*
 * Alert via email su errori (regola fissa: destinatario info@simonescaffidi.it).
 * Invia mail su: crash (uncaughtException/unhandledRejection) e risposte 5xx Express.
 * Anti-spam: max 1 mail per tipo di errore ogni 30 minuti.
 * SMTP via variabili d'ambiente. Se mancano, logga un warning (non invia) — NON va omesso in silenzio.
 */
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* dipendenza assente */ }

const SLUG = 'yondesk';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'info@simonescaffidi.it';
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `Yondesk Alert <${SMTP_USER}>` : 'alert@yondesk');
const SMTP_SECURE = String(process.env.SMTP_SECURE || (SMTP_PORT === 465)).toLowerCase() === 'true';
const RAILWAY_URL = process.env.RAILWAY_PROJECT_URL || 'https://railway.com/project/bcf1cc6a-6aa0-41cb-a4d1-bea62f08483a';

const WINDOW_MS = 30 * 60 * 1000;
const lastSent = new Map(); // tipo -> timestamp
let transporter = null;
let warned = false;

function configured() {
  return !!(nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransport() {
  if (transporter) return transporter;
  if (!configured()) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

function nowRome() {
  try { return new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' }); }
  catch { return new Date().toISOString(); }
}

/**
 * Invia un alert. type = chiave anti-spam (es. 'uncaughtException', '5xx').
 */
function sendAlert(type, message, stack) {
  const key = String(type || 'generico');
  const now = Date.now();
  const prev = lastSent.get(key) || 0;
  if (now - prev < WINDOW_MS) return; // anti-spam
  lastSent.set(key, now);

  const subject = `[ALERT] ${SLUG} – ${key}`;
  const body =
    `Progetto: ${SLUG}\n` +
    `Data/ora (Europe/Rome): ${nowRome()}\n` +
    `Servizio: ${process.env.RAILWAY_SERVICE_NAME || 'web'} (${process.env.RAILWAY_ENVIRONMENT_NAME || 'production'})\n` +
    `Tipo: ${key}\n` +
    `Messaggio: ${message || '(nessuno)'}\n\n` +
    `Stack:\n${(stack || '').split('\n').slice(0, 12).join('\n')}\n\n` +
    `Railway: ${RAILWAY_URL}\n`;

  const t = getTransport();
  if (!t) {
    if (!warned) {
      warned = true;
      console.error(`[alert] SMTP non configurato: impossibile inviare alert a ${ALERT_EMAIL}. ` +
        `Imposta SMTP_HOST/SMTP_USER/SMTP_PASS (e nodemailer installato). Alert in attesa credenziali.`);
    }
    console.error(`[alert:NON INVIATO] ${subject}\n${body}`);
    return;
  }
  t.sendMail({ from: SMTP_FROM, to: ALERT_EMAIL, subject, text: body })
    .then(() => console.log(`[alert] inviato: ${subject}`))
    .catch((e) => console.error(`[alert] invio fallito: ${e.message}`));
}

/**
 * Aggancia handler globali e middleware errori Express.
 */
function install(app) {
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    sendAlert('uncaughtException', err.message, err.stack);
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[unhandledRejection]', err);
    sendAlert('unhandledRejection', err.message, err.stack);
  });

  if (app) {
    // middleware errori 5xx (va registrato per ultimo)
    app.use((err, req, res, next) => {
      console.error('[express:error]', err);
      sendAlert('5xx', `${req.method} ${req.originalUrl} → ${err.message}`, err.stack);
      if (res.headersSent) return next(err);
      res.status(err.status || 500).json({ error: 'Errore interno' });
    });
  }

  if (!configured()) {
    console.warn(`[alert] SMTP non configurato all'avvio: gli alert verso ${ALERT_EMAIL} ` +
      `non partiranno finché non imposti SMTP_HOST/SMTP_USER/SMTP_PASS.`);
  } else {
    console.log(`[alert] attivo → ${ALERT_EMAIL}`);
  }
}

module.exports = { install, sendAlert, configured };
