# Yondesk — Manuale d'uso

## Cos'è
Yondesk collega chi ha bisogno di assistenza (**assistito**) con chi la fornisce (**operatore**), per vedere e controllare lo schermo da remoto in modo sicuro. Funziona su Windows, macOS, Linux, Android, iOS e nel browser.

## Avvio rapido (browser, senza installare nulla)
1. Apri la pagina **Demo** del sito su entrambi i dispositivi.
2. Sul dispositivo da assistere scegli **"Mi fanno assistenza"**: compaiono **ID** e **password**.
3. Sull'altro scegli **"Offro assistenza"**, inserisci ID e password e premi **Connetti**.
4. Sull'assistito appare la richiesta di consenso: scegli **Consenti** o **Solo visione**.
5. Il browser chiede quale schermo/scheda condividere. Durante la sessione resta visibile un **banner** in alto.

## App desktop (controllo completo)
L'app nativa abilita il controllo reale di mouse e tastiera, il multi-monitor e l'accesso non presidiato.

1. Scarica l'app dalla pagina **Download** per il tuo sistema.
2. All'avvio l'app mostra **ID** e **password sessione**.
3. Comunica ID e password all'operatore; quando arriva la richiesta, **accetta** (controllo o sola visione).
4. Per terminare: pulsante **Termina** nell'app o **Termina** nel banner di sessione.

### Permessi di sistema
- **macOS**: autorizza *Registrazione schermo* e *Accessibilità* in Impostazioni → Privacy e sicurezza.
- **Windows/Linux**: nessuna configurazione particolare; su Linux (Wayland) usa la condivisione schermo del sistema.

### Accesso non presidiato (opzionale)
Per collegarti ai tuoi PC/server senza che nessuno accetti:
1. Nell'app attiva **"Accesso non presidiato"** e imposta una **password dedicata** (min. 6 caratteri).
2. Da quel momento un operatore con ID + password dedicata si collega senza conferma manuale.
3. Durante ogni sessione resta comunque **un banner visibile** e l'icona nella tray.

## App mobile
- **Offri assistenza**: inserisci ID e password per vedere lo schermo remoto (Android e iOS).
- **Fatti assistere** (Android): avvia la condivisione schermo; il sistema chiede conferma, poi resta un banner rosso attivo.

## Funzioni in sessione
- **Chat**: messaggi testuali tra operatore e assistito.
- **Invia file**: trasferimento diretto e cifrato in entrambe le direzioni.
- **Invia appunti**: condivide il contenuto degli appunti.
- **Qualità**: bassa / bilanciata / alta in base alla connessione.

## Sicurezza e privacy
- I contenuti (schermo, input, file, chat) sono **cifrati end-to-end**: il server non può vederli.
- La password è verificata sul dispositivo assistito, non dal server.
- Dopo troppi tentativi errati l'ID viene bloccato temporaneamente.
- Vedi Privacy Policy e Cookie Policy sul sito.

## Problemi comuni
| Problema | Soluzione |
|----------|-----------|
| "Dispositivo non in linea" | L'assistito non ha l'app aperta o manca connessione. |
| Schermo nero su macOS | Manca il permesso *Registrazione schermo*. |
| Connessione non parte dietro NAT severo | Configurare un server **TURN** (variabili `TURN_*`). |
| Password errata ripetuta → blocco | Attendere qualche minuto e riprovare. |

---
Powered by www.simonescaffidi.it
