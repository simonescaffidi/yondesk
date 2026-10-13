# Yondesk – regole di progetto

- Slug: `yondesk` (GitHub `simonescaffidi/yondesk`, progetto Railway `yondesk`).
- Segui la skill **stack-standard** di Simone per ogni modifica.
- Stack: `server/` Node 20 + Express 4 + ws (signaling WebRTC, sito IT/EN, web client), nessun DB (file JSON in `DATA_DIR`);
  `agent-desktop/` Electron (release via GitHub Actions su tag `v*`, non pubblicare release senza ok di Simone);
  `mobile/` Flutter (build in CI).
- Deploy: push su `main` → deploy automatico Railway del server (`server/Dockerfile`). Healthcheck `GET /health`.
  Lavora su branch + Pull Request: il merge su `main` va in produzione.
- Email: API Brevo (`server/src/mailer.js`); SMTP solo come fallback temporaneo finché `BREVO_API_KEY` non è su Railway.
- Alert (regola fissa): ogni errore (crash, 5xx, integrazioni) manda una mail a `ALERT_EMAIL` (info@simonescaffidi.it)
  tramite `server/src/alerts.js`. Prova: `GET /api/alert-test?token=ALERT_TEST_TOKEN`. Monitor esterno `.github/workflows/uptime.yml`.
- Manuale e sito sempre allineati: a ogni nuova funzione o modifica visibile aggiorna `docs/manuale-uso.md`
  e le pagine del sito `server/public/it` + `server/public/en`.
- Test: `cd server && npm test`, `cd agent-desktop && npm test`.
