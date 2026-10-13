'use strict';
/*
 * Alert via email su errori (regola fissa: destinatario info@simonescaffidi.it).
 * Invia mail su: crash (uncaughtException/unhandledRejection) e risposte 5xx Express.
 * Anti-spam: max 1 mail per tipo di errore ogni 30 minuti.
 * Invio tramite src/mailer.js: API Brevo (BREVO_API_KEY), fallback temporaneo SMTP se Brevo non è configurato.
 * Se nessun canale è configurato logga un warning (non invia) — NON va omesso in silenzio.
 */
const mailer = require('./mailer');

const SLUG = 'yondesk';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'info@simonescaffidi.it';
const RAILWAY_URL = process.env.RAILWAY_PROJECT_URL ||
  (process.env.RAILWAY_PROJECT_ID ? `https://railway.com/project/${process.env.RAILWAY_PROJECT_ID}` : '(n/d)');

const WINDOW_MS = 30 * 60 * 1000;
const lastSent = new Map(); // tipo -> timestamp
let warned = false;

function configured() {
  return !!mailer.canale();
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
  if (now - prev < WINDOW_MS) return Promise.resolve({ inviata: false, motivo: 'anti-spam' }); // anti-spam
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

  if (!configured()) {
    if (!warned) {
      warned = true;
      console.error(`[alert] mail non configurata: impossibile inviare alert a ${ALERT_EMAIL}. ` +
        `Imposta BREVO_API_KEY (oppure, temporaneamente, SMTP_HOST/SMTP_USER/SMTP_PASS).`);
    }
    console.error(`[alert:NON INVIATO] ${subject}\n${body}`);
    return Promise.resolve({ inviata: false, motivo: 'mail non configurata' });
  }
  return mailer.invia({ to: ALERT_EMAIL, subject, text: body })
    .then((r) => { if (r.inviata) console.log(`[alert] inviato (${r.canale}): ${subject}`); else console.error(`[alert] invio fallito: ${r.motivo}`); return r; });
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
    console.warn(`[alert] mail non configurata all'avvio: gli alert verso ${ALERT_EMAIL} ` +
      `non partiranno finché non imposti BREVO_API_KEY.`);
  } else {
    console.log(`[alert] attivo → ${ALERT_EMAIL} (canale: ${mailer.canale()})`);
  }
}

module.exports = { install, sendAlert, configured };
