# Yondesk – regole di progetto

- Slug: `yondesk` (GitHub `simonescaffidi/yondesk`, progetto Railway `yondesk`).
- Segui la skill **stack-standard** di Simone per ogni modifica.
- Stack: `server/` Node 20 + Express 4 + ws (signaling WebRTC, sito IT/EN, web client), nessun DB (file JSON in `DATA_DIR`);
  `agent-desktop/` Electron (release via GitHub Actions su tag `v*`, non pubblicare release senza ok di Simone);
  `mobile/` Flutter 3.50 (build in CI).
- Deploy: push su `main` → deploy automatico Railway del server (`server/Dockerfile`). Healthcheck `GET /health`.
  Lavora su branch + Pull Request: il merge su `main` va in produzione.
- Email: API Brevo (`server/src/mailer.js`); SMTP solo come fallback temporaneo finché `BREVO_API_KEY` non è su Railway.
- Alert (regola fissa): ogni errore (crash, 5xx, integrazioni) manda una mail a `ALERT_EMAIL` (info@simonescaffidi.it)
  tramite `server/src/alerts.js`. Prova: `GET /api/alert-test?token=ALERT_TEST_TOKEN`. Monitor esterno `.github/workflows/uptime.yml`.
- Manuale e sito sempre allineati: a ogni nuova funzione o modifica visibile aggiorna `docs/manuale-uso.md`
  e le pagine del sito `server/public/it` + `server/public/en`.
- Test: `cd server && npm test`, `cd agent-desktop && npm test`. Test reali delle app (obbligatori prima di pubblicare):
  `agent-desktop/test/e2e/run.js` (desktop), `web.js` (client web + interoperabilità), `mobile/tool/e2e_*.sh` (mobile).
  Il workflow `Test app` li esegue su Windows, macOS, Linux, emulatore Android e simulatore iOS; le release partono solo
  se è verde per lo stesso commit. Non dichiarare "funziona" un'app senza averla provata in una sessione reale.
- Protocollo WebRTC: è sempre l'assistito ad aprire video e canali dati e a fare l'offerta; l'operatore risponde soltanto.
  Sull'assistito l'ordine è cattura → peer → `accept` → offerta. Vale per desktop, web e mobile.
- `mobile/android` e `mobile/ios` sono versionate (id `it.simonescaffidi.yondesk`): non rigenerarle con `flutter create`.
