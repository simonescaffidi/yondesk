# Yondesk

Software di **assistenza e controllo remoto** multipiattaforma (Windows, macOS, Linux, Android, iOS) con sito di presentazione, area demo nel browser, agent desktop e app mobile.

> **Principio di base: assistenza consensuale.** Ogni sessione richiede consenso esplicito e verificabile sul dispositivo assistito, con un banner di sessione sempre visibile. Nessuna modalità nascosta. L'accesso non presidiato è opzionale, si attiva solo con opt-in esplicito e mantiene un indicatore visibile.

## Architettura

```
┌────────────┐   WebSocket (signaling)   ┌────────────┐
│  Operatore │◀─────────────────────────▶│   Server   │
│ (viewer)   │        /ws                 │ Express+ws │
└─────┬──────┘                            └─────┬──────┘
      │        WebRTC P2P (DTLS-SRTP)            │ mette in contatto,
      │   schermo · input · chat · file          │ NON vede i contenuti
      ▼        (cifrato end-to-end)               ▼
┌────────────┐                            ┌────────────┐
│  Assistito │◀───────── STUN/TURN ──────▶│  Assistito │
│ (host)     │                            │            │
└────────────┘                            └────────────┘
```

- **Signaling** (`server/`): Node.js + Express + `ws`. Scambia solo messaggi di handshake, ID, metadati. I flussi A/V, input, file e chat viaggiano **peer-to-peer e cifrati end-to-end** (WebRTC/DTLS-SRTP).
- **Sito + demo** (`server/public/`): bilingue IT/EN, responsive, SEO, GDPR (cookie banner + privacy/cookie policy), demo WebRTC funzionante nel browser.
- **Agent desktop** (`agent-desktop/`): Electron (Win/macOS/Linux). Cattura schermo (`desktopCapturer`), controllo input via `nut-js` (opzionale, gated), consenso + banner, accesso non presidiato opt-in.
- **App mobile** (`mobile/`): Flutter (Android/iOS) con `flutter_webrtc`. Operatore su entrambe le piattaforme, con controllo touch e tastiera del dispositivo remoto; condivisione dello schermo del telefono su Android (MediaProjection + servizio in primo piano).
- **Protocollo**: è sempre il dispositivo assistito ad aprire video e canali dati (e quindi a fare l'offerta WebRTC); l'operatore risponde. Desktop, web e mobile si collegano tra loro.

## Sicurezza

- Password per ogni sessione, verificata **lato host** (il server non la conosce).
- Consenso obbligatorio sull'assistito per le sessioni presidiate.
- Blocco dopo tentativi di password errati (rate limit + lockout temporaneo).
- Cifratura end-to-end dei contenuti (WebRTC).
- Accesso non presidiato: opt-in, password dedicata (salvata solo come hash scrypt con salt), banner sempre visibile.

## Sviluppo locale

```bash
# Server + sito + demo
cd server && npm install && npm start      # http://localhost:3000
npm test                                   # test del signaling

# Agent desktop
cd agent-desktop && npm install && npm start

# App mobile (cartelle android/ e ios/ versionate; Flutter 3.50+)
cd mobile && flutter pub get && flutter run
```

## Test

Le app si provano con sessioni reali, non con simulazioni. Il workflow **Test app** le esegue a ogni push e blocca le pubblicazioni se qualcosa fallisce.

| Cosa | Come | Dove gira |
|------|------|-----------|
| App desktop pacchettizzata: due istanze (assistito + operatore), schermo, mouse, tastiera, consenso, non presidiato | `cd agent-desktop && npm run pack && YONDESK_APP_BIN=... node test/e2e/run.js` | Windows, macOS, Linux |
| Client web e interoperabilità web ↔ desktop (video, chat, file) | `node test/e2e/web.js` | Linux |
| App mobile come operatore verso l'app desktop (video, clic, testo) | `mobile/tool/e2e_linux.sh` | Linux (build desktop dell'app) |
| Android: operatore verso desktop + condivisione schermo del telefono verso il browser | `mobile/tool/e2e_android.sh` | emulatore Android 14 |
| iOS: operatore verso un dispositivo remoto | `mobile/tool/e2e_ios.sh <udid>` | simulatore iPhone |

Su Linux senza display: `xvfb-run -a -s "-screen 0 1280x800x24" <comando>`.

## Deploy

- **Server**: Railway collegato a questo repo, auto-deploy da push su `main`, build con `server/Dockerfile` (impostazioni del servizio su Railway; nel repo non c'è `railway.json`). Healthcheck: `GET /health`.
- **Agent desktop**: installer via GitHub Actions (`.github/workflows/desktop-build.yml`) → GitHub Releases, su tag `v*` o push del branch `ci-release`. Ogni installer è pubblicato solo se i test sono verdi e l'app appena pacchettizzata supera la sessione reale su quel sistema.
- **App mobile**: APK (e `.aab` per Google Play) via `.github/workflows/mobile-build.yml`, con le stesse condizioni. Firma di rilascio Android dai secret `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Variabili d'ambiente (server)

| Variabile | Descrizione |
|-----------|-------------|
| `PORT` | Porta (Railway la imposta) |
| `SITE_URL` | URL pubblico, per canonical/sitemap |
| `GA4_ID` | ID Google Analytics 4 (es. `G-XXXX`) |
| `GSC_VERIFICATION` | Codice meta verifica Search Console |
| `STUN_URLS` | STUN separati da virgola |
| `TURN_URLS`, `TURN_SECRET` | Relay TURN per NAT restrittivi (vedi `turn/`); credenziali temporanee generate dal server. In alternativa `TURN_USERNAME`/`TURN_CREDENTIAL` fissi |
| `GITHUB_REPO` | repo per i link alle release |
| `REDIRECT_HOSTS` | domini alias reindirizzati 301 al dominio di `SITE_URL` |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | invio email (alert) via API Brevo |
| `ALERT_EMAIL` | destinatario alert errori (default info@simonescaffidi.it) |
| `ALERT_TEST_TOKEN` | token per `GET /api/alert-test?token=...` |
| `SMTP_*` | solo fallback temporaneo se `BREVO_API_KEY` manca (da rimuovere) |

## Roadmap

- Controllo input mobile (Android Accessibility Service) e broadcast extension iOS.
- Rubrica dispositivi e log sessioni (piani Pro/Team).
- TURN dedicato gestito.

---
Powered by [www.simonescaffidi.it](https://www.simonescaffidi.it)

## Code signing policy

- Windows: Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).
- macOS: Developer ID signature and Apple notarization. Android: APK signed with the project's release key.
- Committers and reviewers: [@simonescaffidi](https://github.com/simonescaffidi) (repository owner). Approvers: [@simonescaffidi](https://github.com/simonescaffidi).
- Signed binaries are built only by GitHub Actions from this repository, after the `Test app` workflow is green for the same commit.
- Privacy: this program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. See the [privacy policy](https://yondesk.com/en/privacy-policy.html) and the full [code signing policy](https://yondesk.com/en/code-signing-policy.html).
