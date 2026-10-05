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
- **App mobile** (`mobile/`): Flutter (Android/iOS) con `flutter_webrtc`. Viewer su entrambe le piattaforme; host/condivisione schermo su Android (MediaProjection).

## Sicurezza

- Password per ogni sessione, verificata **lato host** (il server non la conosce).
- Consenso obbligatorio sull'assistito per le sessioni presidiate.
- Blocco dopo tentativi di password errati (rate limit + lockout temporaneo).
- Cifratura end-to-end dei contenuti (WebRTC).
- Accesso non presidiato: opt-in, password dedicata (salvata solo come hash SHA-256), banner sempre visibile.

## Sviluppo locale

```bash
# Server + sito + demo
cd server && npm install && npm start      # http://localhost:3000
npm test                                   # test del signaling

# Agent desktop
cd agent-desktop && npm install && npm start

# App mobile
cd mobile && flutter create . && flutter pub get && flutter run
```

## Deploy

- **Server**: Railway collegato a questo repo, auto-deploy da push su `main` (vedi `railway.json`).
- **Agent desktop**: build firmate via GitHub Actions su tag `v*` (`.github/workflows/desktop-build.yml`) → GitHub Releases.
- **App mobile**: APK/iOS via GitHub Actions su tag `v*` (`.github/workflows/mobile-build.yml`).

## Variabili d'ambiente (server)

| Variabile | Descrizione |
|-----------|-------------|
| `PORT` | Porta (Railway la imposta) |
| `SITE_URL` | URL pubblico, per canonical/sitemap |
| `GA4_ID` | ID Google Analytics 4 (es. `G-XXXX`) |
| `GSC_VERIFICATION` | Codice meta verifica Search Console |
| `STUN_URLS` | STUN separati da virgola |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | TURN per NAT restrittivi |
| `GITHUB_REPO` | repo per i link alle release |

## Roadmap

- Controllo input mobile (Android Accessibility Service) e broadcast extension iOS.
- Rubrica dispositivi e log sessioni (piani Pro/Team).
- TURN dedicato gestito.

---
Powered by [www.simonescaffidi.it](https://www.simonescaffidi.it)
