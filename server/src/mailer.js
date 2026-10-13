'use strict';
/*
 * Invio email (standard stack-standard): API Brevo.
 * Fallback TEMPORANEO: se BREVO_API_KEY manca ma SMTP_HOST c'è, usa il vecchio SMTP (nodemailer)
 * così gli alert non si interrompono finché Brevo non è configurato su Railway.
 * Da rimuovere (insieme a nodemailer e SMTP_*) dopo il passaggio a Brevo.
 */
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* dipendenza assente */ }

const smtp = () => {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  return {
    host: process.env.SMTP_HOST, port,
    user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
    secure: String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === 'true',
    from: process.env.SMTP_FROM || (process.env.SMTP_USER ? `Yondesk Alert <${process.env.SMTP_USER}>` : 'alert@yondesk')
  };
};

function canale() {
  if (process.env.BREVO_API_KEY) return 'brevo';
  const s = smtp();
  if (nodemailer && s.host && s.user && s.pass) return 'smtp';
  return null;
}

let transporter = null;

async function inviaBrevo({ to, subject, html, text, replyTo }) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM_EMAIL || 'info@simonescaffidi.it', name: process.env.MAIL_FROM_NAME || 'Yondesk' },
      to: [].concat(to).filter(Boolean).map((email) => ({ email })),
      subject,
      htmlContent: html || undefined,
      textContent: text || (html ? undefined : ' '),
      replyTo: replyTo ? { email: replyTo } : undefined
    })
  });
  if (!r.ok) { const t = await r.text(); return { inviata: false, motivo: `Brevo ${r.status}: ${t.slice(0, 300)}` }; }
  return { inviata: true, canale: 'brevo' };
}

async function inviaSmtp({ to, subject, html, text, replyTo }) {
  const s = smtp();
  if (!transporter) {
    transporter = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass } });
  }
  await transporter.sendMail({ from: s.from, to: [].concat(to).join(','), subject, text, html, replyTo });
  return { inviata: true, canale: 'smtp' };
}

async function invia(opts) {
  const c = canale();
  if (!c) { console.error('[MAIL] né BREVO_API_KEY né SMTP configurati: mail non inviata'); return { inviata: false, motivo: 'mail non configurata' }; }
  try {
    const r = c === 'brevo' ? await inviaBrevo(opts) : await inviaSmtp(opts);
    if (!r.inviata) console.error('[MAIL]', r.motivo);
    return r;
  } catch (e) {
    console.error('[MAIL] errore', e.message);
    return { inviata: false, motivo: e.message };
  }
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = { invia, canale, escapeHtml };
